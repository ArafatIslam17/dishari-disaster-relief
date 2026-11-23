import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { OBSERVER_MIN_CELL, coverageLabel, servedPercent, uuidSchema, uuidv7 } from '@relief/shared';
import { z } from 'zod';
import { assertActive, authOf, operationAccess, requireAuth } from '../auth/guard.js';
import type { AppContext } from '../context.js';
import { lockOperationFeed, query } from '../db/client.js';
import { unservedRelease } from '../db/schema.js';
import { audit, notify } from '../lib/audit.js';
import { notFound } from '../lib/errors.js';
import { selectHouseholds, toHouseholdDTO } from '../services/views.js';

export interface CoverageRow {
  areaId: string;
  upazila: string;
  unionName: string;
  ward: string;
  upazilaBn: string | null;
  unionBn: string | null;
  registered: number;
  served: number;
  unserved: number;
  anonymousDistributions: number;
  lastDistributionAt: string | null;
  label: ReturnType<typeof coverageLabel>;
  servedPercent: number | null;
}

/**
 * Coverage per area (FR21, UC22, DECISIONS C11). A household counts once per link group:
 * confirmed duplicates are one family, served if any linked record received relief.
 */
export async function coverageSummary(
  ctx: AppContext,
  operationId: string,
  filter: { upazila?: string; union?: string; ward?: string; from?: string; to?: string } = {},
): Promise<{ rows: CoverageRow[]; lastUpdated: string | null }> {
  const where = [sql`a.operation_id = ${operationId}`];
  if (filter.upazila) where.push(sql`a.upazila = ${filter.upazila}`);
  if (filter.union) where.push(sql`a.union_name = ${filter.union}`);
  if (filter.ward) where.push(sql`a.ward = ${filter.ward}`);
  const distWindow = sql`${filter.from ? sql`and d.distributed_at >= ${filter.from}::date` : sql``}
                         ${filter.to ? sql`and d.distributed_at < (${filter.to}::date + 1)` : sql``}`;
  const rows = await query<{
    area_id: string;
    upazila: string;
    union_name: string;
    ward: string;
    upazila_bn: string | null;
    union_bn: string | null;
    registered: number;
    served: number;
    anonymous: number;
    last_at: Date | null;
  }>(
    ctx.db,
    sql`with served_hh as (
          select distinct d.household_id from distribution d
           where d.operation_id = ${operationId} and d.status = 'recorded' and d.household_id is not null ${distWindow}
        ), grp as (
          select h.area_id, h.household_id, coalesce(h.link_group_id, h.household_id) as gid
            from household h where h.operation_id = ${operationId}
        ), served_groups as (
          select distinct g.gid from grp g join served_hh s on s.household_id = g.household_id
        ), area_counts as (
          select g.area_id, count(distinct g.gid)::int as registered,
                 count(distinct g.gid) filter (where sg.gid is not null)::int as served
            from grp g left join served_groups sg on sg.gid = g.gid
           group by g.area_id
        ), area_dist as (
          select d.area_id, count(*) filter (where d.is_anonymous)::int as anonymous, max(d.distributed_at) as last_at
            from distribution d
           where d.operation_id = ${operationId} and d.status = 'recorded' ${distWindow}
           group by d.area_id
        )
        select a.area_id, a.upazila, a.union_name, a.ward, a.upazila_bn, a.union_bn,
               coalesce(ac.registered, 0) as registered, coalesce(ac.served, 0) as served,
               coalesce(ad.anonymous, 0) as anonymous, ad.last_at
          from area a
          left join area_counts ac on ac.area_id = a.area_id
          left join area_dist ad on ad.area_id = a.area_id
         where ${sql.join(where, sql` and `)}
         order by a.upazila, a.union_name, a.ward`,
  );
  const [sync] = await query<{ last: Date | null }>(
    ctx.db,
    sql`select max(d.last_sync_at) as last from device d
          join app_user u on u.user_id = d.user_id
          join operation_membership m on m.organisation_id = u.organisation_id and m.operation_id = ${operationId}`,
  );
  return {
    lastUpdated: sync?.last ? new Date(sync.last).toISOString() : null,
    rows: rows.map((r) => ({
      areaId: r.area_id,
      upazila: r.upazila,
      unionName: r.union_name,
      ward: r.ward,
      upazilaBn: r.upazila_bn,
      unionBn: r.union_bn,
      registered: r.registered,
      served: r.served,
      unserved: r.registered - r.served,
      anonymousDistributions: r.anonymous,
      lastDistributionAt: r.last_at ? new Date(r.last_at).toISOString() : null,
      label: coverageLabel(r.registered, r.served),
      servedPercent: servedPercent(r.registered, r.served),
    })),
  };
}

