import { buildApp } from './app.js';
import { createRuntime } from './bootstrap.js';
import { loadEnvFile, readConfig } from './config.js';
import { backupNeeded, runBackup } from './services/backup.js';
import { enqueue } from './services/jobs.js';

loadEnvFile();
const config = readConfig();
const runtime = await createRuntime(config);
const app = await buildApp(runtime.ctx, { logger: true });

runtime.worker.start();

// Daily duties: retention (NFR07) and, when enabled, a pg_dump backup (NFR13).
const HOUR = 3_600_000;
async function daily(): Promise<void> {
  try {
    await enqueue(runtime.ctx.db, 'retention.run', {});
    runtime.ctx.kickJobs();
    if (config.BACKUP_DAILY && runtime.ctx.handle.kind === 'postgres' && (await backupNeeded(runtime.ctx))) {
      const { file } = await runBackup(runtime.ctx);
      app.log.info({ file }, 'daily backup written');
    }
  } catch (err) {
    app.log.error({ err: { message: err instanceof Error ? err.message : String(err) } }, 'daily duty failed');
  }
}
const dailyTimer = setInterval(() => void daily(), HOUR);
setTimeout(() => void daily(), 60_000);

const shutdown = async (signal: string) => {
  app.log.info(`received ${signal}, shutting down`);
  clearInterval(dailyTimer);
  await app.close();
  await runtime.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ host: config.API_HOST, port: config.API_PORT });
console.info(`\n  Relief API ready:  http://${config.API_HOST === '0.0.0.0' ? 'localhost' : config.API_HOST}:${config.API_PORT}/api/health\n`);
