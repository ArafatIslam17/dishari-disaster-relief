import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  flagReviewSchema,
  gpsSchema,
  headNameSchema,
  maskPhone,
  normaliseName,
  phoneSchema,
  resolveConflictSchema,
  uuidSchema,
} from '@relief/shared';
import { z } from 'zod';
import { authOf, operationAccess, requireAuth } from '../auth/guard.js';
import type { AppContext, AuthInfo } from '../context.js';
import { lockOperationFeed, query, type Tx } from '../db/client.js';
import { conflict, distributionFlag, duplicatePair, household } from '../db/schema.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflictError, forbidden, notFound } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { enqueue } from '../services/jobs.js';
import { selectHouseholds, toHouseholdDTO } from '../services/views.js';

const idParams = z.object({ id: uuidSchema });
const listQuery = z.object({
  operationId: uuidSchema,
  status: z.string().max(20).optional(),
});
const actorOf = (auth: AuthInfo) => ({ userId: auth.userId, organisationId: auth.organisationId, deviceId: auth.deviceId });

/** Value shown for a conflicting field; another organisation's mobile is masked (NFR06). */
function displayValue(field: string, raw: string | null, ownOrg: boolean): unknown {
  if (raw === null) return null;
  const v = JSON.parse(raw) as unknown;
  if (field === 'mobile' && !ownOrg && typeof v === 'string') return maskPhone(v);
  if (field === 'gps' && !ownOrg && v) return 'hidden';
  return v;
}

const FIELD_VALUE_SCHEMAS: Record<string, z.ZodTypeAny> = {
  headName: headNameSchema,
  mobile: phoneSchema.nullable(),
  memberCount: z.number().int().min(1).max(50),
  areaId: uuidSchema,
  gps: gpsSchema.nullable(),
};

