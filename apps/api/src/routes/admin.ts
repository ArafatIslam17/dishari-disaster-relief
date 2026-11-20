import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { disasterTypeSchema, reasonSchema, uuidSchema, uuidv7 } from '@relief/shared';
import { z } from 'zod';
import { authOf, requireAuth } from '../auth/guard.js';
import type { AuthInfo } from '../context.js';
import { appUser, backupRun, disasterType, organisation } from '../db/schema.js';
import { audit } from '../lib/audit.js';
import { conflictError, notFound } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { runBackup, verifyLatestBackup } from '../services/backup.js';
import { dueForRetention, runRetention } from '../services/retention.js';

const actorOf = (auth: AuthInfo) => ({ userId: auth.userId, organisationId: auth.organisationId, deviceId: auth.deviceId });

/** System Administrator functions: UC04, disaster types (NFR21), backup (NFR13) and retention (NFR07). */
export async function adminRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;
  const sysadmin = requireAuth(ctx, 'SYSTEM_ADMINISTRATOR');

  // UC04 step 1-2: pending organisations with coordinator details.
  app.get('/api/admin/organisations', { preHandler: sysadmin }, async (request) => {
    const q = z.object({ status: z.enum(['pending', 'approved', 'rejected']).optional() }).parse(request.query);
    const orgs = await ctx.db
      .select()
      .from(organisation)
      .where(q.status ? eq(organisation.status, q.status) : undefined)
      .orderBy(sql`case ${organisation.status} when 'pending' then 0 else 1 end`, desc(organisation.createdAt))
      .limit(500);
    const coordinators = await ctx.db
      .select({ organisationId: appUser.organisationId, fullName: appUser.fullName, mobile: appUser.mobileNumber, status: appUser.status })
      .from(appUser)
      .where(eq(appUser.role, 'GROUP_COORDINATOR'));
    return {
      organisations: orgs.map((o) => ({ ...o, coordinators: coordinators.filter((c) => c.organisationId === o.id) })),
    };
  });

  // UC04 step 4-6: approve activates the organisation and its coordinator account (Fig 5.11).
  app.post('/api/admin/organisations/:id/approve', { preHandler: sysadmin }, async (request) => {
    const auth = authOf(request);
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const now = ctx.now();
    await ctx.db.transaction(async (tx) => {
      const updated = await tx
        .update(organisation)
        .set({ status: 'approved', reviewedBy: auth.userId, reviewedAt: now })
        .where(and(eq(organisation.id, id), eq(organisation.status, 'pending')))
        .returning({ id: organisation.id });
      if (updated.length === 0) throw conflictError('not_pending');
      await tx
        .update(appUser)
        .set({ status: 'active', approvedBy: auth.userId, approvedAt: now, updatedAt: now })
        .where(and(eq(appUser.organisationId, id), eq(appUser.role, 'GROUP_COORDINATOR'), eq(appUser.status, 'pending')));
      await audit(tx, ctx.crypto, actorOf(auth), { action: 'organisation.approved', entityType: 'organisation', entityId: id });
    });
    return { ok: true };
  });

  // UC04 4.a: reject with a reason; UC03 6.a shows it.
  app.post('/api/admin/organisations/:id/reject', { preHandler: sysadmin }, async (request) => {
    const auth = authOf(request);
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const { reason } = parse(reasonSchema, request.body);
    await ctx.db.transaction(async (tx) => {
      const updated = await tx
        .update(organisation)
        .set({ status: 'rejected', rejectionReason: reason, reviewedBy: auth.userId, reviewedAt: ctx.now() })
        .where(and(eq(organisation.id, id), eq(organisation.status, 'pending')))
        .returning({ id: organisation.id });
      if (updated.length === 0) throw conflictError('not_pending');
      await tx
        .update(appUser)
        .set({ status: 'rejected', rejectionReason: reason, updatedAt: ctx.now() })
        .where(and(eq(appUser.organisationId, id), eq(appUser.status, 'pending')));
      await audit(tx, ctx.crypto, actorOf(auth), {
        action: 'organisation.rejected',
        entityType: 'organisation',
        entityId: id,
        details: { reason },
      });
    });
    return { ok: true };
  });

  // NFR21: disaster types are data, not code.
  app.post('/api/admin/disaster-types', { preHandler: sysadmin }, async (request, reply) => {
    const auth = authOf(request);
    const input = parse(disasterTypeSchema, request.body);
    const id = uuidv7();
    const inserted = await ctx.db
      .insert(disasterType)
      .values({ id, nameEn: input.nameEn, nameBn: input.nameBn, active: input.active })
      .onConflictDoNothing()
      .returning({ id: disasterType.id });
    if (inserted.length === 0) throw conflictError('disaster_type_exists');
    await audit(ctx.db, ctx.crypto, actorOf(auth), { action: 'disaster_type.added', entityType: 'disaster_type', entityId: id });
    return reply.status(201).send({ id });
  });

  app.patch('/api/admin/disaster-types/:id', { preHandler: sysadmin }, async (request) => {
    const auth = authOf(request);
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = parse(disasterTypeSchema.partial(), request.body);
    const updated = await ctx.db.update(disasterType).set(input).where(eq(disasterType.id, id)).returning({ id: disasterType.id });
    if (updated.length === 0) throw notFound('disaster_type_not_found');
    await audit(ctx.db, ctx.crypto, actorOf(auth), {
      action: 'disaster_type.updated',
      entityType: 'disaster_type',
      entityId: id,
      details: { fields: Object.keys(input) },
    });
    return { ok: true };
  });

  // NFR13: backup status, run now, and verify the latest by a real restore.
  app.get('/api/admin/backups', { preHandler: sysadmin }, async () => {
    const runs = await ctx.db.select().from(backupRun).orderBy(desc(backupRun.startedAt)).limit(30);
    return { runs, databaseKind: ctx.handle.kind, dailyEnabled: ctx.config.BACKUP_DAILY };
  });
  app.post('/api/admin/backups/run', { preHandler: sysadmin }, async (request) => {
    const auth = authOf(request);
    const result = await runBackup(ctx);
    await audit(ctx.db, ctx.crypto, actorOf(auth), { action: 'backup.created', details: { sizeBytes: result.sizeBytes } });
    return result;
  });
  app.post('/api/admin/backups/verify', { preHandler: sysadmin }, async (request) => {
    const auth = authOf(request);
    const result = await verifyLatestBackup(ctx);
    await audit(ctx.db, ctx.crypto, actorOf(auth), { action: 'backup.restore_verified', details: result.tables });
    return result;
  });

  // NFR07: retention status and manual run (the daily job also runs it).
  app.get('/api/admin/retention', { preHandler: sysadmin }, async () => {
    const ops = await dueForRetention(ctx);
    return { retentionDays: ctx.config.RETENTION_DAYS, operations: ops };
  });
  app.post('/api/admin/retention/run', { preHandler: sysadmin }, async (request) => {
    const auth = authOf(request);
    const done = await runRetention(ctx);
    await audit(ctx.db, ctx.crypto, actorOf(auth), { action: 'retention.run', details: { operations: done.length } });
    return { redacted: done };
  });
}
