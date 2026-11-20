import { resolve } from 'node:path';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { REPO_ROOT } from '../config.js';
import type { DbHandle } from './client.js';

export const MIGRATIONS_DIR = resolve(REPO_ROOT, 'apps', 'api', 'drizzle');

/** Creates the target database when it does not exist (local Windows PostgreSQL). */
export async function ensureDatabase(url: string): Promise<{ created: boolean; name: string }> {
  const target = new URL(url);
  const name = decodeURIComponent(target.pathname.replace(/^\//, ''));
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error(`Refusing unusual database name: ${name}`);
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const exists = await client.query('select 1 from pg_database where datname = $1', [name]);
    if (exists.rowCount && exists.rowCount > 0) return { created: false, name };
    // Identifier validated above; CREATE DATABASE cannot take a bind parameter.
    await client.query(`create database "${name}"`);
    return { created: true, name };
  } finally {
    await client.end();
  }
}

export async function dropDatabase(url: string): Promise<void> {
  const target = new URL(url);
  const name = decodeURIComponent(target.pathname.replace(/^\//, ''));
  if (!/^relief_(test|restore)_[a-z0-9_]+$/.test(name)) throw new Error(`Refusing to drop non-test database ${name}`);
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    await client.query(`drop database if exists "${name}" with (force)`);
  } finally {
    await client.end();
  }
}

export async function runMigrations(handle: DbHandle): Promise<void> {
  if (handle.kind === 'pglite') {
    const { migrate } = await import('drizzle-orm/pglite/migrator');
    // PgliteDatabase shares the query builder; the cast only widens the driver type.
    await migrate(handle.db as unknown as Parameters<typeof migrate>[0], { migrationsFolder: MIGRATIONS_DIR });
    return;
  }
  await migratePg(handle.db, { migrationsFolder: MIGRATIONS_DIR });
}
