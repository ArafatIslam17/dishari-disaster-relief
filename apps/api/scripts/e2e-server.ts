/**
 * Server for the Playwright suite: the real API on an in-memory PGlite database (docs/BLOCKERS.md B1),
 * migrated and seeded, serving the built PWA from the same origin so the service worker and offline
 * behaviour are exercised exactly as in production. Never used for real data.
 */
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { buildApp } from '../src/app.js';
import { createRuntime } from '../src/bootstrap.js';
import { REPO_ROOT, readConfig } from '../src/config.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedDemo } from '../src/seed.js';

const port = Number(process.env.E2E_PORT ?? 4173);
const key = () => randomBytes(32).toString('base64');
const config = readConfig({
  NODE_ENV: 'test',
  DATABASE_URL: process.env.E2E_DATABASE_URL ?? 'pglite:memory',
  JWT_SECRET: key(),
  PHONE_PEPPER: key(),
  DATA_MASTER_KEY: key(),
  CORS_ORIGINS: `http://localhost:${port}`,
  BACKUP_DAILY: 'false',
  WEB_DIST: resolve(REPO_ROOT, 'apps', 'web', 'dist'),
  RATE_LIMIT_MAX: '100000',
});
const runtime = await createRuntime(config, { pollMs: 500 });
await runMigrations(runtime.ctx.handle);
await seedDemo(runtime.ctx, { demoPassword: 'Relief2026demo' });
await runtime.worker.drain();
runtime.worker.start();
const app = await buildApp(runtime.ctx);
await app.listen({ host: '127.0.0.1', port });
console.info(`e2e server ready on http://localhost:${port}`);
