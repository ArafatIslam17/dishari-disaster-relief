import { sql } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import { query, type DbOrTx } from '../db/client.js';
import { job } from '../db/schema.js';

export type JobType = 'duplicates.score' | 'flags.check' | 'retention.run';
export type JobHandler = (ctx: AppContext, payload: Record<string, unknown>) => Promise<void>;

/** Queue work inside the caller's transaction, so it exists exactly when the data does. */
export async function enqueue(db: DbOrTx, type: JobType, payload: Record<string, unknown>): Promise<void> {
  // Due immediately: run_after is compared with the injectable clock, not the database clock.
  await db.insert(job).values({ type, payload, runAfter: new Date(0) });
}

/**
 * In-process worker over the `job` table (no Redis on a low-resource laptop).
 * `FOR UPDATE SKIP LOCKED` makes it safe to run several API processes.
 */
export class JobWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = true;
  private wake = false;

  constructor(
    private readonly ctx: AppContext,
    private readonly handlers: Record<JobType, JobHandler>,
    private readonly pollMs = 2000,
  ) {}

  start(): void {
    this.stopped = false;
    this.schedule(0);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    while (this.running) await new Promise((r) => setTimeout(r, 20));
  }

  kick(): void {
    if (this.stopped) return;
    if (this.running) this.wake = true;
    else this.schedule(0);
  }

  private schedule(ms: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), ms);
  }

  /** Runs every due job until the queue is empty. Exposed for tests and scripts. */
  async drain(): Promise<number> {
    let n = 0;
    while (await this.runOne()) n++;
    return n;
  }

  private async tick(): Promise<void> {
    if (this.stopped || this.running) return;
    this.running = true;
    try {
      await this.drain();
    } catch (err) {
      console.error('job worker error', err instanceof Error ? err.message : err);
    } finally {
      this.running = false;
      if (!this.stopped) this.schedule(this.wake ? 0 : this.pollMs);
      this.wake = false;
    }
  }

  private async runOne(): Promise<boolean> {
    const now = this.ctx.now();
    // Recover jobs left running by a crashed process.
    await this.ctx.db.execute(
      sql`update job set status = 'queued' where status = 'running' and run_after < ${new Date(now.getTime() - 5 * 60_000)}`,
    );
    const [claimed] = await query<{ id: string; type: JobType; payload: Record<string, unknown>; attempts: number }>(
      this.ctx.db,
      sql`update job set status = 'running', attempts = attempts + 1, run_after = ${now}
           where id = (select id from job where status = 'queued' and run_after <= ${now}
                        order by id for update skip locked limit 1)
       returning id, type, payload, attempts`,
    );
    if (!claimed) return false;
    const handler = this.handlers[claimed.type];
    try {
      if (!handler) throw new Error(`no handler for ${claimed.type}`);
      await handler(this.ctx, claimed.payload);
      await this.ctx.db.execute(
        sql`update job set status = 'done', finished_at = ${this.ctx.now()}, last_error = null where id = ${claimed.id}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const failed = claimed.attempts >= 5;
      await this.ctx.db.execute(
        sql`update job set status = ${failed ? 'failed' : 'queued'}, last_error = ${message.slice(0, 500)},
                           run_after = ${new Date(this.ctx.now().getTime() + 2 ** claimed.attempts * 1000)}
             where id = ${claimed.id}`,
      );
    }
    return true;
  }
}
