/**
 * `pnpm seed`: demo accounts for all five roles plus a demo operation with data.
 * Demo data only: refuses to run with NODE_ENV=production. The first System Administrator for a
 * real install is created with `pnpm admin:create` instead.
 */
import { createRuntime } from '../src/bootstrap.js';
import { loadEnvFile, readConfig } from '../src/config.js';
import { seedDemo } from '../src/seed.js';

loadEnvFile();
const config = readConfig();
if (config.NODE_ENV === 'production') {
  console.error('Refusing to load demo data in production. Use "pnpm admin:create" for the first System Administrator.');
  process.exit(1);
}
const demoPassword = process.env.SEED_DEMO_PASSWORD || 'Relief2026demo';
const adminPassword = process.env.SEED_ADMIN_PASSWORD && !process.env.SEED_ADMIN_PASSWORD.startsWith('CHANGE_ME') ? process.env.SEED_ADMIN_PASSWORD : undefined;
const runtime = await createRuntime(config);
try {
  const result = await seedDemo(runtime.ctx, { demoPassword, adminPassword });
  await runtime.worker.drain(); // duplicate scoring and distribution flags
  console.info(result.created ? 'Demo data created.' : 'Demo data already present; nothing changed.');
  console.table(result.accounts.map((a) => ({ role: a.role, mobile: a.mobile, name: a.name })));
  console.info(`Password for demo accounts: ${adminPassword ? 'SEED_DEMO_PASSWORD (System Administrator: SEED_ADMIN_PASSWORD)' : 'SEED_DEMO_PASSWORD'} — default "Relief2026demo" if unset.`);
} catch (err) {
  console.error(`Seeding failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await runtime.close();
}
