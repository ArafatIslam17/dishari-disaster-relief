import { randomBytes } from 'node:crypto';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { parse as parseCsv } from 'csv-parse/sync';
import {
  addOperationAdminSchema,
  areaCsvSchema,
  areaSchema,
  closeOperationSchema,
  createOperationSchema,
  reasonSchema,
  reliefItemPatchSchema,
  reliefItemSchema,
  uuidSchema,
  uuidv7,
  type AreaInput,
} from '@relief/shared';
import { z } from 'zod';
import { assertActive, authOf, operationAccess, requireAuth, requireOperationAdmin } from '../auth/guard.js';
import type { AppContext, AuthInfo } from '../context.js';
import { query } from '../db/client.js';
import {
  appUser,
  area,
  disasterType,
  invite,
  operation,
  operationAdmin,
  operationKey,
  operationMembership,
  organisation,
  reliefItem,
} from '../db/schema.js';
import { audit, notify } from '../lib/audit.js';
import { randomToken, sha256Hex } from '../lib/crypto.js';
import { badRequest, conflictError, forbidden, notFound } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { activeUserIds } from './auth.js';

const opParams = z.object({ id: uuidSchema });
const actorOf = (auth: AuthInfo) => ({ userId: auth.userId, organisationId: auth.organisationId, deviceId: auth.deviceId });
const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

export function areaKeys(a: { upazila: string; unionName: string; ward: string }) {
  return { unionKey: `${key(a.upazila)}|${key(a.unionName)}`, wardKey: key(a.ward) };
}

async function operationAdminIds(ctx: AppContext, operationId: string): Promise<string[]> {
  const rows = await ctx.db
    .select({ id: operationAdmin.userId })
    .from(operationAdmin)
    .innerJoin(appUser, eq(appUser.id, operationAdmin.userId))
    .where(and(eq(operationAdmin.operationId, operationId), eq(appUser.status, 'active')));
  return rows.map((r) => r.id);
}
export { operationAdminIds };

