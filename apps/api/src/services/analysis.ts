/**
 * Background analysis after each sync (Fig 5.5 steps 22-25).
 *  - duplicates.score: candidates from pg_trgm within the same union, final score in code (FR18).
 *  - flags.check: same item from two organisations to one household within 24 hours (FR20).
 * Nothing is ever merged or deleted automatically.
 */
import { sql } from 'drizzle-orm';
import {
  DUPLICATE_DISTRIBUTION_WINDOW_HOURS,
  scoreHouseholds,
  uuidv7,
  type ScoringHousehold,
} from '@relief/shared';
import type { AppContext } from '../context.js';
import { query, type DbOrTx } from '../db/client.js';
import { audit, notify, SYSTEM_ACTOR } from '../lib/audit.js';

interface CandidateRow {
  id: string;
  operation_id: string;
  organisation_id: string;
  head_name: string | null;
  mobile_number: string | null;
  mobile_hmac: string | null;
  member_count: number;
  union_key: string;
  ward_key: string;
  gps_lat: string | null;
  gps_lng: string | null;
}

const toScoring = (r: CandidateRow): ScoringHousehold => ({
  headName: r.head_name ?? '',
  phone: r.mobile_number,
  phoneHmac: r.mobile_hmac,
  memberCount: r.member_count,
  unionKey: r.union_key,
  wardKey: r.ward_key,
  gps: r.gps_lat && r.gps_lng ? { lat: Number(r.gps_lat), lng: Number(r.gps_lng) } : null,
});

const CANDIDATE_COLUMNS = sql`h.household_id as id, h.operation_id, h.organisation_id, h.head_name, h.mobile_number,
  h.mobile_hmac, h.member_count, a.union_key, a.ward_key, h.gps_lat::text, h.gps_lng::text`;

async function coordinatorsOf(db: DbOrTx, organisationIds: string[]): Promise<string[]> {
  if (organisationIds.length === 0) return [];
  const rows = await query<{ user_id: string }>(
    db,
    sql`select user_id from app_user where role = 'GROUP_COORDINATOR' and status = 'active'
          and organisation_id in (${sql.join(organisationIds.map((o) => sql`${o}::uuid`), sql`, `)})`,
  );
  return rows.map((r) => r.user_id);
}

export async function scoreDuplicates(ctx: AppContext, payload: Record<string, unknown>): Promise<void> {
  const ids = (payload.householdIds as string[] | undefined) ?? [];
  for (const id of ids) {
    const [target] = await query<CandidateRow>(
      ctx.db,
      sql`select ${CANDIDATE_COLUMNS} from household h join area a on a.area_id = h.area_id
           where h.household_id = ${id} and h.redacted_at is null`,
    );
    if (!target || !target.head_name) continue;
    // Candidate retrieval (indexed): trigram name match or the same phone, within one union.
    const candidates = await query<CandidateRow>(
      ctx.db,
      sql`select ${CANDIDATE_COLUMNS} from household h join area a on a.area_id = h.area_id
           where h.operation_id = ${target.operation_id} and a.union_key = ${target.union_key}
             and h.household_id <> ${id} and h.redacted_at is null
             and (h.name_norm % (select t.name_norm from household t where t.household_id = ${id})
                  or (h.mobile_hmac is not null and h.mobile_hmac = ${target.mobile_hmac}))
           limit 200`,
    );
    for (const c of candidates) {
      const s = scoreHouseholds(toScoring(target), toScoring(c));
      const label = s.label;
      if (!label) continue;
      const [a, b] = id < c.id ? [id, c.id] : [c.id, id];
      await ctx.db.transaction(async (tx) => {
        const inserted = await query<{ id: string }>(
          tx,
          sql`insert into duplicate_pair (pair_id, operation_id, household_a_id, household_b_id, score, label, signals, status)
              values (${uuidv7()}, ${target.operation_id}, ${a}, ${b}, ${s.score}, ${label}, ${JSON.stringify(s.signals)}::jsonb, 'pending_review')
              on conflict (household_a_id, household_b_id) do update
                 set score = excluded.score, label = excluded.label, signals = excluded.signals, updated_at = now()
               where duplicate_pair.status = 'pending_review'
              returning pair_id as id, (xmax = 0) as inserted`,
        );
        const row = inserted[0] as ({ id: string; inserted?: boolean } | undefined);
        if (!row?.inserted) return;
        await audit(tx, ctx.crypto, SYSTEM_ACTOR, {
          action: 'duplicate.flagged',
          entityType: 'duplicate_pair',
          entityId: row.id,
          operationId: target.operation_id,
          details: { score: s.score, label: s.label, householdA: a, householdB: b },
        });
        await notify(
          tx,
          await coordinatorsOf(tx, [...new Set([target.organisation_id, c.organisation_id])]),
          'duplicate.new',
          { label, score: s.score },
          `/app/duplicates/${row.id}`,
        );
      });
    }
  }
}