/** Link groups (or single households) with at least one recorded distribution in the operation. */
function servedGroups(operationId: string) {
  return sql`select coalesce(x.link_group_id, x.household_id) from household x
              where x.operation_id = ${operationId}
                and x.household_id in (select d.household_id from distribution d
                                        where d.operation_id = ${operationId} and d.status = 'recorded' and d.household_id is not null)`;
}

/** Observers see area-level figures only; small counts are suppressed (NFR06, A6). */
export function suppressSmallCells(rows: CoverageRow[]): (Omit<CoverageRow, 'registered' | 'served' | 'unserved'> & {
  registered: number | string;
  served: number | string;
  unserved: number | string;
})[] {
  const cell = (n: number) => (n > 0 && n < OBSERVER_MIN_CELL ? `<${OBSERVER_MIN_CELL}` : n);
  return rows.map((r) => ({ ...r, registered: cell(r.registered), served: cell(r.served), unserved: cell(r.unserved) }));
}

export function coverageTotals(rows: CoverageRow[]) {
  return rows.reduce(
    (t, r) => ({
      registered: t.registered + r.registered,
      served: t.served + r.served,
      areas: t.areas + 1,
      noRecords: t.noRecords + (r.label === 'no_records' ? 1 : 0),
    }),
    { registered: 0, served: 0, areas: 0, noRecords: 0 },
  );
}

/** Coverage rolled up per upazila (for the live map). Observers and the public get small cells suppressed. */
export function upazilaRollup(rows: CoverageRow[], suppress: boolean) {
  const by = new Map<string, { upazila: string; upazilaBn: string | null; registered: number; served: number; areas: number; noRecords: number; lastDistributionAt: string | null }>();
  for (const r of rows) {
    const u = by.get(r.upazila) ?? { upazila: r.upazila, upazilaBn: r.upazilaBn, registered: 0, served: 0, areas: 0, noRecords: 0, lastDistributionAt: null };
    u.registered += r.registered;
    u.served += r.served;
    u.areas += 1;
    if (r.label === 'no_records') u.noRecords += 1;
    if (r.lastDistributionAt && (!u.lastDistributionAt || r.lastDistributionAt > u.lastDistributionAt)) u.lastDistributionAt = r.lastDistributionAt;
    by.set(r.upazila, u);
  }
  const cell = (n: number) => (suppress && n > 0 && n < OBSERVER_MIN_CELL ? `<${OBSERVER_MIN_CELL}` : n);
  return [...by.values()].map((u) => ({
    ...u,
    label: coverageLabel(u.registered, u.served),
    servedPercent: servedPercent(u.registered, u.served),
    registered: cell(u.registered),
    served: cell(u.served),
    unserved: cell(u.registered - u.served),
  }));
}