export async function operationRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;
  const authed = requireAuth(ctx);
  const opAdmin = requireAuth(ctx, 'OPERATION_ADMINISTRATOR');

  app.get('/api/disaster-types', { preHandler: authed }, async () => {
    const rows = await ctx.db.select().from(disasterType).orderBy(asc(disasterType.nameEn));
    return { disasterTypes: rows };
  });

  // Operations visible to the caller.
  app.get('/api/operations', { preHandler: authed }, async (request) => {
    const auth = authOf(request);
    const rows = await query<{
      id: string;
      name: string;
      status: string;
      start_date: string;
      end_date: string | null;
      closed_at: Date | null;
      disaster_en: string;
      disaster_bn: string;
      membership_status: string | null;
      relation: string;
    }>(
      ctx.db,
      sql`select o.operation_id as id, o.name, o.status, o.start_date::text, o.end_date::text, o.closed_at,
                 dt.name_en as disaster_en, dt.name_bn as disaster_bn,
                 m.status as membership_status,
                 case when oa.user_id is not null then 'admin'
                      when ob.user_id is not null then 'observer'
                      when m.status = 'approved' then 'member'
                      when ${auth.role} = 'SYSTEM_ADMINISTRATOR' then 'system'
                      else 'none' end as relation
            from operation o
            join disaster_type dt on dt.id = o.disaster_type_id
            left join operation_admin oa on oa.operation_id = o.operation_id and oa.user_id = ${auth.userId}
            left join operation_observer ob on ob.operation_id = o.operation_id and ob.user_id = ${auth.userId}
            left join operation_membership m on m.operation_id = o.operation_id
                  and m.organisation_id = ${auth.organisationId ?? null}::uuid
           where ${auth.role} = 'SYSTEM_ADMINISTRATOR'
              or oa.user_id is not null
              or ob.user_id is not null
              or m.status = 'approved'
              or (${auth.role} = 'GROUP_COORDINATOR' and o.status = 'active')
           order by o.status, o.created_at desc`,
    );
    return {
      operations: rows.map((r) => ({
        id: r.id,
        name: r.name,
        status: r.status,
        startDate: r.start_date,
        endDate: r.end_date,
        closedAt: r.closed_at,
        disasterType: { en: r.disaster_en, bn: r.disaster_bn },
        membershipStatus: r.membership_status,
        relation: r.relation,
      })),
    };
  });

  // UC06 Create operation
  app.post('/api/operations', { preHandler: opAdmin }, async (request, reply) => {
    const auth = authOf(request);
    const input = parse(createOperationSchema, request.body);
    const [dt] = await ctx.db.select().from(disasterType).where(eq(disasterType.id, input.disasterTypeId));
    if (!dt || !dt.active) throw badRequest('disaster_type_invalid');
    const id = uuidv7();
    await ctx.db.transaction(async (tx) => {
      await tx.insert(operation).values({
        id,
        name: input.name,
        disasterTypeId: input.disasterTypeId,
        startDate: input.startDate,
        status: 'active',
        createdBy: auth.userId,
      });
      await tx.insert(operationAdmin).values({ operationId: id, userId: auth.userId, addedBy: auth.userId });
      await tx.insert(operationKey).values({ operationId: id, wrappedKey: ctx.crypto.wrap(randomBytes(32)) });
      await audit(tx, ctx.crypto, actorOf(auth), {
        action: 'operation.created',
        entityType: 'operation',
        entityId: id,
        operationId: id,
        details: { name: input.name },
      });
    });
    return reply.status(201).send({ id });
  });

  app.get('/api/operations/:id', { preHandler: authed }, async (request) => {
    const auth = authOf(request);
    const { id } = opParams.parse(request.params);
    const access = await operationAccess(ctx, auth, id);
    const [op] = await query<Record<string, unknown>>(
      ctx.db,
      sql`select o.operation_id as id, o.name, o.status, o.start_date::text as "startDate", o.end_date::text as "endDate",
                 o.closed_at as "closedAt", o.redacted_at as "redactedAt",
                 dt.name_en as "disasterEn", dt.name_bn as "disasterBn",
                 (select count(*)::int from area a where a.operation_id = o.operation_id) as "areaCount",
                 (select count(*)::int from relief_item i where i.operation_id = o.operation_id) as "itemCount",
                 (select count(*)::int from operation_membership m where m.operation_id = o.operation_id and m.status = 'approved') as "memberCount",
                 (select count(*)::int from operation_membership m where m.operation_id = o.operation_id and m.status = 'pending') as "pendingJoinCount"
            from operation o join disaster_type dt on dt.id = o.disaster_type_id
           where o.operation_id = ${id}`,
    );
    return { operation: { ...op, relation: access.relation } };
  });

  // UC06 4.a Close operation (confirmation required; Fig 5.12 has no reopen).
  app.post('/api/operations/:id/close', { preHandler: opAdmin }, async (request) => {
    const auth = authOf(request);
    const { id } = opParams.parse(request.params);
    parse(closeOperationSchema, request.body);
    const access = await requireOperationAdmin(ctx, auth, id);
    assertActive(access);
    const now = ctx.now();
    await ctx.db.transaction(async (tx) => {
      await tx
        .update(operation)
        .set({ status: 'closed', closedAt: now, closedBy: auth.userId, endDate: now.toISOString().slice(0, 10) })
        .where(eq(operation.id, id));
      await audit(tx, ctx.crypto, actorOf(auth), {
        action: 'operation.closed',
        entityType: 'operation',
        entityId: id,
        operationId: id,
      });
    });
    return { ok: true };
  });

  // Administrator team (DECISIONS C22)
  app.get('/api/operations/:id/admins', { preHandler: opAdmin }, async (request) => {
    const { id } = opParams.parse(request.params);
    await requireOperationAdmin(ctx, authOf(request), id);
    const rows = await ctx.db
      .select({ userId: appUser.id, fullName: appUser.fullName, addedAt: operationAdmin.addedAt })
      .from(operationAdmin)
      .innerJoin(appUser, eq(appUser.id, operationAdmin.userId))
      .where(eq(operationAdmin.operationId, id));
    return { admins: rows };
  });

  app.post('/api/operations/:id/admins', { preHandler: opAdmin }, async (request) => {
    const auth = authOf(request);
    const { id } = opParams.parse(request.params);
    const { mobile } = parse(addOperationAdminSchema, request.body);
    await requireOperationAdmin(ctx, auth, id);
    const [user] = await ctx.db.select().from(appUser).where(eq(appUser.mobileNumber, mobile));
    if (!user || user.role !== 'OPERATION_ADMINISTRATOR' || user.status !== 'active') {
      throw badRequest('not_an_active_operation_admin');
    }
    await ctx.db.insert(operationAdmin).values({ operationId: id, userId: user.id, addedBy: auth.userId }).onConflictDoNothing();
    await audit(ctx.db, ctx.crypto, actorOf(auth), {
      action: 'operation.admin_added',
      entityType: 'user',
      entityId: user.id,
      operationId: id,
    });
    return { ok: true };
  });

  // ---------- Areas (UC07, FR05) ----------
  app.get('/api/operations/:id/areas', { preHandler: authed }, async (request) => {
    const { id } = opParams.parse(request.params);
    await operationAccess(ctx, authOf(request), id);
    const rows = await ctx.db
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
      .where(eq(area.operationId, id))
      .orderBy(asc(area.upazila), asc(area.unionName), asc(area.ward));
    return { areas: rows };
  });

  async function insertAreas(operationId: string, rows: AreaInput[]) {
    const parsed = rows.map((r) => areaSchema.parse(r));
    const values = parsed.map((a) => ({
      id: uuidv7(),
      operationId,
      upazila: a.upazila,
      unionName: a.unionName,
      ward: a.ward,
      upazilaBn: a.upazilaBn ?? null,
      unionBn: a.unionBn ?? null,
      ...areaKeys(a),
    }));
    if (values.length === 0) return [];
    return ctx.db.insert(area).values(values).onConflictDoNothing().returning({ id: area.id });
  }

  app.post('/api/operations/:id/areas', { preHandler: opAdmin }, async (request, reply) => {
    const auth = authOf(request);
    const { id } = opParams.parse(request.params);
    const input = parse(areaSchema, request.body);
    assertActive(await requireOperationAdmin(ctx, auth, id));
    const inserted = await insertAreas(id, [input]);
    if (inserted.length === 0) throw conflictError('area_exists'); // UC07 4.a
    await audit(ctx.db, ctx.crypto, actorOf(auth), {
      action: 'area.added',
      entityType: 'area',
      entityId: inserted[0]?.id,
      operationId: id,
    });
    return reply.status(201).send({ id: inserted[0]?.id });
  });

  // UC07 2.a: CSV import; valid rows imported, rejected rows listed.
  app.post('/api/operations/:id/areas/import', { preHandler: opAdmin, bodyLimit: 3 * 1024 * 1024 }, async (request) => {
    const auth = authOf(request);
    const { id } = opParams.parse(request.params);
    const { csv } = parse(areaCsvSchema, request.body);
    assertActive(await requireOperationAdmin(ctx, auth, id));
    let records: Record<string, string>[];
    try {
      records = parseCsv(csv.replace(/^ /, ''), {
        columns: (header: string[]) => header.map((h) => h.trim().toLowerCase().replace(/\s+/g, '_')),
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
      });
    } catch {
      throw badRequest('csv_unreadable');
    }
    if (records.length > 5000) throw badRequest('csv_too_many_rows');
    const existing = await ctx.db
      .select({ unionKey: area.unionKey, wardKey: area.wardKey })
      .from(area)
      .where(eq(area.operationId, id));
    const seen = new Set(existing.map((e) => `${e.unionKey}#${e.wardKey}`));
    const valid: AreaInput[] = [];
    const rejected: { line: number; reason: string; row: Record<string, string> }[] = [];
    records.forEach((r, i) => {
      const line = i + 2; // header is line 1
      const candidate = {
        upazila: r.upazila ?? '',
        unionName: r.union ?? r.union_name ?? '',
        ward: r.ward ?? '',
        upazilaBn: r.upazila_bn || undefined,
        unionBn: r.union_bn || undefined,
      };
      const check = areaSchema.safeParse(candidate);
      if (!check.success) {
        rejected.push({ line, reason: `invalid:${check.error.issues.map((x) => x.path.join('.')).join(',')}`, row: r });
        return;
      }
      const k = areaKeys(check.data);
      const sig = `${k.unionKey}#${k.wardKey}`;
      if (seen.has(sig)) {
        rejected.push({ line, reason: 'duplicate', row: r });
        return;
      }
      seen.add(sig);
      valid.push(candidate);
    });
    const inserted = await insertAreas(id, valid);
    await audit(ctx.db, ctx.crypto, actorOf(auth), {
      action: 'area.imported',
      entityType: 'operation',
      entityId: id,
      operationId: id,
      details: { imported: inserted.length, rejected: rejected.length },
    });
    return { imported: inserted.length, rejected };
  });

  app.delete('/api/operations/:id/areas/:areaId', { preHandler: opAdmin }, async (request) => {
    const auth = authOf(request);
    const { id, areaId } = z.object({ id: uuidSchema, areaId: uuidSchema }).parse(request.params);
    assertActive(await requireOperationAdmin(ctx, auth, id));
    const [used] = await query<{ n: number }>(
      ctx.db,
      sql`select (select count(*) from household where area_id = ${areaId})
               + (select count(*) from distribution where area_id = ${areaId}) as n`,
    );
    if (Number(used?.n ?? 0) > 0) throw conflictError('area_in_use');
    const deleted = await ctx.db
      .delete(area)
      .where(and(eq(area.id, areaId), eq(area.operationId, id)))
      .returning({ id: area.id });
    if (deleted.length === 0) throw notFound('area_not_found');
    await audit(ctx.db, ctx.crypto, actorOf(auth), { action: 'area.removed', entityType: 'area', entityId: areaId, operationId: id });
    return { ok: true };
  });

  // ---------- Relief items (UC07, FR05) ----------
  app.get('/api/operations/:id/items', { preHandler: authed }, async (request) => {
    const { id } = opParams.parse(request.params);
    await operationAccess(ctx, authOf(request), id);
    const rows = await ctx.db
      .select({
        id: reliefItem.id,
        operationId: reliefItem.operationId,
        itemName: reliefItem.itemName,
        itemNameBn: reliefItem.itemNameBn,
        unit: reliefItem.unit,
        active: reliefItem.active,
      })
      .from(reliefItem)
      .where(eq(reliefItem.operationId, id))
      .orderBy(asc(reliefItem.itemName));
    return { items: rows };
  });

  app.post('/api/operations/:id/items', { preHandler: opAdmin }, async (request, reply) => {
    const auth = authOf(request);
    const { id } = opParams.parse(request.params);
    const input = parse(reliefItemSchema, request.body);
    assertActive(await requireOperationAdmin(ctx, auth, id));
    const itemId = uuidv7();
    const inserted = await ctx.db
      .insert(reliefItem)
      .values({
        id: itemId,
        operationId: id,
        itemName: input.itemName,
        nameKey: key(input.itemName),
        itemNameBn: input.itemNameBn ?? null,
        unit: input.unit,
      })
      .onConflictDoNothing()
      .returning({ id: reliefItem.id });
    if (inserted.length === 0) throw conflictError('item_exists');
    await audit(ctx.db, ctx.crypto, actorOf(auth), { action: 'item.added', entityType: 'relief_item', entityId: itemId, operationId: id });
    return reply.status(201).send({ id: itemId });
  });

  app.patch('/api/operations/:id/items/:itemId', { preHandler: opAdmin }, async (request) => {
    const auth = authOf(request);
    const { id, itemId } = z.object({ id: uuidSchema, itemId: uuidSchema }).parse(request.params);
    const input = parse(reliefItemPatchSchema, request.body);
    assertActive(await requireOperationAdmin(ctx, auth, id));
    const updated = await ctx.db
      .update(reliefItem)
      .set({
        ...(input.itemNameBn !== undefined ? { itemNameBn: input.itemNameBn } : {}),
        ...(input.unit !== undefined ? { unit: input.unit } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      })
      .where(and(eq(reliefItem.id, itemId), eq(reliefItem.operationId, id)))
      .returning({ id: reliefItem.id });
    if (updated.length === 0) throw notFound('item_not_found');
    await audit(ctx.db, ctx.crypto, actorOf(auth), {
      action: 'item.updated',
      entityType: 'relief_item',
      entityId: itemId,
      operationId: id,
      details: { fields: Object.keys(input) },
    });
    return { ok: true };
  });

  // ---------- Join requests (UC08, UC09, FR06) ----------
  app.post('/api/operations/:id/join', { preHandler: requireAuth(ctx, 'GROUP_COORDINATOR') }, async (request, reply) => {
    const auth = authOf(request);
    const { id } = opParams.parse(request.params);
    const [op] = await ctx.db.select({ status: operation.status }).from(operation).where(eq(operation.id, id));
    if (!op) throw notFound('operation_not_found');
    if (op.status !== 'active') throw forbidden('operation_closed');
    const orgId = auth.organisationId as string;
    const [org] = await ctx.db.select({ s: organisation.status }).from(organisation).where(eq(organisation.id, orgId));
    if (org?.s !== 'approved') throw forbidden('organisation_not_approved'); // UC08 QR2
    const [existing] = await ctx.db
      .select()
      .from(operationMembership)
      .where(and(eq(operationMembership.operationId, id), eq(operationMembership.organisationId, orgId)));
    if (existing && existing.status !== 'rejected') {
      throw conflictError('join_exists', { status: existing.status }); // UC08 3.a
    }
    const now = ctx.now();
    await ctx.db.transaction(async (tx) => {
      if (existing) {
        await tx
          .update(operationMembership)
          .set({ status: 'pending', requestedBy: auth.userId, requestedAt: now, reviewedAt: null, reviewedBy: null, rejectionReason: null })
          .where(and(eq(operationMembership.operationId, id), eq(operationMembership.organisationId, orgId)));
      } else {
        await tx.insert(operationMembership).values({ operationId: id, organisationId: orgId, requestedBy: auth.userId, status: 'pending' });
      }
      await audit(tx, ctx.crypto, actorOf(auth), {
        action: 'join.requested',
        entityType: 'organisation',
        entityId: orgId,
        operationId: id,
      });
    });
    await notify(ctx.db, await operationAdminIds(ctx, id), 'join.requested', { operationId: id }, `/app/operations/${id}`);
    return reply.status(201).send({ status: 'pending' });
  });

  app.get('/api/operations/:id/join-requests', { preHandler: opAdmin }, async (request) => {
    const { id } = opParams.parse(request.params);
    await requireOperationAdmin(ctx, authOf(request), id);
    const rows = await ctx.db
      .select({
        organisationId: organisation.id,
        name: organisation.name,
        nameBn: organisation.nameBn,
        orgType: organisation.orgType,
        contactName: organisation.contactName,
        contactPhone: organisation.contactPhone,
        status: operationMembership.status,
        requestedAt: operationMembership.requestedAt,
        reviewedAt: operationMembership.reviewedAt,
        rejectionReason: operationMembership.rejectionReason,
      })
      .from(operationMembership)
      .innerJoin(organisation, eq(organisation.id, operationMembership.organisationId))
      .where(eq(operationMembership.operationId, id))
      .orderBy(sql`case ${operationMembership.status} when 'pending' then 0 else 1 end`, desc(operationMembership.requestedAt));
    return { requests: rows };
  });

  const decide = (decision: 'approved' | 'rejected') => async (request: FastifyRequest) => {
    const auth = authOf(request);
    const { id, orgId } = z.object({ id: uuidSchema, orgId: uuidSchema }).parse(request.params);
    const reason = decision === 'rejected' ? parse(reasonSchema, request.body).reason : null;
    assertActive(await requireOperationAdmin(ctx, auth, id));
    const updated = await ctx.db
      .update(operationMembership)
      .set({ status: decision, reviewedAt: ctx.now(), reviewedBy: auth.userId, rejectionReason: reason })
      .where(
        and(
          eq(operationMembership.operationId, id),
          eq(operationMembership.organisationId, orgId),
          eq(operationMembership.status, 'pending'),
        ),
      )
      .returning({ o: operationMembership.organisationId });
    if (updated.length === 0) throw conflictError('not_pending');
    await audit(ctx.db, ctx.crypto, actorOf(auth), {
      action: decision === 'approved' ? 'join.approved' : 'join.rejected',
      entityType: 'organisation',
      entityId: orgId,
      operationId: id,
      details: reason ? { reason } : undefined,
    });
    await notify(ctx.db, await activeUserIds(ctx, 'GROUP_COORDINATOR', orgId), 'join.decided', { operationId: id, decision }, '/app/operations');
    return { ok: true };
  };
  app.post('/api/operations/:id/memberships/:orgId/approve', { preHandler: opAdmin }, decide('approved'));
  app.post('/api/operations/:id/memberships/:orgId/reject', { preHandler: opAdmin }, decide('rejected'));

  // ---------- Observer invites (C3) ----------
  app.post('/api/operations/:id/invites', { preHandler: opAdmin }, async (request, reply) => {
    const auth = authOf(request);
    const { id } = opParams.parse(request.params);
    const body = z.object({ organisationName: z.string().trim().max(100).optional() }).parse(request.body ?? {});
    await requireOperationAdmin(ctx, auth, id);
    const token = randomToken(32);
    const inviteId = uuidv7();
    await ctx.db.insert(invite).values({
      id: inviteId,
      tokenHash: sha256Hex(token),
      operationId: id,
      organisationName: body.organisationName || null,
      invitedBy: auth.userId,
      expiresAt: new Date(ctx.now().getTime() + 7 * 86_400_000),
    });
    await audit(ctx.db, ctx.crypto, actorOf(auth), { action: 'observer.invited', entityType: 'invite', entityId: inviteId, operationId: id });
    // The token is returned once; only its hash is stored.
    return reply.status(201).send({ id: inviteId, path: `/invite/${token}` });
  });

  app.get('/api/operations/:id/invites', { preHandler: opAdmin }, async (request) => {
    const { id } = opParams.parse(request.params);
    await requireOperationAdmin(ctx, authOf(request), id);
    const rows = await ctx.db
      .select({
        id: invite.id,
        organisationName: invite.organisationName,
        expiresAt: invite.expiresAt,
        usedAt: invite.usedAt,
        usedByName: appUser.fullName,
        createdAt: invite.createdAt,
      })
      .from(invite)
      .leftJoin(appUser, eq(appUser.id, invite.usedBy))
      .where(eq(invite.operationId, id))
      .orderBy(desc(invite.createdAt));
    return { invites: rows };
  });

  // Members of an operation, for administrators (UC09 overview).
  app.get('/api/operations/:id/organisations', { preHandler: authed }, async (request) => {
    const { id } = opParams.parse(request.params);
    const access = await operationAccess(ctx, authOf(request), id);
    if (access.relation === 'observer') throw forbidden('role_not_allowed');
    const rows = await ctx.db
      .select({ id: organisation.id, name: organisation.name, nameBn: organisation.nameBn })
      .from(operationMembership)
      .innerJoin(organisation, eq(organisation.id, operationMembership.organisationId))
      .where(and(eq(operationMembership.operationId, id), eq(operationMembership.status, 'approved')));
    return { organisations: rows };
  });
}
