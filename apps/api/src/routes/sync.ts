import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  pullRequestSchema,
  uuidSchema,
  type DistributionDTO,
  type HouseholdDTO,
  type PullResponse,
  type UnservedReleaseDTO,
} from '@relief/shared';
import { z } from 'zod';
import { authOf, operationAccess, requireAuth } from '../auth/guard.js';
import { query } from '../db/client.js';
import { area, device, reliefItem } from '../db/schema.js';
import { badRequest, forbidden } from '../lib/errors.js';
import { processPush } from '../services/sync.js';
import { selectDistributions, selectHouseholds, toHouseholdDTO } from '../services/views.js';

export async function syncRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;
  const field = requireAuth(ctx, 'FIELD_VOLUNTEER', 'GROUP_COORDINATOR');

  // FR14: batched, idempotent, resumable upload.
  app.post('/api/sync/push', { preHandler: field, bodyLimit: 512 * 1024 }, async (request) => {
    return processPush(ctx, authOf(request), request.body);
  });

  // UC10: everything a device needs before going offline for an operation.
  app.get('/api/sync/bootstrap', { preHandler: field }, async (request) => {
    const auth = authOf(request);
    const { operationId } = z.object({ operationId: uuidSchema }).parse(request.query);
    const access = await operationAccess(ctx, auth, operationId);
    if (access.relation !== 'member') throw forbidden('organisation_not_member');
    const [dev] = await ctx.db
      .select({ prefix: device.shortCodePrefix, offset: device.lastClockOffsetMs })
      .from(device)
      .where(eq(device.id, auth.deviceId as string));
    const areas = await ctx.db
      .select({
        id: area.id,
        operationId: area.operationId,
        upazila: area.upazila,
        unionName: area.unionName,
        ward: area.ward,
        upazilaBn: area.upazilaBn,
        unionBn: area.unionBn,
      })
      .from(area)
      .where(eq(area.operationId, operationId))
      .orderBy(asc(area.upazila), asc(area.unionName), asc(area.ward));
    const items = await ctx.db
      .select({
        id: reliefItem.id,
        operationId: reliefItem.operationId,
        itemName: reliefItem.itemName,
        itemNameBn: reliefItem.itemNameBn,
        unit: reliefItem.unit,
        active: reliefItem.active,
      })
      .from(reliefItem)
      .where(eq(reliefItem.operationId, operationId));
    const counts = await query<{ area_id: string; n: number }>(
      ctx.db,
      sql`select area_id, count(*)::int as n from household where operation_id = ${operationId} group by area_id`,
    );
    return {
      operationStatus: access.status,
      areas: areas.map((a) => ({ ...a, householdCount: counts.find((c) => c.area_id === a.id)?.n ?? 0 })),
      items,
      devicePrefix: dev?.prefix,
      // C5: per-operation phone HMAC key for offline exact-match search; the pepper never leaves the server.
      phoneKey: ctx.crypto.operationHmacKey(operationId).toString('base64'),
      serverTime: ctx.now().toISOString(),
    };
  });

  // FR15: shared updates for the device's selected areas, per-area cursors.
  app.post('/api/sync/pull', { preHandler: field }, async (request): Promise<PullResponse> => {
    const auth = authOf(request);
    const input = pullRequestSchema.parse(request.body);
    const access = await operationAccess(ctx, auth, input.operationId);
    if (access.relation !== 'member') throw forbidden('organisation_not_member');
    const areaIds = input.areas.map((a) => a.areaId);
    if (areaIds.length > 0) {
      const valid = await ctx.db
        .select({ id: area.id })
        .from(area)
        .where(and(eq(area.operationId, input.operationId), inArray(area.id, areaIds)));
      if (valid.length !== new Set(areaIds).size) throw badRequest('invalid_area');
    }
    const perArea = Math.max(100, Math.floor(input.limit / Math.max(1, areaIds.length)));
    const households: HouseholdDTO[] = [];
    const distributions: DistributionDTO[] = [];
    const areaCursors: Record<string, string> = {};
    let hasMore = false;

    for (const { areaId, cursor } of input.areas) {
      const c = BigInt(cursor);
      const hs = (
        await selectHouseholds(
          ctx.db,
          sql`h.area_id = ${areaId} and h.server_seq > ${c.toString()}::bigint`,
          sql`order by h.server_seq limit ${perArea}`,
        )
      ).map((r) => toHouseholdDTO(r, auth.organisationId));
      const ds = await selectDistributions(
        ctx.db,
        sql`d.area_id = ${areaId} and d.server_seq > ${c.toString()}::bigint`,
        sql`order by d.server_seq limit ${perArea}`,
      );
      // Both tables share one sequence: the area is complete only up to the lower of the two page ends.
      const INF = BigInt('9223372036854775807');
      const hEnd = hs.length === perArea ? BigInt((hs.at(-1) as HouseholdDTO).serverSeq) : INF;
      const dEnd = ds.length === perArea ? BigInt((ds.at(-1) as DistributionDTO).serverSeq) : INF;
      const completeTo = hEnd < dEnd ? hEnd : dEnd;
      const hKeep = hs.filter((h) => BigInt(h.serverSeq) <= completeTo);
      const dKeep = ds.filter((d) => BigInt(d.serverSeq) <= completeTo);
      households.push(...hKeep);
      distributions.push(...dKeep);
      const seen = [...hKeep.map((h) => BigInt(h.serverSeq)), ...dKeep.map((d) => BigInt(d.serverSeq))];
      const next = completeTo !== INF ? completeTo : seen.reduce((m, v) => (v > m ? v : m), c);
      areaCursors[areaId] = (next > c ? next : c).toString();
      if (completeTo !== INF) hasMore = true;
    }

    // Unserved lists released to this organisation (UC21 step 5).
    const releaseRows = await query<{
      id: string;
      operation_id: string;
      area_id: string;
      household_ids: string[];
      released_at: Date;
      released_by_name: string;
      server_seq: string;
    }>(
      ctx.db,
      sql`select r.id, r.operation_id, r.area_id, r.household_ids, r.released_at, u.full_name as released_by_name,
                 r.server_seq::text
            from unserved_release r join app_user u on u.user_id = r.released_by
           where r.organisation_id = ${auth.organisationId} and r.operation_id = ${input.operationId}
             and r.server_seq > ${input.globalCursor}::bigint
           order by r.server_seq limit 200`,
    );
    const releases: UnservedReleaseDTO[] = releaseRows.map((r) => ({
      id: r.id,
      operationId: r.operation_id,
      areaId: r.area_id,
      householdIds: r.household_ids,
      releasedAt: new Date(r.released_at).toISOString(),
      releasedByName: r.released_by_name,
    }));
    if (releaseRows.length === 200) hasMore = true;
    const globalCursor = releaseRows.at(-1)?.server_seq ?? input.globalCursor;

    const areas = await ctx.db
      .select({
        id: area.id,
        operationId: area.operationId,
        upazila: area.upazila,
        unionName: area.unionName,
        ward: area.ward,
        upazilaBn: area.upazilaBn,
        unionBn: area.unionBn,
      })
      .from(area)
      .where(eq(area.operationId, input.operationId));
    const items = await ctx.db
      .select({
        id: reliefItem.id,
        operationId: reliefItem.operationId,
        itemName: reliefItem.itemName,
        itemNameBn: reliefItem.itemNameBn,
        unit: reliefItem.unit,
        active: reliefItem.active,
      })
      .from(reliefItem)
      .where(eq(reliefItem.operationId, input.operationId));

    return {
      households,
      distributions,
      areaCursors,
      globalCursor,
      items,
      areas,
      releases,
      operationStatus: access.status,
      hasMore,
      serverTime: ctx.now().toISOString(),
    };
  });
}
