import type { AppConfig } from './config.js';
import type { AppContext } from './context.js';
import { openDatabase } from './db/client.js';
import { ServerCrypto } from './lib/crypto.js';
import { checkDistributionFlags, scoreDuplicates } from './services/analysis.js';
import { JobWorker } from './services/jobs.js';
import { runRetention } from './services/retention.js';

export interface Runtime {
  ctx: AppContext;
  worker: JobWorker;
  close(): Promise<void>;
}

export async function createRuntime(config: AppConfig, options: { now?: () => Date; pollMs?: number } = {}): Promise<Runtime> {
  const handle = await openDatabase(config.DATABASE_URL);
  let worker: JobWorker | null = null;
  const ctx: AppContext = {
    db: handle.db,
    handle,
    config,
    crypto: new ServerCrypto(config.PHONE_PEPPER, config.DATA_MASTER_KEY),
    now: options.now ?? (() => new Date()),
    kickJobs: () => worker?.kick(),
  };
  worker = new JobWorker(
    ctx,
    {
      'duplicates.score': scoreDuplicates,
      'flags.check': checkDistributionFlags,
      'retention.run': async (c) => {
        await runRetention(c);
      },
    },
    options.pollMs,
  );
  return {
    ctx,
    worker,
    close: async () => {
      await worker?.stop();
      await handle.close();
    },
  };
}
