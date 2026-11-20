/** `pnpm db:migrate`: creates the database if missing, enables pg_trgm and applies all migrations. */
import { sql } from 'drizzle-orm';
import { loadEnvFile } from '../src/config.js';
import { openDatabase, query } from '../src/db/client.js';
import { ensureDatabase, runMigrations } from '../src/db/migrate.js';

loadEnvFile();
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env and fill it in (see docs/BLOCKERS.md).');
  process.exit(1);
}
try {
  if (!url.startsWith('pglite:')) {
    const { created, name } = await ensureDatabase(url);
    console.info(created ? `Created database ${name}` : `Database ${name} exists`);
  }
  const handle = await openDatabase(url, { max: 2 });
  await runMigrations(handle);
  const [ext] = await query<{ v: string }>(handle.db, sql`select extversion as v from pg_extension where extname = 'pg_trgm'`);
  console.info(`Migrations applied. pg_trgm ${ext ? `v${ext.v} enabled` : 'NOT available'}.`);
  await handle.close();
} catch (err) {
  console.error(`Migration failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