export async function coverageRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;
  const viewers = requireAuth(ctx, 'GROUP_COORDINATOR', 'OPERATION_ADMINISTRATOR', 'OBSERVER', 'SYSTEM_ADMINISTRATOR');

  app.get('/api/operations/:id/coverage', { preHandler: viewers }, async (request) => {
    const auth = authOf(request);
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const filter = z
      .object({
        upazila: z.string().max(50).optional(),
        union: z.string().max(50).optional(),
        ward: z.string().max(20).optional(),
      })
      .parse(request.query);
    const access = await operationAccess(ctx, auth, id);
    const summary = await coverageSummary(ctx, id, filter);
    const observer = access.relation === 'observer';
    const rows = observer ? suppressSmallCells(summary.rows) : summary.rows;
    const totals = coverageTotals(summary.rows);
    const upazilas = upazilaRollup(summary.rows, observer);
    return { rows, totals, upazilas, lastUpdated: summary.lastUpdated, generatedAt: ctx.now().toISOString() };
  });

  // UC21: unserved households of an area (coordinators).
  const coordinator = requireAuth(ctx, 'GROUP_COORDINATOR');
  app.get('/api/operations/:id/areas/:areaId/unserved', { preHandler: coordinator }, async (request) => {
    const auth = authOf(request);
    const { id, areaId } = z.object({ id: uuidSchema, areaId: uuidSchema }).parse(request.params);
    await operationAccess(ctx, auth, id);
    const rows = await selectHouseholds(
      ctx.db,
      sql`h.operation_id = ${id} and h.area_id = ${areaId}
          and coalesce(h.link_group_id, h.household_id) not in (${servedGroups(id)})`,
      sql`order by h.created_at`,
    );
    const [last] = await query<{ last: Date | null }>(
      ctx.db,
      sql`select max(server_received_at) as last from household where area_id = ${areaId}`,
    );
    return {
      households: rows.map((r) => toHouseholdDTO(r, auth.organisationId)),
      lastUpdated: last?.last ? new Date(last.last).toISOString() : null,
    };
  });

  // UC21 step 4: release the list to the organisation's field devices.
  app.post('/api/operations/:id/areas/:areaId/unserved/release', { preHandler: coordinator }, async (request, reply) => {
    const auth = authOf(request);
    const { id, areaId } = z.object({ id: uuidSchema, areaId: uuidSchema }).parse(request.params);
    const access = await operationAccess(ctx, auth, id);
    assertActive(access);
    const [a] = await query<{ id: string }>(ctx.db, sql`select area_id as id from area where area_id = ${areaId} and operation_id = ${id}`);
    if (!a) throw notFound('area_not_found');
    const ids = await query<{ id: string }>(
      ctx.db,
      sql`select h.household_id as id from household h
           where h.area_id = ${areaId}
             and coalesce(h.link_group_id, h.household_id) not in (${servedGroups(id)})`,
    );
    const releaseId = uuidv7();
    await ctx.db.transaction(async (tx) => {
      await lockOperationFeed(tx, id);
      await tx.insert(unservedRelease).values({
        id: releaseId,
        operationId: id,
        areaId,
        organisationId: auth.organisationId as string,
        releasedBy: auth.userId,
        householdIds: ids.map((i) => i.id),
      });
      await audit(tx, ctx.crypto, { userId: auth.userId, organisationId: auth.organisationId, deviceId: auth.deviceId }, {
        action: 'unserved.released',
        entityType: 'area',
        entityId: areaId,
        operationId: id,
        details: { count: ids.length },
      });
      const volunteers = await query<{ user_id: string }>(
        tx,
        sql`select user_id from app_user where organisation_id = ${auth.organisationId} and status = 'active'
              and role in ('FIELD_VOLUNTEER','GROUP_COORDINATOR') and user_id <> ${auth.userId}`,
      );
      await notify(tx, volunteers.map((v) => v.user_id), 'unserved.released', { count: ids.length, areaId }, '/field/unserved');
    });
    return reply.status(201).send({ id: releaseId, count: ids.length });
  });

  app.get('/api/operations/:id/releases', { preHandler: coordinator }, async (request) => {
    const auth = authOf(request);
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    await operationAccess(ctx, auth, id);
    const rows = await ctx.db
      .select()
      .from(unservedRelease)
      .where(eq(unservedRelease.operationId, id));
    return {
      releases: rows
        .filter((r) => r.organisationId === auth.organisationId)
        .map((r) => ({ id: r.id, areaId: r.areaId, count: r.householdIds.length, releasedAt: r.releasedAt })),
    };
  });
}