export async function reviewRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;
  const coordinator = requireAuth(ctx, 'GROUP_COORDINATOR');

  // ---------- Conflicts (UC17, FR17) ----------
  const conflictSelect = (auth: AuthInfo, where: ReturnType<typeof sql>) =>
    query<Record<string, unknown> & { field_name: string; local_value: string | null; server_value: string | null; household_org: string }>(
      ctx.db,
      sql`select c.conflict_id as id, c.operation_id as "operationId", c.household_id as "householdId", h.short_code as "shortCode",
                 c.field_name, c.local_value, c.server_value, c.status, c.created_at as "createdAt",
                 c.resolved_value, c.resolved_at as "resolvedAt", ru.full_name as "resolvedByName",
                 lu.full_name as "localUserName", lo.name as "localOrganisationName", ld.device_label as "localDeviceLabel", c.local_time as "localTime",
                 su.full_name as "serverUserName", so.name as "serverOrganisationName", sd.device_label as "serverDeviceLabel", c.server_time as "serverTime",
                 h.organisation_id as household_org
            from conflict c
            join household h on h.household_id = c.household_id
            left join app_user lu on lu.user_id = c.local_user_id
            left join organisation lo on lo.organisation_id = c.local_organisation_id
            left join device ld on ld.device_id = c.local_device_id
            left join app_user su on su.user_id = c.server_user_id
            left join organisation so on so.organisation_id = c.server_organisation_id
            left join device sd on sd.device_id = c.server_device_id
            left join app_user ru on ru.user_id = c.resolved_by
           where ${where}
             and ${auth.organisationId}::uuid in (h.organisation_id, c.local_organisation_id, c.server_organisation_id)
           order by c.status, c.created_at desc
           limit 500`,
    ).then((rows) =>
      rows.map(({ field_name, local_value, server_value, household_org, resolved_value, ...rest }) => {
        const own = household_org === auth.organisationId;
        return {
          ...rest,
          fieldName: field_name,
          localValue: displayValue(field_name, local_value, own),
          serverValue: displayValue(field_name, server_value, own),
          resolvedValue: displayValue(field_name, resolved_value as string | null, own),
          canResolve: field_name !== 'mobile' || own,
        };
      }),
    );

  app.get('/api/conflicts', { preHandler: coordinator }, async (request) => {
    const auth = authOf(request);
    const q = listQuery.parse(request.query);
    await operationAccess(ctx, auth, q.operationId);
    const status = q.status === 'resolved' ? 'resolved' : 'open';
    return { conflicts: await conflictSelect(auth, sql`c.operation_id = ${q.operationId} and c.status = ${status}`) };
  });

  app.get('/api/conflicts/:id', { preHandler: coordinator }, async (request) => {
    const auth = authOf(request);
    const { id } = idParams.parse(request.params);
    const [row] = await conflictSelect(auth, sql`c.conflict_id = ${id}`);
    if (!row) throw notFound('conflict_not_found');
    return { conflict: row };
  });

  app.post('/api/conflicts/:id/resolve', { preHandler: coordinator }, async (request) => {
    const auth = authOf(request);
    const { id } = idParams.parse(request.params);
    const { value } = parse(resolveConflictSchema, request.body);
    const [c] = await ctx.db.select().from(conflict).where(eq(conflict.id, id));
    if (!c) throw notFound('conflict_not_found');
    const [h] = await ctx.db.select().from(household).where(eq(household.id, c.householdId));
    if (!h) throw notFound('household_not_found');
    const involved = [h.organisationId, c.localOrganisationId, c.serverOrganisationId];
    if (!auth.organisationId || !involved.includes(auth.organisationId)) throw forbidden('other_organisation'); // C28
    if (c.fieldName === 'mobile' && h.organisationId !== auth.organisationId) throw forbidden('mobile_not_editable');
    const schema = FIELD_VALUE_SCHEMAS[c.fieldName];
    if (!schema) throw badRequest('unknown_field');
    const resolved = schema.parse(value) as unknown;
    if (c.fieldName === 'areaId') {
      const ok = await query(ctx.db, sql`select 1 from area where area_id = ${resolved as string} and operation_id = ${h.operationId}`);
      if (ok.length === 0) throw badRequest('invalid_area');
    }
    await ctx.db.transaction(async (tx) => {
      await lockOperationFeed(tx, h.operationId);
      const done = await tx
        .update(conflict)
        .set({ status: 'resolved', resolvedValue: JSON.stringify(resolved), resolvedBy: auth.userId, resolvedAt: ctx.now() })
        .where(and(eq(conflict.id, id), eq(conflict.status, 'open')))
        .returning({ id: conflict.id });
      if (done.length === 0) throw conflictError('already_resolved');
      await applyResolvedValue(ctx, tx, auth, h.id, c.fieldName, resolved);
      await audit(tx, ctx.crypto, actorOf(auth), {
        action: 'conflict.resolved',
        entityType: 'conflict',
        entityId: id,
        operationId: h.operationId,
        changes: { [c.fieldName]: resolved },
        details: { householdId: h.id },
      });
    });
    await enqueue(ctx.db, 'duplicates.score', { householdIds: [h.id] });
    ctx.kickJobs();
    return { ok: true };
  });

  // ---------- Duplicate pairs (UC18, FR19) ----------
  async function loadPair(auth: AuthInfo, id: string) {
    const [pair] = await ctx.db.select().from(duplicatePair).where(eq(duplicatePair.id, id));
    if (!pair) throw notFound('pair_not_found');
    const rows = await selectHouseholds(ctx.db, sql`h.household_id in (${pair.householdAId}, ${pair.householdBId})`);
    if (!rows.some((r) => r.organisation_id === auth.organisationId)) throw forbidden('other_organisation');
    return { pair, rows };
  }

  app.get('/api/duplicates', { preHandler: coordinator }, async (request) => {
    const auth = authOf(request);
    const q = listQuery.parse(request.query);
    await operationAccess(ctx, auth, q.operationId);
    const status = q.status === 'linked' || q.status === 'not_duplicate' ? q.status : 'pending_review';
    const pairs = await query<Record<string, unknown>>(
      ctx.db,
      sql`select p.pair_id as id, p.score::float as score, p.label, p.status, p.signals, p.created_at as "createdAt",
                 p.reviewed_at as "reviewedAt", a.short_code as "shortCodeA", b.short_code as "shortCodeB",
                 a.head_name as "headNameA", b.head_name as "headNameB", oa.name as "organisationA", ob.name as "organisationB"
            from duplicate_pair p
            join household a on a.household_id = p.household_a_id
            join household b on b.household_id = p.household_b_id
            join organisation oa on oa.organisation_id = a.organisation_id
            join organisation ob on ob.organisation_id = b.organisation_id
           where p.operation_id = ${q.operationId} and p.status = ${status}
             and ${auth.organisationId}::uuid in (a.organisation_id, b.organisation_id)
           order by p.score desc, p.created_at
           limit 500`,
    );
    return { pairs };
  });

  app.get('/api/duplicates/:id', { preHandler: coordinator }, async (request) => {
    const auth = authOf(request);
    const { id } = idParams.parse(request.params);
    const { pair, rows } = await loadPair(auth, id);
    const byId = new Map(rows.map((r) => [r.id, toHouseholdDTO(r, auth.organisationId)]));
    const areas = await query<{ area_id: string; upazila: string; union_name: string; ward: string }>(
      ctx.db,
      sql`select area_id, upazila, union_name, ward from area where area_id in (${sql.join(rows.map((r) => sql`${r.area_id}::uuid`), sql`, `)})`,
    );
    return {
      pair: {
        id: pair.id,
        score: Number(pair.score),
        label: pair.label,
        status: pair.status,
        signals: pair.signals,
        reviewedAt: pair.reviewedAt,
        a: byId.get(pair.householdAId),
        b: byId.get(pair.householdBId),
        areas,
      },
    };
  });

  const pairDecision = (to: 'linked' | 'not_duplicate' | 'pending_review', from: string) =>
    async (request: FastifyRequest) => {
      const auth = authOf(request);
      const { id } = idParams.parse(request.params);
      const { pair } = await loadPair(auth, id);
      await ctx.db.transaction(async (tx) => {
        await lockOperationFeed(tx, pair.operationId);
        const updated = await tx
          .update(duplicatePair)
          .set({ status: to, reviewedBy: auth.userId, reviewedAt: ctx.now(), updatedAt: ctx.now() })
          .where(and(eq(duplicatePair.id, id), eq(duplicatePair.status, from)))
          .returning({ id: duplicatePair.id });
        if (updated.length === 0) throw conflictError('status_changed');
        if (to === 'linked' || from === 'linked') await recomputeLinkGroups(tx, [pair.householdAId, pair.householdBId]);
        if (to === 'linked') {
          const ds = await query<{ id: string }>(
            tx,
            sql`select distribution_id as id from distribution where household_id in (${pair.householdAId}, ${pair.householdBId}) and status = 'recorded'`,
          );
          if (ds.length > 0) await enqueue(tx, 'flags.check', { distributionIds: ds.map((d) => d.id) });
        }
        await audit(tx, ctx.crypto, actorOf(auth), {
          action: to === 'linked' ? 'duplicate.linked' : to === 'not_duplicate' ? 'duplicate.not_duplicate' : 'duplicate.unlinked',
          entityType: 'duplicate_pair',
          entityId: id,
          operationId: pair.operationId,
          details: { householdA: pair.householdAId, householdB: pair.householdBId },
        });
      });
      ctx.kickJobs();
      return { ok: true };
    };
  app.post('/api/duplicates/:id/link', { preHandler: coordinator }, pairDecision('linked', 'pending_review'));
  app.post('/api/duplicates/:id/not-duplicate', { preHandler: coordinator }, pairDecision('not_duplicate', 'pending_review'));
  app.post('/api/duplicates/:id/undo', { preHandler: coordinator }, pairDecision('pending_review', 'linked'));

  // ---------- Duplicate distribution flags (UC19, FR20) ----------
  const reviewer = requireAuth(ctx, 'GROUP_COORDINATOR', 'OPERATION_ADMINISTRATOR');
  const flagSelect = (auth: AuthInfo, where: ReturnType<typeof sql>) =>
    query<Record<string, unknown>>(
      ctx.db,
      sql`select f.flag_id as id, f.operation_id as "operationId", f.status, f.note, f.created_at as "createdAt",
                 f.reviewed_at as "reviewedAt", ru.full_name as "reviewedByName",
                 i.item_name as "itemName", i.item_name_bn as "itemNameBn", i.unit,
                 d1.distribution_id as "firstId", d1.distributed_at as "firstAt", o1.name as "firstOrganisation",
                 (select quantity from distribution_item where distribution_id = d1.distribution_id and item_id = f.item_id) as "firstQuantity",
                 d1.status as "firstStatus", h1.short_code as "firstShortCode", d1.household_id as "firstHouseholdId",
                 d2.distribution_id as "secondId", d2.distributed_at as "secondAt", o2.name as "secondOrganisation",
                 (select quantity from distribution_item where distribution_id = d2.distribution_id and item_id = f.item_id) as "secondQuantity",
                 d2.status as "secondStatus", h2.short_code as "secondShortCode", d2.household_id as "secondHouseholdId",
                 exists (select 1 from duplicate_pair p where p.status = 'pending_review'
                          and (p.household_a_id in (d1.household_id, d2.household_id) or p.household_b_id in (d1.household_id, d2.household_id)))
                   as "householdInDuplicateReview"
            from distribution_flag f
            join relief_item i on i.item_id = f.item_id
            join distribution d1 on d1.distribution_id = f.first_distribution_id
            join distribution d2 on d2.distribution_id = f.second_distribution_id
            join organisation o1 on o1.organisation_id = d1.organisation_id
            join organisation o2 on o2.organisation_id = d2.organisation_id
            left join household h1 on h1.household_id = d1.household_id
            left join household h2 on h2.household_id = d2.household_id
            left join app_user ru on ru.user_id = f.reviewed_by
           where ${where}
             and (${auth.role} = 'OPERATION_ADMINISTRATOR' or ${auth.organisationId ?? null}::uuid in (d1.organisation_id, d2.organisation_id))
           order by f.status, f.created_at desc
           limit 500`,
    );

  app.get('/api/flags', { preHandler: reviewer }, async (request) => {
    const auth = authOf(request);
    const q = listQuery.parse(request.query);
    await operationAccess(ctx, auth, q.operationId);
    const status = q.status === 'reviewed' ? sql`f.status <> 'pending'` : sql`f.status = 'pending'`;
    return { flags: await flagSelect(auth, sql`f.operation_id = ${q.operationId} and ${status}`) };
  });

  app.get('/api/flags/:id', { preHandler: reviewer }, async (request) => {
    const auth = authOf(request);
    const { id } = idParams.parse(request.params);
    const [flag] = await ctx.db.select({ op: distributionFlag.operationId }).from(distributionFlag).where(eq(distributionFlag.id, id));
    if (!flag) throw notFound('flag_not_found');
    await operationAccess(ctx, auth, flag.op);
    const [row] = await flagSelect(auth, sql`f.flag_id = ${id}`);
    if (!row) throw forbidden('other_organisation');
    return { flag: row };
  });

  app.post('/api/flags/:id/review', { preHandler: reviewer }, async (request) => {
    const auth = authOf(request);
    const { id } = idParams.parse(request.params);
    const input = parse(flagReviewSchema, request.body);
    const [flag] = await ctx.db.select().from(distributionFlag).where(eq(distributionFlag.id, id));
    if (!flag) throw notFound('flag_not_found');
    await operationAccess(ctx, auth, flag.operationId);
    const [visible] = await flagSelect(auth, sql`f.flag_id = ${id}`);
    if (!visible) throw forbidden('other_organisation');
    await ctx.db.transaction(async (tx) => {
      const updated = await tx
        .update(distributionFlag)
        .set({ status: input.decision, note: input.note, reviewedBy: auth.userId, reviewedAt: ctx.now() })
        .where(and(eq(distributionFlag.id, id), eq(distributionFlag.status, 'pending')))
        .returning({ id: distributionFlag.id });
      if (updated.length === 0) throw conflictError('already_reviewed');
      await audit(tx, ctx.crypto, actorOf(auth), {
        action: `flag.${input.decision}`,
        entityType: 'distribution_flag',
        entityId: id,
        operationId: flag.operationId,
        details: { note: input.note },
      });
    });
    return { ok: true };
  });
}

