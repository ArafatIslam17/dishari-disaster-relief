import { randomBytes } from 'node:crypto';
import { and, eq, ilike, or, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  LOCK_MINUTES,
  MAX_FAILED_LOGINS,
  acceptInviteSchema,
  changePasswordSchema,
  generateDevicePrefix,
  loginSchema,
  registerAccountSchema,
  registerOrganisationSchema,
  uuidv7,
  type Role,
} from '@relief/shared';
import { z } from 'zod';
import { authOf, requireAuth } from '../auth/guard.js';
import {
  ACCESS_TTL_SECONDS,
  REFRESH_COOKIE,
  REFRESH_TTL_DAYS,
  dummyPasswordHash,
  hashPassword,
  issueRefreshToken,
  revokeRefreshToken,
  rotateRefreshToken,
  signAccessToken,
  verifyPassword,
} from '../auth/tokens.js';
import type { AppContext } from '../context.js';
import { query } from '../db/client.js';
import { appUser, device, invite, operation, operationObserver, organisation } from '../db/schema.js';
import { audit, notify, SYSTEM_ACTOR } from '../lib/audit.js';
import { sha256Hex } from '../lib/crypto.js';
import { AppError, badRequest, conflictError, forbidden, notFound, unauthorized } from '../lib/errors.js';
import { parse } from '../lib/validate.js';

export interface UserView {
  id: string;
  fullName: string;
  mobile: string;
  role: Role;
  status: string;
  organisationId: string | null;
  organisationName: string | null;
  mustChangePassword: boolean;
}

export async function loadUserView(ctx: AppContext, userId: string): Promise<UserView> {
  const [row] = await ctx.db
    .select({
      id: appUser.id,
      fullName: appUser.fullName,
      mobile: appUser.mobileNumber,
      role: appUser.role,
      status: appUser.status,
      organisationId: appUser.organisationId,
      organisationName: organisation.name,
      mustChangePassword: appUser.mustChangePassword,
    })
    .from(appUser)
    .leftJoin(organisation, eq(organisation.id, appUser.organisationId))
    .where(eq(appUser.id, userId));
  if (!row) throw notFound('user_not_found');
  return { ...row, role: row.role as Role };
}

export async function activeUserIds(ctx: AppContext, role: Role, organisationId?: string): Promise<string[]> {
  const rows = await ctx.db
    .select({ id: appUser.id })
    .from(appUser)
    .where(
      and(
        eq(appUser.role, role),
        eq(appUser.status, 'active'),
        organisationId ? eq(appUser.organisationId, organisationId) : undefined,
      ),
    );
  return rows.map((r) => r.id);
}

function setRefreshCookie(ctx: AppContext, reply: FastifyReply, token: string): void {
  reply.setCookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: ctx.config.COOKIE_SECURE,
    path: '/api/auth',
    maxAge: REFRESH_TTL_DAYS * 86_400,
  });
}

async function mobileTaken(ctx: AppContext, mobile: string): Promise<boolean> {
  const [row] = await ctx.db.select({ id: appUser.id }).from(appUser).where(eq(appUser.mobileNumber, mobile));
  return !!row;
}

