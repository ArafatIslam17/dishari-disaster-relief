import { and, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { approveMemberSchema, assignRoleSchema, reasonSchema, uuidSchema, type Role } from '@relief/shared';
import { z } from 'zod';
import { authOf, requireAuth } from '../auth/guard.js';
import { hashPassword, revokeAllForDevice, revokeAllForUser } from '../auth/tokens.js';
import type { AppContext, AuthInfo } from '../context.js';
import { appUser, device, organisation } from '../db/schema.js';
import { audit } from '../lib/audit.js';
import { temporaryPassword } from '../lib/crypto.js';
import { badRequest, conflictError, forbidden, notFound } from '../lib/errors.js';
import { parse } from '../lib/validate.js';

const idParams = z.object({ id: uuidSchema });

/** Loads a target user and enforces "coordinators act only inside their own organisation" (UC05 QR1, 3.d). */
async function loadManagedUser(ctx: AppContext, auth: AuthInfo, userId: string) {
  const [target] = await ctx.db.select().from(appUser).where(eq(appUser.id, userId));
  if (!target) throw notFound('user_not_found');
  if (auth.role === 'SYSTEM_ADMINISTRATOR') return target;
  if (auth.role === 'GROUP_COORDINATOR' && target.organisationId && target.organisationId === auth.organisationId) {
    return target;
  }
  throw forbidden('other_organisation');
}

/**
 * Account approval hierarchy. A self-registered field volunteer is approved by a Group Coordinator of
 * their own organisation, or (oversight) by an Operation Administrator of an operation that
 * organisation has joined. Operation administrators, and coordinators who registered an
 * organisation, are approved only by the System Administrator.
 */
const adminOrgs = (userId: string) =>
  sql`(select m.organisation_id from operation_membership m
         join operation_admin oa on oa.operation_id = m.operation_id
        where oa.user_id = ${userId} and m.status = 'approved')`;

/** SQL predicate: rows of app_user this caller may approve (status aside). */
function approvableBy(auth: AuthInfo): SQL {
  switch (auth.role) {
    case 'SYSTEM_ADMINISTRATOR':
      return sql`${appUser.role} in ('OPERATION_ADMINISTRATOR', 'GROUP_COORDINATOR')`;
    case 'GROUP_COORDINATOR':
      return sql`(${appUser.role} = 'FIELD_VOLUNTEER' and ${appUser.organisationId} = ${auth.organisationId as string})`;
    case 'OPERATION_ADMINISTRATOR':
      return sql`(${appUser.role} = 'FIELD_VOLUNTEER' and ${appUser.organisationId} in ${adminOrgs(auth.userId)})`;
    default:
      return sql`false`;
  }
}

/** Loads a pending registration and checks the caller sits above it in the approval hierarchy. */
async function loadApprovable(ctx: AppContext, auth: AuthInfo, userId: string) {
  const [target] = await ctx.db.select().from(appUser).where(eq(appUser.id, userId));
  if (!target) throw notFound('user_not_found');
  const [ok] = await ctx.db
    .select({ ok: sql<boolean>`true` })
    .from(appUser)
    .where(and(eq(appUser.id, userId), approvableBy(auth)));
  if (!ok) {
    const sameOrg = auth.role === 'GROUP_COORDINATOR' && target.organisationId === auth.organisationId;
    throw forbidden(sameOrg || target.role !== 'FIELD_VOLUNTEER' ? 'role_not_allowed' : 'other_organisation');
  }
  return target;
}

const actorOf = (auth: AuthInfo) => ({ userId: auth.userId, organisationId: auth.organisationId, deviceId: auth.deviceId });

export async function memberRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;
  const managers = requireAuth(ctx, 'GROUP_COORDINATOR', 'SYSTEM_ADMINISTRATOR');
  const approvers = requireAuth(ctx, 'GROUP_COORDINATOR', 'OPERATION_ADMINISTRATOR', 'SYSTEM_ADMINISTRATOR');

  // UC05 step 1-2: members with role, status and devices.
  app.get('/api/members', { preHandler: approvers }, async (request) => {
    const auth = authOf(request);
    const q = z
      .object({
        status: z.enum(['pending', 'active', 'locked', 'deactivated', 'rejected']).optional(),
        role: z.enum(['FIELD_VOLUNTEER', 'GROUP_COORDINATOR', 'OPERATION_ADMINISTRATOR', 'SYSTEM_ADMINISTRATOR', 'OBSERVER']).optional(),
        q: z.string().trim().max(60).optional(),
      })
      .parse(request.query);
    const filters: (SQL | undefined)[] = [
      q.status ? eq(appUser.status, q.status) : undefined,
      q.role ? eq(appUser.role, q.role) : undefined,
    ];
    if (q.q) {
      const pattern = `%${q.q.replace(/[%_\\]/g, '\\$&')}%`;
      filters.push(or(ilike(appUser.fullName, pattern), ilike(appUser.mobileNumber, pattern)));
    }
    if (auth.role === 'GROUP_COORDINATOR') filters.push(eq(appUser.organisationId, auth.organisationId as string));
    // The pending queue lists only registrations this caller may approve. Operation administrators
    // see nothing else: their view is an approval queue, not the organisations' member lists.
    if (q.status === 'pending' || auth.role === 'OPERATION_ADMINISTRATOR') filters.push(eq(appUser.status, 'pending'), approvableBy(auth));
    const users = await ctx.db
      .select({
        id: appUser.id,
        fullName: appUser.fullName,
        mobile: appUser.mobileNumber,
        role: appUser.role,
        status: appUser.status,
        lockedUntil: appUser.lockedUntil,
        organisationId: appUser.organisationId,
        organisationName: organisation.name,
        createdAt: appUser.createdAt,
        canApprove: sql<boolean>`(${appUser.status} = 'pending' and ${approvableBy(auth)})`,
      })
      .from(appUser)
      .leftJoin(organisation, eq(organisation.id, appUser.organisationId))
      .where(and(...filters))
      .orderBy(sql`case ${appUser.status} when 'pending' then 0 when 'locked' then 1 else 2 end`, desc(appUser.createdAt))
      .limit(500);
    const devices =
      users.length === 0
        ? []
        : await ctx.db
            .select({
              id: device.id,
              userId: device.userId,
              label: device.deviceLabel,
              status: device.status,
              registeredAt: device.registeredAt,
              lastSyncAt: device.lastSyncAt,
            })
            .from(device)
            .where(inArray(device.userId, users.map((u) => u.id)));
    return {
      members: users.map((u) => ({ ...u, devices: devices.filter((d) => d.userId === u.id) })),
    };
  });

  // UC05 step 3-4 (members), C3 (operation administrators, by the System Administrator).
  app.post('/api/members/:id/approve', { preHandler: approvers }, async (request) => {
    const auth = authOf(request);
    const { id } = idParams.parse(request.params);
    const target = await loadApprovable(ctx, auth, id);
    if (target.status !== 'pending') throw conflictError('not_pending');
    let role = target.role as Role;
    if (target.role === 'FIELD_VOLUNTEER') {
      role = parse(approveMemberSchema, request.body).role;
      // Only the organisation's own coordinator may make someone a coordinator.
      if (role !== 'FIELD_VOLUNTEER' && auth.role !== 'GROUP_COORDINATOR') throw forbidden('role_not_allowed');
    }
    if (target.organisationId) {
      const [org] = await ctx.db.select({ s: organisation.status }).from(organisation).where(eq(organisation.id, target.organisationId));
      if (org?.s !== 'approved') throw conflictError('organisation_not_approved');
    }
    const now = ctx.now();
    await ctx.db.transaction(async (tx) => {
      await tx
        .update(appUser)
        .set({ status: 'active', role, approvedBy: auth.userId, approvedAt: now, updatedAt: now })
        .where(eq(appUser.id, id));
      await audit(tx, ctx.crypto, actorOf(auth), {
        action: 'member.approved',
        entityType: 'user',
        entityId: id,
        details: { role },
      });
    });
    return { ok: true };
  });

  app.post('/api/members/:id/reject', { preHandler: approvers }, async (request) => {
    const auth = authOf(request);
    const { id } = idParams.parse(request.params);
    const { reason } = parse(reasonSchema, request.body);
    const target = await loadApprovable(ctx, auth, id);
    if (target.status !== 'pending') throw conflictError('not_pending');
    await ctx.db.transaction(async (tx) => {
      await tx
        .update(appUser)
        .set({ status: 'rejected', rejectionReason: reason, updatedAt: ctx.now() })
        .where(eq(appUser.id, id));
      await audit(tx, ctx.crypto, actorOf(auth), {
        action: 'member.rejected',
        entityType: 'user',
        entityId: id,
        details: { reason },
      });
    });
    return { ok: true };
  });

  // UC05 step 4: assign a role inside the organisation.
  app.post('/api/members/:id/role', { preHandler: managers }, async (request) => {
    const auth = authOf(request);
    const { id } = idParams.parse(request.params);
    const { role } = parse(assignRoleSchema, request.body);
    const target = await loadManagedUser(ctx, auth, id);
    if (!target.organisationId || !['FIELD_VOLUNTEER', 'GROUP_COORDINATOR'].includes(target.role)) {
      throw badRequest('not_an_organisation_member');
    }
    if (target.status !== 'active' && target.status !== 'locked') throw conflictError('not_active');
    if (target.role === role) return { ok: true };
    if (target.role === 'GROUP_COORDINATOR') {
      const [{ n } = { n: 0 }] = await ctx.db
        .select({ n: sql<number>`count(*)::int` })
        .from(appUser)
        .where(
          and(
            eq(appUser.organisationId, target.organisationId),
            eq(appUser.role, 'GROUP_COORDINATOR'),
            inArray(appUser.status, ['active', 'locked']),
          ),
        );
      if (n <= 1) throw conflictError('last_coordinator');
    }
    await ctx.db.transaction(async (tx) => {
      await tx.update(appUser).set({ role, updatedAt: ctx.now() }).where(eq(appUser.id, id));
      await audit(tx, ctx.crypto, actorOf(auth), {
        action: 'member.role_assigned',
        entityType: 'user',
        entityId: id,
        details: { from: target.role, to: role },
      });
    });
    return { ok: true };
  });

  // UC05 3.a: deactivate a member who left; log-in is blocked immediately.
  app.post('/api/members/:id/deactivate', { preHandler: managers }, async (request) => {
    const auth = authOf(request);
    const { id } = idParams.parse(request.params);
    if (id === auth.userId) throw badRequest('cannot_deactivate_self');
    const target = await loadManagedUser(ctx, auth, id);
    if (target.status === 'deactivated') return { ok: true };
    if (target.role === 'GROUP_COORDINATOR' && target.organisationId) {
      const [{ n } = { n: 0 }] = await ctx.db
        .select({ n: sql<number>`count(*)::int` })
        .from(appUser)
        .where(
          and(
            eq(appUser.organisationId, target.organisationId),
            eq(appUser.role, 'GROUP_COORDINATOR'),
            inArray(appUser.status, ['active', 'locked']),
          ),
        );
      if (n <= 1 && auth.role !== 'SYSTEM_ADMINISTRATOR') throw conflictError('last_coordinator');
    }
    await ctx.db.transaction(async (tx) => {
      await tx.update(appUser).set({ status: 'deactivated', updatedAt: ctx.now() }).where(eq(appUser.id, id));
      await audit(tx, ctx.crypto, actorOf(auth), { action: 'member.deactivated', entityType: 'user', entityId: id });
    });
    await revokeAllForUser(ctx, id);
    return { ok: true };
  });

  // UC05 3.c, NFR03, C2: temporary password; also unlocks a locked account at once.
  app.post('/api/members/:id/temporary-password', { preHandler: managers }, async (request) => {
    const auth = authOf(request);
    const { id } = idParams.parse(request.params);
    if (id === auth.userId) throw badRequest('use_change_password');
    const target = await loadManagedUser(ctx, auth, id);
    if (target.status !== 'active' && target.status !== 'locked') throw conflictError('not_active');
    const temp = temporaryPassword();
    const now = ctx.now();
    await ctx.db.transaction(async (tx) => {
      await tx
        .update(appUser)
        .set({
          passwordHash: await hashPassword(temp),
          mustChangePassword: true,
          status: 'active',
          failedAttempts: 0,
          lockedUntil: null,
          updatedAt: now,
        })
        .where(eq(appUser.id, id));
      await audit(tx, ctx.crypto, actorOf(auth), {
        action: 'member.temporary_password_issued',
        entityType: 'user',
        entityId: id,
        details: { unlocked: target.status === 'locked' },
      });
    });
    await revokeAllForUser(ctx, id);
    // Shown once to the coordinator, who passes it on in person; never logged or stored in plain text.
    return { temporaryPassword: temp };
  });

  // UC05 3.b: revoke a lost device; the server then rejects its sync.
  app.post('/api/devices/:id/revoke', { preHandler: managers }, async (request) => {
    const auth = authOf(request);
    const { id } = idParams.parse(request.params);
    const [dev] = await ctx.db.select().from(device).where(eq(device.id, id));
    if (!dev) throw notFound('device_not_found');
    await loadManagedUser(ctx, auth, dev.userId);
    if (dev.status === 'revoked') return { ok: true };
    await ctx.db.transaction(async (tx) => {
      await tx
        .update(device)
        .set({ status: 'revoked', revokedAt: ctx.now(), revokedBy: auth.userId })
        .where(eq(device.id, id));
      await audit(tx, ctx.crypto, actorOf(auth), { action: 'device.revoked', entityType: 'device', entityId: id });
    });
    await revokeAllForDevice(ctx, id);
    return { ok: true };
  });
}