/** Writes a coordinator's chosen value as a new household version (UC17 step 5). */
async function applyResolvedValue(ctx: AppContext, tx: Tx, auth: AuthInfo, householdId: string, field: string, value: unknown) {
  const [h] = await tx.select().from(household).where(eq(household.id, householdId)).for('update');
  if (!h) throw notFound('household_not_found');
  const version = h.version + 1;
  const stamps = { ...(h.fieldStamps as Record<string, unknown>) };
  stamps[field] = {
    version,
    deviceId: auth.deviceId ?? 'dashboard',
    deviceSeq: 0,
    userId: auth.userId,
    organisationId: auth.organisationId,
    at: ctx.now().toISOString(),
  };
  const set: Record<string, unknown> = { version, fieldStamps: stamps, updatedAt: ctx.now(), serverSeq: sql`nextval('change_seq')` };
  if (field === 'headName') {
    set.headName = value;
    set.nameNorm = normaliseName(value as string);
  } else if (field === 'mobile') {
    set.mobileNumber = value;
    set.mobileHmac = value ? ctx.crypto.phoneHmac(h.operationId, value as string) : null;
    set.mobileMasked = value ? maskPhone(value as string) : null;
  } else if (field === 'memberCount') set.memberCount = value;
  else if (field === 'areaId') set.areaId = value;
  else if (field === 'gps') {
    const g = value as { lat: number; lng: number } | null;
    set.gpsLat = g ? g.lat.toFixed(5) : null;
    set.gpsLng = g ? g.lng.toFixed(5) : null;
  }
  await tx.update(household).set(set).where(eq(household.id, householdId));
}

