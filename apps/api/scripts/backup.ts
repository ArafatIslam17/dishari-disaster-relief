/**
 * `pnpm backup` writes a pg_dump; `pnpm backup:verify` restores the newest dump into a scratch
 * database and compares row counts (NFR13). Schedule `pnpm backup` daily with Windows Task Scheduler
 * if the API's in-process daily backup is disabled (BACKUP_DAILY=false).
 */
import { createRuntime } from '../src/bootstrap.js';
import { loadEnvFile, readConfig } from '../src/config.js';
import { runBackup, verifyLatestBackup } from '../src/services/backup.js';

loadEnvFile();
const runtime = await createRuntime(readConfig());
try {
  if (process.argv.includes('--verify')) {
    const res = await verifyLatestBackup(runtime.ctx);
    console.info(`Restore verified from ${res.file}`);
    console.table(res.tables);
  } else {
    const res = await runBackup(runtime.ctx);
    console.info(`Backup written: ${res.file} (${(res.sizeBytes / 1024).toFixed(1)} KiB)`);
  }
} catch (err) {
  console.error(`Backup task failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await runtime.close();
}
