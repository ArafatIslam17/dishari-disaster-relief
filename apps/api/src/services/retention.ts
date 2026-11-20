import { sql } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import { lockOperationFeed, query } from '../db/client.js';
import { audit, SYSTEM_ACTOR } from '../lib/audit.js';
import { forgetOperationKey } from './sync.js';

/**
 * NFR07 / C8: 90 days after an operation closes, names, phone numbers and GPS points are removed.
 * Materialised PII columns are nulled; the immutable event log is crypto-shredded by destroying
 * the operation's data key; a `retention.redacted` audit entry is appended.
 */
export async function dueForRetention(ctx: AppContext) {
  return query<{ id: string; name: string; closed_at: Date; due_at: Date; redacted_at: Date | null }>(
    ctx.db,
    sql`select operation_id as id, name, closed_at, closed_at + make_interval(days => ${ctx.config.RETENTION_DAYS}) as due_at, redacted_at
          from operation where status = 'closed' order by closed_at`,
  );
}

export async function runRetention(ctx: AppContext): Promise<{ operationId: string; households: number }[]> {
  const cutoff = new Date(ctx.now().getTime() - ctx.config.RETENTION_DAYS * 86_400_000);
  const ops = await query<{ id: string }>(
    ctx.db,
    sql`select operation_id as id from operation
         where status = 'closed' and redacted_at is null and closed_at <= ${cutoff}`,
  );
  const done: { operationId: string; households: number }[] = [];
  for (const { id } of ops) {
    const households = await ctx.db.transaction(async (tx) => {
      await lockOperationFeed(tx, id);
      const now = ctx.now();
      const [h] = await query<{ n: number }>(
        tx,
        sql`with u as (
              update household set head_name = null, name_norm = null, mobile_number = null, mobile_hmac = null,
                     mobile_masked = null, gps_lat = null, gps_lng = null, redacted_at = ${now}, updated_at = ${now},
                     server_seq = nextval('change_seq')
               where operation_id = ${id} and redacted_at is null returning 1)
            select count(*)::int as n from u`,
      );
      await tx.execute(
        sql`update conflict set local_value = null, server_value = null, resolved_value = null
             where operation_id = ${id} and field_name in ('headName', 'mobile', 'gps')`,
      );
      await tx.execute(sql`update duplicate_pair set signals = '{}'::jsonb where operation_id = ${id}`);
      await tx.execute(sql`update operation_key set wrapped_key = null, destroyed_at = ${now} where operation_id = ${id}`);
      await tx.execute(sql`update operation set redacted_at = ${now} where operation_id = ${id}`);
      await audit(tx, ctx.crypto, SYSTEM_ACTOR, {
        action: 'retention.redacted',
        entityType: 'operation',
        entityId: id,
        operationId: id,
        details: { households: h?.n ?? 0, fields: ['headName', 'mobile', 'gps'], eventKeyDestroyed: true },
      });
      return h?.n ?? 0;
    });
    forgetOperationKey(id);
    done.push({ operationId: id, households });
  }
  return done;
}
