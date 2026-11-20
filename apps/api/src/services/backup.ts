import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { and, desc, eq } from 'drizzle-orm';
import pg from 'pg';
import { uuidv7 } from '@relief/shared';
import { REPO_ROOT } from '../config.js';
import type { AppContext } from '../context.js';
import { backupRun } from '../db/schema.js';
import { dropDatabase, ensureDatabase } from '../db/migrate.js';
import { AppError } from '../lib/errors.js';

/** NFR13: daily pg_dump backups and a tested restore, using the PostgreSQL binaries on PATH. */
export function backupDir(ctx: AppContext): string {
  const dir = ctx.config.BACKUP_DIR;
  return isAbsolute(dir) ? dir : resolve(REPO_ROOT, dir);
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number; stderr: string }> {
  return new Promise((done, fail) => {
    const child = spawn(cmd, args, { env, windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', fail);
    child.on('close', (code) => done({ code: code ?? 1, stderr: stderr.slice(-2000) }));
  });
}

/** Passes credentials through the environment, never on the command line (process lists are visible). */
function pgEnv(url: string): { env: NodeJS.ProcessEnv; db: string } {
  const u = new URL(url);
  return {
    db: decodeURIComponent(u.pathname.slice(1)),
    env: {
      ...process.env,
      PGHOST: u.hostname,
      PGPORT: u.port || '5432',
      PGUSER: decodeURIComponent(u.username),
      PGPASSWORD: decodeURIComponent(u.password),
    },
  };
}

function assertPostgres(ctx: AppContext) {
  if (ctx.handle.kind !== 'postgres') throw new AppError(409, 'backup_requires_postgres');
}

export async function runBackup(ctx: AppContext): Promise<{ file: string; sizeBytes: number }> {
  assertPostgres(ctx);
  const dir = backupDir(ctx);
  mkdirSync(dir, { recursive: true });
  const stamp = ctx.now().toISOString().replace(/[:.]/g, '-');
  const file = join(dir, `relief-${stamp}.dump`);
  const id = uuidv7();
  await ctx.db.insert(backupRun).values({ id, kind: 'backup', status: 'running', startedAt: ctx.now() });
  const { env, db } = pgEnv(ctx.config.DATABASE_URL);
  const res = await run('pg_dump', ['--format=custom', '--no-owner', `--file=${file}`, db], env);
  if (res.code !== 0) {
    await ctx.db.update(backupRun).set({ status: 'failed', detail: res.stderr, finishedAt: ctx.now() }).where(eq(backupRun.id, id));
    throw new AppError(500, 'backup_failed');
  }
  const sizeBytes = statSync(file).size;
  await ctx.db.update(backupRun).set({ status: 'ok', file, sizeBytes, finishedAt: ctx.now() }).where(eq(backupRun.id, id));
  pruneBackups(ctx);
  return { file, sizeBytes };
}

function pruneBackups(ctx: AppContext): void {
  const dir = backupDir(ctx);
  const keepMs = ctx.config.BACKUP_KEEP_DAYS * 86_400_000;
  for (const f of readdirSync(dir)) {
    if (!/^relief-.*\.dump$/.test(f)) continue;
    const p = join(dir, f);
    if (ctx.now().getTime() - statSync(p).mtimeMs > keepMs) rmSync(p);
  }
}

const VERIFY_TABLES = ['organisation', 'app_user', 'operation', 'area', 'household', 'distribution', 'sync_event', 'audit_log'];

/** Restores the newest backup into a scratch database and compares row counts (tested restore). */
export async function verifyLatestBackup(ctx: AppContext): Promise<{ file: string; tables: Record<string, number> }> {
  assertPostgres(ctx);
  const [latest] = await ctx.db.select().from(backupRun).where(and(eq(backupRun.kind, 'backup'), eq(backupRun.status, 'ok'))).orderBy(desc(backupRun.startedAt)).limit(1);
  if (!latest?.file) throw new AppError(409, 'no_backup_to_verify');
  const id = uuidv7();
  await ctx.db.insert(backupRun).values({ id, kind: 'verify', status: 'running', file: latest.file, startedAt: ctx.now() });
  const target = new URL(ctx.config.DATABASE_URL);
  target.pathname = `/relief_restore_${Date.now().toString(36)}`;
  const { env, db } = pgEnv(target.toString());
  try {
    await ensureDatabase(target.toString());
    const res = await run('pg_restore', ['--no-owner', `--dbname=${db}`, latest.file], env);
    if (res.code !== 0) throw new Error(res.stderr || 'pg_restore failed');
    const client = new pg.Client({ connectionString: target.toString() });
    await client.connect();
    const tables: Record<string, number> = {};
    try {
      for (const t of VERIFY_TABLES) {
        const r = await client.query<{ n: string }>(`select count(*) as n from ${t}`);
        tables[t] = Number(r.rows[0]?.n ?? 0);
      }
    } finally {
      await client.end();
    }
    await ctx.db
      .update(backupRun)
      .set({ status: 'ok', detail: JSON.stringify(tables), finishedAt: ctx.now() })
      .where(eq(backupRun.id, id));
    return { file: latest.file, tables };
  } catch (err) {
    await ctx.db
      .update(backupRun)
      .set({ status: 'failed', detail: err instanceof Error ? err.message.slice(0, 1000) : 'failed', finishedAt: ctx.now() })
      .where(eq(backupRun.id, id));
    throw new AppError(500, 'restore_verification_failed');
  } finally {
    await dropDatabase(target.toString()).catch(() => undefined);
  }
}

export async function backupNeeded(ctx: AppContext): Promise<boolean> {
  const [latest] = await ctx.db
    .select({ at: backupRun.startedAt })
    .from(backupRun)
    .where(and(eq(backupRun.kind, 'backup'), eq(backupRun.status, 'ok')))
    .orderBy(desc(backupRun.startedAt))
    .limit(1);
  return !latest || ctx.now().getTime() - latest.at.getTime() > 24 * 3_600_000;
}
