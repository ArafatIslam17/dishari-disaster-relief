import { sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { stringify } from 'csv-stringify/sync';
import { formatShortCode, reportQuerySchema, type CoverageLabel } from '@relief/shared';
import { authOf, operationAccess, requireAuth } from '../auth/guard.js';
import type { AppContext } from '../context.js';
import { query } from '../db/client.js';
import { audit } from '../lib/audit.js';
import { forbidden } from '../lib/errors.js';
import { ReportPdf } from '../services/pdf.js';
import { coverageSummary, suppressSmallCells } from './coverage.js';

const LABELS: Record<CoverageLabel, string> = {
  no_records: 'No records / কোনো রেকর্ড নেই',
  not_served: 'Not served / ত্রাণ পৌঁছায়নি',
  partly_served: 'Partly served / আংশিক ত্রাণ পৌঁছেছে',
  fully_served: 'Fully served / সব খানায় ত্রাণ পৌঁছেছে',
};

interface Range {
  from?: string;
  to?: string;
}

const rangeSql = (r: Range) =>
  sql`${r.from ? sql`and d.distributed_at >= ${r.from}::date` : sql``} ${r.to ? sql`and d.distributed_at < (${r.to}::date + 1)` : sql``}`;

async function itemTotals(ctx: AppContext, operationId: string, range: Range, organisationId?: string) {
  return query<{ item: string; item_bn: string | null; unit: string; quantity: number; distributions: number }>(
    ctx.db,
    sql`select i.item_name as item, i.item_name_bn as item_bn, i.unit, sum(di.quantity)::int as quantity,
               count(distinct d.distribution_id)::int as distributions
          from distribution d join distribution_item di on di.distribution_id = d.distribution_id
          join relief_item i on i.item_id = di.item_id
         where d.operation_id = ${operationId} and d.status = 'recorded' ${rangeSql(range)}
           ${organisationId ? sql`and d.organisation_id = ${organisationId}` : sql``}
         group by i.item_name, i.item_name_bn, i.unit order by i.item_name`,
  );
}

function sendFile(reply: FastifyReply, body: Buffer | string, type: string, name: string, empty: boolean) {
  return reply
    .header('Content-Type', type)
    .header('Content-Disposition', `attachment; filename="${name}"`)
    .header('X-Report-Empty', empty ? 'true' : 'false')
    .header('Access-Control-Expose-Headers', 'X-Report-Empty, Content-Disposition')
    .send(body);
}

export async function reportRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;

  // UC25 2.a: organisation report for donors - own organisation only; short codes, never names or phones.
  app.get('/api/reports/organisation', { preHandler: requireAuth(ctx, 'GROUP_COORDINATOR') }, async (request, reply) => {
    const auth = authOf(request);
    const q = reportQuerySchema.parse(request.query);
    await operationAccess(ctx, auth, q.operationId);
    const orgId = auth.organisationId as string;
    const generatedAt = ctx.now();
    const [meta] = await query<{ op: string; org: string }>(
      ctx.db,
      sql`select o.name as op, g.name as org from operation o, organisation g where o.operation_id = ${q.operationId} and g.organisation_id = ${orgId}`,
    );
    const rows = await query<{ at: Date; upazila: string; union_name: string; ward: string; code: string | null; status: string; items: string }>(
      ctx.db,
      sql`select d.distributed_at as at, a.upazila, a.union_name, a.ward, h.short_code as code, d.status,
                 string_agg(i.item_name || ' ' || di.quantity || ' ' || i.unit, '; ' order by i.item_name) as items
            from distribution d join area a on a.area_id = d.area_id
            left join household h on h.household_id = d.household_id
            join distribution_item di on di.distribution_id = d.distribution_id
            join relief_item i on i.item_id = di.item_id
           where d.operation_id = ${q.operationId} and d.organisation_id = ${orgId} ${rangeSql(q)}
           group by d.distribution_id, a.upazila, a.union_name, a.ward, h.short_code
           order by d.distributed_at`,
    );
    const totals = await itemTotals(ctx, q.operationId, q, orgId);
    await audit(ctx.db, ctx.crypto, { userId: auth.userId, organisationId: orgId, deviceId: auth.deviceId }, {
      action: 'report.generated',
      operationId: q.operationId,
      details: { type: 'organisation', format: q.format, from: q.from, to: q.to, rows: rows.length },
    });
    const empty = rows.length === 0;
    const table = rows.map((r) => [
      new Date(r.at).toISOString().replace('T', ' ').slice(0, 16),
      `${r.upazila} / ${r.union_name} / ${r.ward}`,
      r.code ? formatShortCode(r.code) : 'Anonymous',
      r.items,
      r.status,
    ]);
    const file = `organisation-report-${generatedAt.toISOString().slice(0, 10)}`;
    if (q.format === 'csv') {
      const csv = stringify([['distributed_at_utc', 'area', 'household_code', 'items', 'status'], ...table]);
      return sendFile(reply, ` ${csv}`, 'text/csv; charset=utf-8', `${file}.csv`, empty);
    }
    const pdf = new ReportPdf('Organisation distribution report');
    pdf.text(`${meta?.org ?? ''} - distribution report`, { size: 16, bold: true, gap: 0.3 });
    pdf.text(`Operation: ${meta?.op ?? ''}`, { size: 10 });
    pdf.text(`Period: ${q.from ?? 'start'} to ${q.to ?? 'today'}`, { size: 10 });
    pdf.text(`Generated: ${generatedAt.toISOString().replace('T', ' ').slice(0, 16)} UTC, from synchronised records`, { size: 9, color: '#4A5A63', gap: 1 });
    if (empty) pdf.text('No distributions were recorded in this period.', { size: 11, gap: 1 });
    else {
      pdf.text('Totals by item', { size: 12, bold: true, gap: 0.3 });
      pdf.table(['Item', 'Quantity', 'Distributions'], totals.map((t) => [`${t.item}${t.item_bn ? ` (${t.item_bn})` : ''}`, `${t.quantity} ${t.unit}`, t.distributions]), [240, 140, 110]);
      pdf.text('Distributions', { size: 12, bold: true, gap: 0.3 });
      pdf.table(['Time (UTC)', 'Area', 'Household', 'Items', 'Status'], table, [80, 130, 70, 170, 50]);
    }
    return sendFile(reply, await pdf.toBuffer(), 'application/pdf', `${file}.pdf`, empty);
  });

  // UC25: operation-wide summary for administrators and observers; never names or phones (FR26, NFR06).
  app.get(
    '/api/reports/operation-summary',
    { preHandler: requireAuth(ctx, 'OPERATION_ADMINISTRATOR', 'OBSERVER') },
    async (request, reply) => {
      const auth = authOf(request);
      const q = reportQuerySchema.parse(request.query);
      const access = await operationAccess(ctx, auth, q.operationId);
      if (access.relation !== 'admin' && access.relation !== 'observer') throw forbidden('role_not_allowed');
      const generatedAt = ctx.now();
      const coverage = await coverageSummary(ctx, q.operationId, q);
      const rows = access.relation === 'observer' ? suppressSmallCells(coverage.rows) : coverage.rows;
      const totals = await itemTotals(ctx, q.operationId, q);
      const byOrg = await query<{ org: string; distributions: number; anonymous: number }>(
        ctx.db,
        sql`select g.name as org, count(*)::int as distributions, count(*) filter (where d.is_anonymous)::int as anonymous
              from distribution d join organisation g on g.organisation_id = d.organisation_id
             where d.operation_id = ${q.operationId} and d.status = 'recorded' ${rangeSql(q)}
             group by g.name order by g.name`,
      );
      const [op] = await query<{ name: string }>(ctx.db, sql`select name from operation where operation_id = ${q.operationId}`);
      await audit(ctx.db, ctx.crypto, { userId: auth.userId, organisationId: auth.organisationId, deviceId: auth.deviceId }, {
        action: 'report.generated',
        operationId: q.operationId,
        details: { type: 'operation_summary', format: q.format, from: q.from, to: q.to },
      });
      const empty = totals.length === 0 && coverage.rows.every((r) => r.registered === 0);
      const coverageTable = rows.map((r) => [r.upazila, r.unionName, r.ward, r.registered, r.served, r.unserved, r.anonymousDistributions, LABELS[r.label], r.lastDistributionAt?.slice(0, 16).replace('T', ' ') ?? '-']);
      const file = `operation-summary-${generatedAt.toISOString().slice(0, 10)}`;
      if (q.format === 'csv') {
        const csv = stringify([
          ['section', 'upazila', 'union', 'ward', 'registered', 'served', 'unserved', 'anonymous_distributions', 'coverage', 'last_distribution_utc'],
          ...coverageTable.map((r) => ['coverage', ...r]),
          [],
          ['section', 'item', 'unit', 'quantity', 'distributions'],
          ...totals.map((t) => ['item_total', t.item, t.unit, t.quantity, t.distributions]),
          [],
          ['section', 'organisation', 'distributions', 'anonymous'],
          ...byOrg.map((o) => ['organisation', o.org, o.distributions, o.anonymous]),
        ]);
        return sendFile(reply, ` ${csv}`, 'text/csv; charset=utf-8', `${file}.csv`, empty);
      }
      const pdf = new ReportPdf('Operation summary');
      pdf.text(`${op?.name ?? ''} - operation summary`, { size: 16, bold: true, gap: 0.3 });
      pdf.text(`Period: ${q.from ?? 'start'} to ${q.to ?? 'today'}. Area-level figures only; no names or phone numbers.`, { size: 10 });
      if (access.relation === 'observer') pdf.text(`Counts between 1 and 4 are shown as "<5" to protect small wards.`, { size: 9, color: '#4A5A63' });
      pdf.text(`Generated: ${generatedAt.toISOString().replace('T', ' ').slice(0, 16)} UTC. Data last synchronised: ${coverage.lastUpdated?.replace('T', ' ').slice(0, 16) ?? 'never'} UTC.`, { size: 9, color: '#4A5A63', gap: 1 });
      if (empty) pdf.text('No households or distributions are recorded for this operation and period.', { size: 11, gap: 1 });
      pdf.text('Coverage by area', { size: 12, bold: true, gap: 0.3 });
      pdf.table(['Upazila', 'Union', 'Ward', 'Reg.', 'Served', 'Unserved', 'Anon.', 'Coverage', 'Last'], coverageTable, [60, 60, 40, 35, 38, 45, 35, 125, 62]);
      if (totals.length > 0) {
        pdf.text('Relief items distributed', { size: 12, bold: true, gap: 0.3 });
        pdf.table(['Item', 'Quantity', 'Distributions'], totals.map((t) => [`${t.item}${t.item_bn ? ` (${t.item_bn})` : ''}`, `${t.quantity} ${t.unit}`, t.distributions]), [240, 140, 110]);
        pdf.text('Distributions by organisation', { size: 12, bold: true, gap: 0.3 });
        pdf.table(['Organisation', 'Distributions', 'Anonymous'], byOrg.map((o) => [o.org, o.distributions, o.anonymous]), [260, 120, 110]);
      }
      return sendFile(reply, await pdf.toBuffer(), 'application/pdf', `${file}.pdf`, empty);
    },
  );
}
