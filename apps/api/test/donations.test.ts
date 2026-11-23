import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, createTestEnv, type TestEnv } from './helpers.js';
import { seedDonations } from '../src/seed.js';

let env: TestEnv;
let client: Client;
beforeAll(async () => {
  env = await createTestEnv();
  client = new Client(env);
});
afterAll(async () => env?.close());

interface Receipt {
  id: string;
  transactionId: string;
  amountBdt: number;
  status: string;
  paymentMethod: string | null;
  isAnonymous: boolean;
  donorName: string | null;
}

async function initiate(body: Record<string, unknown>) {
  return client.call<{ donationId: string; transactionId: string; gatewayUrl: string; code?: string }>('POST', '/api/donations/initiate', { body });
}

describe('Relief fund: sandbox donations', () => {
  it('creates a pending donation with a DSH transaction id and a gateway link', async () => {
    const r = await initiate({ amountBdt: 1000, donorName: 'Test Donor', donorPhone: '01712345678' });
    expect(r.status).toBe(201);
    expect(r.body.transactionId).toMatch(/^DSH-\d{4}-[A-Z2-9]{6}$/);
    expect(r.body.gatewayUrl).toBe(`/donate/gateway/${r.body.donationId}`);
    const got = await client.call<{ donation: Receipt & Record<string, unknown> }>('GET', `/api/donations/${r.body.donationId}`);
    expect(got.body.donation.status).toBe('pending');
    expect(got.body.donation).not.toHaveProperty('donorPhone');
  });

  it('rejects bad amounts and a missing name for a named donation', async () => {
    expect((await initiate({ amountBdt: 0, donorName: 'X' })).status).toBe(400);
    expect((await initiate({ amountBdt: 12.5, donorName: 'X' })).status).toBe(400);
    const r = await initiate({ amountBdt: 500 });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('donor_name_required');
    expect((await initiate({ amountBdt: 500, isAnonymous: true })).status).toBe(201);
    expect((await initiate({ amountBdt: 500, donorName: 'X', donorEmail: 'not-mail' })).body.code).toBe('invalid_email');
  });

  it('settles once: success counts toward the fund, later attempts conflict', async () => {
    const before = await client.call<{ totalBdt: number; completedCount: number }>('GET', '/api/donations/summary');
    const r = await initiate({ amountBdt: 2500, isAnonymous: true, donorName: 'Hidden Name' });
    const done = await client.call<{ donation: Receipt }>('POST', `/api/donations/${r.body.donationId}/sandbox-complete`, {
      body: { outcome: 'success', paymentMethod: 'bkash' },
    });
    expect(done.status).toBe(200);
    expect(done.body.donation).toMatchObject({ status: 'completed', paymentMethod: 'bkash', isAnonymous: true, donorName: null });
    const again = await client.call('POST', `/api/donations/${r.body.donationId}/sandbox-complete`, { body: { outcome: 'fail', paymentMethod: 'nagad' } });
    expect(again.status).toBe(409);
    const after = await client.call<{ totalBdt: number; completedCount: number; latest: Receipt[] }>('GET', '/api/donations/summary');
    expect(after.body.totalBdt - before.body.totalBdt).toBe(2500);
    expect(after.body.completedCount - before.body.completedCount).toBe(1);
    expect(after.body.latest[0]?.donorName).toBeNull();
  });

  it('failed and cancelled payments do not count', async () => {
    const before = await client.call<{ totalBdt: number }>('GET', '/api/donations/summary');
    for (const outcome of ['fail', 'cancel']) {
      const r = await initiate({ amountBdt: 700, donorName: 'Someone' });
      const s = await client.call<{ donation: Receipt }>('POST', `/api/donations/${r.body.donationId}/sandbox-complete`, { body: { outcome, paymentMethod: 'visa' } });
      expect(s.body.donation.status).toBe(outcome === 'fail' ? 'failed' : 'cancelled');
    }
    const after = await client.call<{ totalBdt: number }>('GET', '/api/donations/summary');
    expect(after.body.totalBdt).toBe(before.body.totalBdt);
  });

  it('lets a donor cancel before choosing a method, but a success needs one', async () => {
    const a = await initiate({ amountBdt: 300, isAnonymous: true });
    const noMethod = await client.call('POST', `/api/donations/${a.body.donationId}/sandbox-complete`, { body: { outcome: 'success' } });
    expect(noMethod.status).toBe(400);
    const cancel = await client.call<{ donation: Receipt }>('POST', `/api/donations/${a.body.donationId}/sandbox-complete`, { body: { outcome: 'cancel' } });
    expect(cancel.body.donation).toMatchObject({ status: 'cancelled', paymentMethod: null });
  });

  it('seeds demo donations only into an empty fund', async () => {
    expect(await seedDonations(env.runtime.ctx, null as unknown as string)).toBe(0);
  });
});
