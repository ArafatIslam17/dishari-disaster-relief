import { randomInt } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { normalisePhone, uuidSchema, uuidv7 } from '@relief/shared';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { donation, operation } from '../db/schema.js';
import { badRequest, conflictError, forbidden, notFound } from '../lib/errors.js';

/**
 * Relief fund: public donations through a sandbox payment gateway (SSLCommerz / aamarPay style).
 * No card or wallet data reaches the server; the sandbox only records the outcome the donor chose.
 * Donor phone and e-mail are stored for receipt follow-up and never returned by any endpoint.
 */
export const PAYMENT_METHODS = ['bkash', 'nagad', 'rocket', 'visa', 'mastercard'] as const;
const TXN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newTransactionId(now: Date): string {
  let tail = '';
  for (let i = 0; i < 6; i++) tail += TXN_ALPHABET[randomInt(TXN_ALPHABET.length)];
  return `DSH-${now.getUTCFullYear()}-${tail}`;
}

const initiateSchema = z
  .object({
    operationId: uuidSchema.nullish(),
    amountBdt: z.number().int('amount_whole').min(10, 'amount_min').max(1_000_000, 'amount_max'),
    donorName: z.string().trim().max(80).nullish(),
    donorPhone: z.string().trim().max(20).nullish(),
    donorEmail: z.string().trim().max(120).nullish(),
    isAnonymous: z.boolean().default(false),
  })
  .strict();

const completeSchema = z
  .object({
    outcome: z.enum(['success', 'fail', 'cancel']),
    // Optional only for fail/cancel: a donor can abandon the gateway before choosing a method.
    paymentMethod: z.enum(PAYMENT_METHODS).optional(),
  })
  .strict()
  .refine((b) => b.outcome !== 'success' || b.paymentMethod, { message: 'payment_method_required', path: ['paymentMethod'] });

type DonationRow = typeof donation.$inferSelect;

/** Public receipt: no phone, no e-mail; anonymous donors carry no name at all. */
function receipt(d: DonationRow, operationName: string | null) {
  const anonymous = d.isAnonymous || !d.donorName;
  return {
    id: d.id,
    transactionId: d.transactionId,
    amountBdt: d.amountBdt,
    status: d.status,
    paymentMethod: d.paymentMethod,
    isAnonymous: anonymous,
    donorName: anonymous ? null : d.donorName,
    operationId: d.operationId,
    operationName,
    createdAt: d.createdAt.toISOString(),
    completedAt: d.completedAt ? d.completedAt.toISOString() : null,
  };
}

async function loadDonation(ctx: AppContext, id: string) {
  const [row] = await ctx.db
    .select({ d: donation, operationName: operation.name })
    .from(donation)
    .leftJoin(operation, eq(operation.id, donation.operationId))
    .where(eq(donation.id, id));
  if (!row) throw notFound('donation_not_found');
  return row;
}

function pgCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } };
  return e.code ?? e.cause?.code;
}

export async function donationRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;
  const strict = { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } };

  /** Active operations a donor can give to (names only). */
  app.get('/api/donations/campaigns', async () => {
    const rows = await ctx.db
      .select({ id: operation.id, name: operation.name, startDate: operation.startDate })
      .from(operation)
      .where(eq(operation.status, 'active'))
      .orderBy(desc(operation.startDate));
    return { campaigns: rows };
  });

  app.get('/api/donations/summary', async (request) => {
    const { operationId } = z.object({ operationId: uuidSchema.optional() }).parse(request.query);
    const scope = operationId ? and(eq(donation.status, 'completed'), eq(donation.operationId, operationId)) : eq(donation.status, 'completed');
    const [totals] = await ctx.db
      .select({ totalBdt: sql<number>`coalesce(sum(${donation.amountBdt}), 0)::int`, count: sql<number>`count(*)::int` })
      .from(donation)
      .where(scope);
    const latest = await ctx.db
      .select({ d: donation, operationName: operation.name })
      .from(donation)
      .leftJoin(operation, eq(operation.id, donation.operationId))
      .where(scope)
      .orderBy(desc(donation.completedAt))
      .limit(10);
    return {
      totalBdt: totals?.totalBdt ?? 0,
      completedCount: totals?.count ?? 0,
      latest: latest.map((r) => receipt(r.d, r.operationName)),
    };
  });

  app.post('/api/donations/initiate', strict, async (request, reply) => {
    const body = initiateSchema.parse(request.body);
    const anonymous = body.isAnonymous;
    const name = body.donorName?.trim() || null;
    if (!anonymous && !name) throw badRequest('donor_name_required');
    let phone: string | null = null;
    if (body.donorPhone) {
      phone = normalisePhone(body.donorPhone);
      if (!phone) throw badRequest('invalid_phone');
    }
    let email: string | null = null;
    if (body.donorEmail) {
      const parsed = z.email().safeParse(body.donorEmail);
      if (!parsed.success) throw badRequest('invalid_email');
      email = parsed.data.toLowerCase();
    }
    if (body.operationId) {
      const [op] = await ctx.db.select({ status: operation.status }).from(operation).where(eq(operation.id, body.operationId));
      if (!op) throw notFound('operation_not_found');
      if (op.status !== 'active') throw conflictError('operation_closed');
    }
    const now = ctx.now();
    const id = uuidv7(now.getTime());
    // Six random symbols rarely collide; retry on the unique index just in case.
    for (let attempt = 0; ; attempt++) {
      const transactionId = newTransactionId(now);
      try {
        await ctx.db.insert(donation).values({
          id,
          operationId: body.operationId ?? null,
          donorName: anonymous ? null : name,
          donorPhone: phone,
          donorEmail: email,
          isAnonymous: anonymous,
          amountBdt: body.amountBdt,
          transactionId,
          status: 'pending',
          createdAt: now,
        });
        return reply.status(201).send({ donationId: id, transactionId, gatewayUrl: `/donate/gateway/${id}` });
      } catch (err) {
        if (pgCode(err) !== '23505' || attempt >= 4) throw err;
      }
    }
  });

  app.get('/api/donations/:id', async (request) => {
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const row = await loadDonation(ctx, id);
    return { donation: receipt(row.d, row.operationName) };
  });

  app.post('/api/donations/:id/sandbox-complete', strict, async (request) => {
    // The sandbox settles a payment with a button press, so it never runs in production.
    if (ctx.config.NODE_ENV === 'production') throw forbidden('sandbox_disabled');
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const body = completeSchema.parse(request.body);
    const status = body.outcome === 'success' ? 'completed' : body.outcome === 'fail' ? 'failed' : 'cancelled';
    const updated = await ctx.db
      .update(donation)
      .set({ status, paymentMethod: body.paymentMethod ?? null, completedAt: ctx.now() })
      .where(and(eq(donation.id, id), eq(donation.status, 'pending')))
      .returning({ id: donation.id });
    if (updated.length === 0) {
      await loadDonation(ctx, id); // 404 when it does not exist
      throw conflictError('donation_already_settled');
    }
    const row = await loadDonation(ctx, id);
    return { donation: receipt(row.d, row.operationName) };
  });
}