export async function checkDistributionFlags(ctx: AppContext, payload: Record<string, unknown>): Promise<void> {
  const ids = (payload.distributionIds as string[] | undefined) ?? [];
  const windowMs = DUPLICATE_DISTRIBUTION_WINDOW_HOURS * 3_600_000;
  for (const id of ids) {
    // The household and every household confirmed as the same (linked duplicates).
    const matches = await query<{
      first_id: string;
      second_id: string;
      item_id: string;
      operation_id: string;
      org_a: string;
      org_b: string;
    }>(
      ctx.db,
      sql`with d as (
            select d.distribution_id, d.operation_id, d.organisation_id, d.distributed_at, h.household_id, h.link_group_id
              from distribution d join household h on h.household_id = d.household_id
             where d.distribution_id = ${id} and d.status = 'recorded'
          ), grp as (
            select h.household_id from household h, d
             where h.household_id = d.household_id or (d.link_group_id is not null and h.link_group_id = d.link_group_id)
          )
          select case when o.distributed_at <= d.distributed_at then o.distribution_id else d.distribution_id end as first_id,
                 case when o.distributed_at <= d.distributed_at then d.distribution_id else o.distribution_id end as second_id,
                 di.item_id, d.operation_id, d.organisation_id as org_a, o.organisation_id as org_b
            from d
            join distribution o on o.household_id in (select household_id from grp)
                               and o.distribution_id <> d.distribution_id
                               and o.status = 'recorded'
                               and o.organisation_id <> d.organisation_id
                               and abs(extract(epoch from (o.distributed_at - d.distributed_at))) * 1000 <= ${windowMs}
            join distribution_item di on di.distribution_id = d.distribution_id
            join distribution_item oi on oi.distribution_id = o.distribution_id and oi.item_id = di.item_id`,
    );
    for (const m of matches) {
      await ctx.db.transaction(async (tx) => {
        const flagId = uuidv7();
        const inserted = await query<{ id: string }>(
          tx,
          sql`insert into distribution_flag (flag_id, operation_id, first_distribution_id, second_distribution_id, item_id, status)
              values (${flagId}, ${m.operation_id}, ${m.first_id}, ${m.second_id}, ${m.item_id}, 'pending')
              on conflict do nothing returning flag_id as id`,
        );
        if (inserted.length === 0) return;
        await audit(tx, ctx.crypto, SYSTEM_ACTOR, {
          action: 'flag.raised',
          entityType: 'distribution_flag',
          entityId: flagId,
          operationId: m.operation_id,
          details: { first: m.first_id, second: m.second_id, itemId: m.item_id },
        });
        const admins = await query<{ user_id: string }>(
          tx,
          sql`select oa.user_id from operation_admin oa join app_user u on u.user_id = oa.user_id
               where oa.operation_id = ${m.operation_id} and u.status = 'active'`,
        );
        await notify(
          tx,
          [...(await coordinatorsOf(tx, [m.org_a, m.org_b])), ...admins.map((a) => a.user_id)],
          'flag.new',
          { itemId: m.item_id },
          `/app/flags/${flagId}`,
        );
      });
    }
  }
}
