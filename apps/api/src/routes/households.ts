import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { normalisePhone, normaliseShortCode, uuidSchema } from '@relief/shared';
import { z } from 'zod';
import { authOf, operationAccess, requireAuth } from '../auth/guard.js';
import { query } from '../db/client.js';
import { forbidden, notFound } from '../lib/errors.js';
import { selectDistributions, selectHouseholds, toHouseholdDTO } from '../services/views.js';

/** Dashboard household search and history (UC14 on the dashboard, UC23, FR25). Observers are excluded (NFR06). */
export async function householdRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;
  const staff = requireAuth(ctx, 'GROUP_COORDINATOR', 'OPERATION_ADMINISTRATOR', 'SYSTEM_ADMINISTRATOR');

  app.get('/api/operations/:id/households', { preHandler: staff }, async (request) => {
    const auth = authOf(request);
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const q = z
      .object({ q: z.string().trim().max(80).optional(), areaId: uuidSchema.optional() })
      .parse(request.query);
    await operationAccess(ctx, auth, id);
    const term = q.q ?? '';
    const code = normaliseShortCode(term);
    const phone = normalisePhone(term);
    const filters = [sql`h.operation_id = ${id}`];
    if (q.areaId) filters.push(sql`h.area_id = ${q.areaId}`);
    if (code) filters.push(sql`h.short_code = ${code}`);
    else if (phone) filters.push(sql`h.mobile_hmac = ${ctx.crypto.phoneHmac(id, phone)}`);
    else if (term.length >= 2) {
      const pattern = `%${term.toLowerCase().replace(/[%_\\]/g, '\\$&')}%`;
      filters.push(sql`(h.name_norm like ${pattern} or h.name_norm % ${term.toLowerCase()})`);
    }
    const rows = await selectHouseholds(ctx.db, sql.join(filters, sql` and `), sql`order by h.created_at desc limit 100`);
    const isSystem = auth.role === 'SYSTEM_ADMINISTRATOR';
    return { households: rows.map((r) => toHouseholdDTO(r, auth.organisationId, isSystem)) };
  });

  app.get('/api/households/:id', { preHandler: staff }, async (request) => {
    const auth = authOf(request);
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const [row] = await selectHouseholds(ctx.db, sql`h.household_id = ${id}`);
    if (!row) throw notFound('household_not_found');
    await operationAccess(ctx, auth, row.operation_id);
    const distributions = await selectDistributions(ctx.db, sql`d.household_id = ${id}`, sql`order by d.distributed_at desc`);
    const [a] = await query<{ upazila: string; union_name: string; ward: string }>(
      ctx.db,
      sql`select upazila, union_name, ward from area where area_id = ${row.area_id}`,
    );
    return {
      household: toHouseholdDTO(row, auth.organisationId, auth.role === 'SYSTEM_ADMINISTRATOR'),
      area: a,
      distributions,
    };
  });

  // UC23: every recorded action on a household, in order, with user, organisation and time.
  app.get('/api/households/:id/history', { preHandler: staff }, async (request) => {
    const auth = authOf(request);
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const [h] = await query<{ operation_id: string }>(ctx.db, sql`select operation_id from household where household_id = ${id}`);
    if (!h) throw notFound('household_not_found');
    const access = await operationAccess(ctx, auth, h.operation_id);
    if (access.relation === 'observer') throw forbidden('role_not_allowed');
    const entries = await query<Record<string, unknown>>(
      ctx.db,
      sql`select a.audit_id::text as id, a.action, a.entity_type as "entityType", a.entity_id as "entityId",
                 a.changed_fields as "changedFields", a.details, a.created_at as "createdAt",
                 u.full_name as "userName", o.name as "organisationName", d.device_label as "deviceLabel"
            from audit_log a
            left join app_user u on u.user_id = a.user_id
            left join organisation o on o.organisation_id = a.organisation_id
            left join device d on d.device_id = a.device_id
           where a.entity_id = ${id}
              or a.entity_id in (select distribution_id from distribution where household_id = ${id})
              or a.entity_id in (select conflict_id from conflict where household_id = ${id})
              or a.entity_id in (select pair_id from duplicate_pair where ${id} in (household_a_id, household_b_id))
              or a.entity_id in (select f.flag_id from distribution_flag f join distribution x
                                   on x.distribution_id in (f.first_distribution_id, f.second_distribution_id)
                                  where x.household_id = ${id})
           order by a.audit_id`,
    );
    // Details may carry ids and item lists, never personal values (C8); phone digits never appear here.
    return { history: entries };
  });
}