/** Creates or validates the caller's device; the server issues the short-code prefix (C6). */
async function registerDevice(
  ctx: AppContext,
  userId: string,
  deviceId: string,
  label: string,
): Promise<{ id: string; prefix: string; recoveryKey: string }> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const [existing] = await ctx.db.select().from(device).where(eq(device.id, deviceId));
    if (existing) {
      if (existing.userId !== userId) throw conflictError('device_belongs_to_another_user');
      if (existing.status !== 'active') throw forbidden('device_revoked');
      return {
        id: existing.id,
        prefix: existing.shortCodePrefix,
        recoveryKey: ctx.crypto.unwrap(existing.recoveryKeyEnc).toString('base64'),
      };
    }
    const recovery = randomBytes(32);
    const prefix = generateDevicePrefix();
    // A clash on the id or on the prefix inserts nothing; the loop re-reads and retries.
    const inserted = await ctx.db
      .insert(device)
      .values({
        id: deviceId,
        userId,
        deviceLabel: label,
        status: 'active',
        shortCodePrefix: prefix,
        recoveryKeyEnc: ctx.crypto.wrap(recovery),
        registeredAt: ctx.now(),
      })
      .onConflictDoNothing()
      .returning({ id: device.id });
    if (inserted.length > 0) return { id: deviceId, prefix, recoveryKey: recovery.toString('base64') };
  }
  throw new AppError(503, 'device_prefix_exhausted');
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;
  const strict = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  // UC01 Register Account
  app.post('/api/auth/register', strict, async (request, reply) => {
    const input = parse(registerAccountSchema, request.body);
    if (await mobileTaken(ctx, input.mobile)) throw conflictError('mobile_registered');
    let role: Role = 'OPERATION_ADMINISTRATOR';
    let organisationId: string | null = null;
    if (input.kind === 'member') {
      const [org] = await ctx.db
        .select({ id: organisation.id, status: organisation.status })
        .from(organisation)
        .where(eq(organisation.id, input.organisationId as string));
      if (!org || org.status !== 'approved') throw badRequest('organisation_not_approved');
      role = 'FIELD_VOLUNTEER';
      organisationId = org.id;
    }
    const id = uuidv7();
    const passwordHash = await hashPassword(input.password);
    await ctx.db.transaction(async (tx) => {
      await tx.insert(appUser).values({
        id,
        organisationId,
        fullName: input.fullName,
        mobileNumber: input.mobile,
        passwordHash,
        role,
        status: 'pending',
      });
      await audit(tx, ctx.crypto, { userId: id, organisationId, deviceId: null }, {
        action: 'account.registered',
        entityType: 'user',
        entityId: id,
        details: { role },
      });
    });
    if (role === 'FIELD_VOLUNTEER') {
      await notify(
        ctx.db,
        await activeUserIds(ctx, 'GROUP_COORDINATOR', organisationId as string),
        'member.pending',
        { name: input.fullName },
        '/app/members',
      );
      // Oversight: administrators of operations this organisation has joined may approve too.
      const admins = await query<{ id: string }>(
        ctx.db,
        sql`select distinct u.user_id as id from operation_admin oa
              join operation_membership m on m.operation_id = oa.operation_id and m.status = 'approved'
              join app_user u on u.user_id = oa.user_id and u.status = 'active'
             where m.organisation_id = ${organisationId}`,
      );
      await notify(ctx.db, admins.map((a) => a.id), 'member.pending', { name: input.fullName }, '/app/approvals');
    } else {
      await notify(
        ctx.db,
        await activeUserIds(ctx, 'SYSTEM_ADMINISTRATOR'),
        'operation_admin.pending',
        { name: input.fullName },
        '/app/admin/users',
      );
    }
    return reply.status(201).send({ status: 'pending' });
  });

  // UC03 Register Organisation (actor: unregistered visitor, C4)
  app.post('/api/auth/register-organisation', strict, async (request, reply) => {
    const input = parse(registerOrganisationSchema, request.body);
    const nameKey = input.organisation.name.trim().toLowerCase().replace(/\s+/g, ' ');
    const [existing] = await ctx.db
      .select({ name: organisation.name, status: organisation.status })
      .from(organisation)
      .where(eq(organisation.nameKey, nameKey));
    if (existing) throw conflictError('organisation_exists', { name: existing.name, status: existing.status });
    if (await mobileTaken(ctx, input.coordinator.mobile)) throw conflictError('mobile_registered');
    const orgId = uuidv7();
    const userId = uuidv7();
    const passwordHash = await hashPassword(input.coordinator.password);
    await ctx.db.transaction(async (tx) => {
      await tx.insert(organisation).values({
        id: orgId,
        name: input.organisation.name.trim(),
        nameKey,
        nameBn: input.organisation.nameBn ?? null,
        orgType: input.organisation.orgType,
        contactName: input.organisation.contactName,
        contactPhone: input.organisation.contactPhone,
        contactEmail: input.organisation.contactEmail ?? null,
        status: 'pending',
      });
      await tx.insert(appUser).values({
        id: userId,
        organisationId: orgId,
        fullName: input.coordinator.fullName,
        mobileNumber: input.coordinator.mobile,
        passwordHash,
        role: 'GROUP_COORDINATOR',
        status: 'pending',
      });
      await audit(tx, ctx.crypto, { userId, organisationId: orgId, deviceId: null }, {
        action: 'organisation.registered',
        entityType: 'organisation',
        entityId: orgId,
      });
    });
    await notify(
      ctx.db,
      await activeUserIds(ctx, 'SYSTEM_ADMINISTRATOR'),
      'organisation.pending',
      { name: input.organisation.name },
      '/app/admin/organisations',
    );
    return reply.status(201).send({ status: 'pending' });
  });

  // Approved organisations for the registration form (UC01 step 3).
  app.get('/api/public/organisations', async (request) => {
    const q = z.object({ q: z.string().trim().max(60).optional() }).parse(request.query).q;
    const pattern = q ? `%${q.replace(/[%_\\]/g, '\\$&')}%` : null;
    const rows = await ctx.db
      .select({ id: organisation.id, name: organisation.name, nameBn: organisation.nameBn })
      .from(organisation)
      .where(
        and(
          eq(organisation.status, 'approved'),
          pattern ? or(ilike(organisation.name, pattern), ilike(organisation.nameBn, pattern)) : undefined,
        ),
      )
      .orderBy(organisation.name)
      .limit(50);
    return { organisations: rows };
  });

  // UC02 Log In
  app.post('/api/auth/login', strict, async (request, reply) => {
    const input = parse(loginSchema, request.body);
    const now = ctx.now();
    const [user] = await ctx.db.select().from(appUser).where(eq(appUser.mobileNumber, input.mobile));
    if (!user) {
      await verifyPassword(await dummyPasswordHash(), input.password);
      throw unauthorized('invalid_credentials');
    }
    const actor = { userId: user.id, organisationId: user.organisationId, deviceId: null };

    // C2: a lock expires by itself after 15 minutes.
    if (user.status === 'locked' && user.lockedUntil && user.lockedUntil <= now) {
      await ctx.db
        .update(appUser)
        .set({ status: 'active', failedAttempts: 0, lockedUntil: null, updatedAt: now })
        .where(eq(appUser.id, user.id));
      await audit(ctx.db, ctx.crypto, actor, { action: 'account.auto_unlocked', entityType: 'user', entityId: user.id });
      user.status = 'active';
      user.failedAttempts = 0;
    }
    if (user.status === 'locked') {
      throw new AppError(423, 'account_locked', undefined, { lockedUntil: user.lockedUntil?.toISOString() });
    }

    const ok = await verifyPassword(user.passwordHash, input.password);
    if (!ok) {
      const attempts = user.failedAttempts + 1;
      const lock = attempts >= MAX_FAILED_LOGINS && user.status === 'active';
      const lockedUntil = lock ? new Date(now.getTime() + LOCK_MINUTES * 60_000) : null;
      await ctx.db
        .update(appUser)
        .set(
          lock
            ? { failedAttempts: attempts, status: 'locked', lockedUntil, updatedAt: now }
            : { failedAttempts: attempts, updatedAt: now },
        )
        .where(eq(appUser.id, user.id));
      await audit(ctx.db, ctx.crypto, actor, {
        action: 'auth.login_failed',
        entityType: 'user',
        entityId: user.id,
        details: { attempts },
      });
      if (lock) {
        await audit(ctx.db, ctx.crypto, actor, { action: 'account.locked', entityType: 'user', entityId: user.id });
        throw new AppError(423, 'account_locked', undefined, { lockedUntil: lockedUntil?.toISOString() });
      }
      throw unauthorized('invalid_credentials');
    }

    // UC02 3.a shows the status; a pending account is also told who approves it.
    if (user.status === 'pending')
      throw new AppError(403, 'account_pending', undefined, { approver: user.role === 'FIELD_VOLUNTEER' ? 'coordinator' : 'sysadmin' });
    if (user.status !== 'active') throw forbidden(`account_${user.status}`);

    const dev = await registerDevice(ctx, user.id, input.device.id, input.device.label);
    await ctx.db.update(appUser).set({ failedAttempts: 0, updatedAt: now }).where(eq(appUser.id, user.id));
    const accessToken = await signAccessToken(ctx, {
      sub: user.id,
      role: user.role as Role,
      org: user.organisationId,
      dev: dev.id,
    });
    const refresh = await issueRefreshToken(ctx, user.id, dev.id);
    setRefreshCookie(ctx, reply, refresh.token);
    await audit(ctx.db, ctx.crypto, { ...actor, deviceId: dev.id }, { action: 'auth.login', entityType: 'user', entityId: user.id });
    return {
      accessToken,
      expiresIn: ACCESS_TTL_SECONDS,
      user: await loadUserView(ctx, user.id),
      device: dev,
      serverTime: now.toISOString(),
    };
  });

  app.post('/api/auth/refresh', async (request, reply) => {
    if (request.headers['x-relief-client'] !== '1') throw forbidden('missing_client_header');
    const presented = request.cookies[REFRESH_COOKIE];
    if (!presented) throw unauthorized('refresh_missing');
    const rotated = await rotateRefreshToken(ctx, presented);
    const [row] = await query<{ status: string; role: Role; organisation_id: string | null; device_status: string | null }>(
      ctx.db,
      sql`select u.status, u.role, u.organisation_id, d.status as device_status
            from app_user u left join device d on d.device_id = ${rotated.deviceId}
           where u.user_id = ${rotated.userId}`,
    );
    if (!row || (row.status !== 'active' && row.status !== 'locked')) {
      throw unauthorized(`account_${row?.status ?? 'missing'}`);
    }
    if (rotated.deviceId && row.device_status !== 'active') throw forbidden('device_revoked');
    setRefreshCookie(ctx, reply, rotated.token);
    const accessToken = await signAccessToken(ctx, {
      sub: rotated.userId,
      role: row.role,
      org: row.organisation_id,
      dev: rotated.deviceId,
    });
    return {
      accessToken,
      expiresIn: ACCESS_TTL_SECONDS,
      user: await loadUserView(ctx, rotated.userId),
      serverTime: ctx.now().toISOString(),
    };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const presented = request.cookies[REFRESH_COOKIE];
    if (presented) await revokeRefreshToken(ctx, presented);
    reply.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    return { ok: true };
  });

  app.get('/api/auth/me', { preHandler: requireAuth(ctx) }, async (request) => {
    return { user: await loadUserView(ctx, authOf(request).userId) };
  });

  app.post('/api/auth/change-password', { preHandler: requireAuth(ctx) }, async (request) => {
    const auth = authOf(request);
    const input = parse(changePasswordSchema, request.body);
    const [user] = await ctx.db.select().from(appUser).where(eq(appUser.id, auth.userId));
    if (!user || !(await verifyPassword(user.passwordHash, input.currentPassword))) {
      throw badRequest('current_password_wrong');
    }
    if (input.currentPassword === input.newPassword) throw badRequest('password_unchanged');
    await ctx.db
      .update(appUser)
      .set({ passwordHash: await hashPassword(input.newPassword), mustChangePassword: false, updatedAt: ctx.now() })
      .where(eq(appUser.id, auth.userId));
    await audit(ctx.db, ctx.crypto, { userId: auth.userId, organisationId: auth.organisationId, deviceId: auth.deviceId }, {
      action: 'account.password_changed',
      entityType: 'user',
      entityId: auth.userId,
    });
    return { user: await loadUserView(ctx, auth.userId) };
  });

  // Observer invitation (C3)
  app.get('/api/invites/:token', async (request) => {
    const { token } = z.object({ token: z.string().min(20).max(200) }).parse(request.params);
    const [row] = await ctx.db
      .select({
        expiresAt: invite.expiresAt,
        usedAt: invite.usedAt,
        operationName: operation.name,
        organisationName: invite.organisationName,
      })
      .from(invite)
      .innerJoin(operation, eq(operation.id, invite.operationId))
      .where(eq(invite.tokenHash, sha256Hex(token)));
    if (!row) throw notFound('invite_not_found');
    if (row.usedAt) throw new AppError(410, 'invite_used');
    if (row.expiresAt <= ctx.now()) throw new AppError(410, 'invite_expired');
    return {
      operationName: row.operationName,
      organisationName: row.organisationName,
      expiresAt: row.expiresAt.toISOString(),
    };
  });

  app.post('/api/invites/accept', strict, async (request, reply) => {
    const input = parse(acceptInviteSchema, request.body);
    const now = ctx.now();
    const [inv] = await ctx.db.select().from(invite).where(eq(invite.tokenHash, sha256Hex(input.token)));
    if (!inv) throw notFound('invite_not_found');
    if (inv.usedAt) throw new AppError(410, 'invite_used');
    if (inv.expiresAt <= now) throw new AppError(410, 'invite_expired');
    const [existing] = await ctx.db.select().from(appUser).where(eq(appUser.mobileNumber, input.mobile));
    let userId: string;
    if (existing) {
      // An existing observer joins one more operation after proving the account is theirs.
      if (existing.role !== 'OBSERVER' || !(await verifyPassword(existing.passwordHash, input.password))) {
        throw conflictError('mobile_registered');
      }
      userId = existing.id;
    } else {
      userId = uuidv7();
    }
    const passwordHash = existing ? null : await hashPassword(input.password);
    const claimed = await ctx.db.transaction(async (tx) => {
      const rows = await tx
        .update(invite)
        .set({ usedAt: now, usedBy: userId })
        .where(and(eq(invite.id, inv.id), sql`${invite.usedAt} is null`))
        .returning({ id: invite.id });
      if (rows.length === 0) return false;
      if (!existing) {
        await tx.insert(appUser).values({
          id: userId,
          organisationId: null,
          fullName: input.fullName,
          mobileNumber: input.mobile,
          passwordHash: passwordHash as string,
          role: 'OBSERVER',
          status: 'active',
          approvedBy: inv.invitedBy,
          approvedAt: now,
        });
      }
      await tx
        .insert(operationObserver)
        .values({ operationId: inv.operationId, userId, invitedBy: inv.invitedBy })
        .onConflictDoNothing();
      await audit(tx, ctx.crypto, { ...SYSTEM_ACTOR, userId }, {
        action: 'observer.invite_accepted',
        entityType: 'invite',
        entityId: inv.id,
        operationId: inv.operationId,
      });
      return true;
    });
    if (!claimed) throw new AppError(410, 'invite_used');
    return reply.status(201).send({ status: 'active' });
  });
}
