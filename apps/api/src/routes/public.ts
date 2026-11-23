import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { reportQuerySchema, uuidSchema } from '@relief/shared';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { query } from '../db/client.js';
import { notFound } from '../lib/errors.js';
import { coverageSummary, coverageTotals, suppressSmallCells, upazilaRollup } from './coverage.js';
import { sendOperationSummary } from './reports.js';

/**
 * Public observer portal (no log-in). Everything here is what a logged-in observer sees and no more:
 * area-level counts with small cells suppressed (NFR06), operation names, and nothing about any
 * household, person, phone number, NID or GPS point. Rate limited because it is open to anyone.
 */
async function publicOperation(ctx: AppContext, id: string) {
  const [op] = await query<{ id: string }>(ctx.db, sql`select operation_id as id from operation where operation_id = ${id} and status in ('active', 'closed')`);
  if (!op) throw notFound('operation_not_found');
}

export async function publicRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;
  const open = { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } };
  const heavy = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  app.get('/api/public/operations', open, async () => {
    const rows = await query<{
      id: string;
      name: string;
      status: string;
      start_date: string;
      end_date: string | null;
      closed_at: Date | null;
      disaster_en: string;
      disaster_bn: string;
    }>(
      ctx.db,
      sql`select o.operation_id as id, o.name, o.status, o.start_date::text, o.end_date::text, o.closed_at,
                 dt.name_en as disaster_en, dt.name_bn as disaster_bn
            from operation o join disaster_type dt on dt.id = o.disaster_type_id
           where o.status in ('active', 'closed')
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
        membershipStatus: null,
        relation: 'observer',
      })),
    };
  });

  app.get('/api/public/operations/:id/coverage', open, async (request) => {
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const filter = z
      .object({
        upazila: z.string().max(50).optional(),
        union: z.string().max(50).optional(),
        ward: z.string().max(20).optional(),
      })
      .parse(request.query);
    await publicOperation(ctx, id);
    const summary = await coverageSummary(ctx, id, filter);
    return {
      rows: suppressSmallCells(summary.rows),
      totals: coverageTotals(summary.rows),
      upazilas: upazilaRollup(summary.rows, true),
      lastUpdated: summary.lastUpdated,
      generatedAt: ctx.now().toISOString(),
    };
  });

  app.get('/api/public/reports/operation-summary', heavy, async (request, reply) => {
    const q = reportQuerySchema.parse(request.query);
    await publicOperation(ctx, q.operationId);
    return sendOperationSummary(ctx, reply, q, true);
  });
}
