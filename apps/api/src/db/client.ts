import { resolve } from 'node:path';
import { sql, type SQL } from 'drizzle-orm';
import { drizzle as drizzlePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

export interface DbHandle {
  db: Db;
  kind: 'postgres' | 'pglite';
  close(): Promise<void>;
  /** node-postgres pool, for streaming cursors (CSV export). Undefined on PGlite. */
  pool?: pg.Pool;
}

// Return bigint columns (change_seq, identity) as strings to keep precision; parse numerics in code.
pg.types.setTypeParser(20, (v) => v);

export async function openDatabase(url: string, options: { max?: number } = {}): Promise<DbHandle> {
  if (url.startsWith('pglite:')) return openPglite(url.slice('pglite:'.length));
  const pool = new pg.Pool({ connectionString: url, max: options.max ?? 20, idleTimeoutMillis: 30_000 });
  const db = drizzlePg(pool, { schema });
  return { db, kind: 'postgres', pool, close: () => pool.end() };
}

/**
 * PGlite: PostgreSQL in WebAssembly with pg_trgm. Used only by tests and measurements
 * when no PostgreSQL credentials are available (docs/BLOCKERS.md B1).
 */
async function openPglite(dataDir: string): Promise<DbHandle> {
  const { PGlite } = await import('@electric-sql/pglite');
  const { pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm');
  const { drizzle: drizzlePglite } = await import('drizzle-orm/pglite');
  const client = await PGlite.create(dataDir && dataDir !== 'memory' ? resolve(dataDir) : undefined, {
    extensions: { pg_trgm },
  });
  const db = drizzlePglite(client, { schema }) as unknown as Db;
  return { db, kind: 'pglite', close: () => client.close() };
}

/** Rows of a raw `db.execute(sql...)` on either driver. */
export async function query<T>(db: DbOrTx, statement: SQL): Promise<T[]> {
  const res = (await db.execute(statement)) as unknown as { rows: T[] };
  return res.rows;
}

export async function queryOne<T>(db: DbOrTx, statement: SQL): Promise<T | undefined> {
  const rows = await query<T>(db, statement);
  return rows[0];
}

/**
 * Serialises writers of one operation's change feed. Change-sequence numbers are
 * then assigned in commit order, so a device cursor can never skip a row (FR15, NFR10).
 */
export async function lockOperationFeed(tx: Tx, operationId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`feed:${operationId}`}, 0))`);
}
