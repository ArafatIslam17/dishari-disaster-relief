/** Used by `pnpm dev`: wait until PostgreSQL accepts connections before the API boots. */
import pg from 'pg';
import { loadEnvFile } from '../src/config.js';

loadEnvFile();
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env (see docs/BLOCKERS.md).');
  process.exit(1);
}
const deadline = Date.now() + 60_000;
for (let attempt = 1; ; attempt++) {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 2000 });
  try {
    await client.connect();
    await client.query('select 1');
    await client.end();
    console.info('Database is ready.');
    break;
  } catch (err) {
    await client.end().catch(() => undefined);
    const message = err instanceof Error ? err.message : String(err);
    if (/password authentication|does not exist|no password/i.test(message) || Date.now() > deadline) {
      console.error(`Cannot use the database: ${message}\nRun "pnpm db:migrate" and check DATABASE_URL in .env.`);
      process.exit(1);
    }
    if (attempt === 1) console.info('Waiting for PostgreSQL on DATABASE_URL ...');
    await new Promise((r) => setTimeout(r, 1000));
  }
}