/**
 * Link groups are the connected components of `linked` pairs. Recomputed for every household
 * reachable from the touched ones, so linking and undoing are exact inverses (FR19).
 */
async function recomputeLinkGroups(tx: Tx, seeds: string[]): Promise<void> {
  const component = await query<{ id: string }>(
    tx,
    sql`with recursive reach(id) as (
          select unnest(${sql`array[${sql.join(seeds.map((s) => sql`${s}::uuid`), sql`, `)}]`})
          union
          select case when p.household_a_id = r.id then p.household_b_id else p.household_a_id end
            from duplicate_pair p join reach r on r.id in (p.household_a_id, p.household_b_id)
           where p.status = 'linked'
        )
        select distinct id from reach
        union
        select h.household_id from household h
         where h.link_group_id in (select link_group_id from household where household_id in (${sql.join(seeds.map((s) => sql`${s}::uuid`), sql`, `)}) and link_group_id is not null)`,
  );
  const ids = component.map((c) => c.id);
  const parent = new Map(ids.map((i) => [i, i]));
  const find = (x: string): string => {
    const p = parent.get(x) ?? x;
    if (p === x) return x;
    const r = find(p);
    parent.set(x, r);
    return r;
  };
  const links = await query<{ a: string; b: string }>(
    tx,
    sql`select household_a_id as a, household_b_id as b from duplicate_pair
         where status = 'linked' and household_a_id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`,
  );
  for (const l of links) {
    if (!parent.has(l.b)) continue;
    const ra = find(l.a);
    const rb = find(l.b);
    if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  }
  const size = new Map<string, number>();
  for (const i of ids) size.set(find(i), (size.get(find(i)) ?? 0) + 1);
  for (const i of ids) {
    const root = find(i);
    const group = (size.get(root) ?? 1) > 1 ? root : null;
    await tx.execute(
      sql`update household set link_group_id = ${group}, server_seq = nextval('change_seq'), updated_at = now()
           where household_id = ${i} and link_group_id is distinct from ${group}::uuid`,
    );
  }
}
