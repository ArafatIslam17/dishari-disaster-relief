import { PassThrough } from 'node:stream';
import { sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { stringify } from 'csv-stringify';
import { auditQuerySchema } from '@relief/shared';
import { authOf, requireAuth, requireOperationAdmin } from '../auth/guard.js';
import type { AppContext, AuthInfo } from '../context.js';
import { query } from '../db/client.js';
import { audit } from '../lib/audit.js';
import { badRequest } from '../lib/errors.js';

type AuditFilter = ReturnType<typeof auditQuerySchema.parse>;

async function scopedFilter(ctx: AppContext, auth: AuthInfo, q: AuditFilter): Promise<SQL[]> {
  const where: SQL[] = [];
  if (auth.role === 'OPERATION_ADMINISTRATOR') {
    // UC24 QR2: an operation administrator searches only their own operation's trail.
    if (!q.operationId) throw badRequest('operation_required');
    await requireOperationAdmin(ctx, auth, q.operationId);
  }
  if (q.operationId) where.push(sql`a.operation_id = ${q.operationId}`);
  if (q.userId) where.push(sql`a.user_id = ${q.userId}`);
  if (q.organisationId) where.push(sql`a.organisation_id = ${q.organisationId}`);
  if (q.deviceId) where.push(sql`a.device_id = ${q.deviceId}`);
  if (q.action) where.push(sql`a.action like ${`${q.action.replace(/[%_\\]/g, '\\$&')}%`}`);
  if (q.from) where.push(sql`a.created_at >= ${q.from}::date`);
  if (q.to) where.push(sql`a.created_at < (${q.to}::date + 1)`);
  return where;
}

const AUDIT_COLUMNS = sql`a.audit_id::text as id, a.created_at as "createdAt", a.action, a.entity_type as "entityType",
  a.entity_id as "entityId", a.operation_id as "operationId", a.changed_fields as "changedFields", a.details,
  a.user_id as "userId", u.full_name as "userName", a.organisation_id as "organisationId", o.name as "organisationName",
  a.device_id as "deviceId", d.device_label as "deviceLabel"`;
const AUDIT_JOINS = sql`left join app_user u on u.user_id = a.user_id
  left join organisation o on o.organisation_id = a.organisation_id
  left join device d on d.device_id = a.device_id`;

/** UC24 Search and Export Audit Trail. Read-only: there is no edit or delete route, and triggers forbid both. */
export async function auditRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;
  const admins = requireAuth(ctx, 'OPERATION_ADMINISTRATOR', 'SYSTEM_ADMINISTRATOR');

  app.get('/api/audit', { preHandler: admins }, async (request) => {
    const auth = authOf(request);
    const q = auditQuerySchema.parse(request.query);
    const where = await scopedFilter(ctx, auth, q);
    if (q.before) where.push(sql`a.audit_id < ${q.before}::bigint`);
    const rows = await query<Record<string, unknown>>(
      ctx.db,
      sql`select ${AUDIT_COLUMNS} from audit_log a ${AUDIT_JOINS}
           ${where.length ? sql`where ${sql.join(where, sql` and `)}` : sql``}
           order by a.audit_id desc limit ${q.limit + 1}`,
    );
    const hasMore = rows.length > q.limit;
    const page = rows.slice(0, q.limit);
    return { entries: page, nextBefore: hasMore ? (page.at(-1)?.id as string) : null };
  });

  app.get('/api/audit/export.csv', { preHandler: admins }, async (request, reply) => {
    const auth = authOf(request);
    const q = auditQuerySchema.parse(request.query);
    const where = await scopedFilter(ctx, auth, q);
    await audit(ctx.db, ctx.crypto, { userId: auth.userId, organisationId: auth.organisationId, deviceId: auth.deviceId }, {
      action: 'audit.exported',
      entityType: 'audit_log',
      operationId: q.operationId ?? null,
      details: { filters: { ...q, limit: undefined } },
    });
    const csv = stringify({
      header: true,
      columns: ['id', 'createdAt', 'action', 'entityType', 'entityId', 'operationId', 'changedFields', 'userName', 'organisationName', 'deviceLabel', 'details'],
    });
    const out = new PassThrough();
    csv.pipe(out);
    // Streamed in pages so memory stays flat for long trails.
    void (async () => {
      try {
        let before: string | null = null;
        for (;;) {
          const page: Record<string, unknown>[] = await query<Record<string, unknown>>(
            ctx.db,
            sql`select ${AUDIT_COLUMNS} from audit_log a ${AUDIT_JOINS}
                 where ${sql.join([...where, before ? sql`a.audit_id < ${before}::bigint` : sql`true`], sql` and `)}
                 order by a.audit_id desc limit 1000`,
          );
          for (const r of page) {
            const ok = csv.write({
              ...r,
              createdAt: new Date(r.createdAt as string).toISOString(),
              changedFields: Array.isArray(r.changedFields) ? (r.changedFields as string[]).join('|') : '',
              details: r.details ? JSON.stringify(r.details) : '',
            });
            if (!ok) await new Promise((res) => csv.once('drain', res));
          }
          if (page.length < 1000) break;
          before = page.at(-1)?.id as string;
        }
        csv.end();
      } catch (err) {
        out.destroy(err instanceof Error ? err : new Error(String(err)));
      }
    })();
    const stamp = ctx.now().toISOString().slice(0, 10);
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="audit-${stamp}.csv"`)
      .send(out);
  });
}
