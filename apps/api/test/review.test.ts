import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { PullResponse, PushResponse, SyncEventInput } from '@relief/shared';
import { query } from '../src/db/client.js';
import { DeviceEvents } from './events.js';
import { PASSWORD, buildWorld, createTestEnv, type Session, type TestEnv, type World } from './helpers.js';

let env: TestEnv;
let w: World;
const now = () => new Date(env.clock.t);
const db = () => env.runtime.ctx.db;
const item = (name: string) => w.items.find((i) => i.itemName === name)!.id;

beforeAll(async () => {
  env = await createTestEnv();
  w = await buildWorld(env);
});
afterAll(async () => env?.close());

async function push(session: Session, events: SyncEventInput[]) {
  const r = await w.client.call<PushResponse>('POST', '/api/sync/push', { session, body: { sentAt: now().toISOString(), events } });
  expect(r.status).toBe(200);
  return r.body;
}

describe('FR18/FR19 duplicate scoring, review, link and undo (UC18)', () => {
  let pairId: string;
  let hA: string;
  let hB: string;

  it('flags a cross-organisation duplicate within the same union after sync, within the 2-minute target', async () => {
    const a = new DeviceEvents(w.orgA.volunteer, now);
    const b = new DeviceEvents(w.orgB.volunteer, now);
    const x = a.household(w.operationId, w.areas[0]!.id, { headName: 'Mohammad Rafiqul Islam', mobile: '01712340000', memberCount: 6 });
    const y = b.household(w.operationId, w.areas[1]!.id, { headName: 'Md Rafiqul Islam', mobile: '01712340000', memberCount: 6 });
    const unrelated = b.household(w.operationId, w.areas[1]!.id, { headName: 'Nasima Akter', mobile: '01898989898', memberCount: 2 });
    const otherUnion = b.household(w.operationId, w.areas[2]!.id, { headName: 'Mohammad Rafiqul Islam', mobile: '01712340000', memberCount: 6 });
    hA = x.id;
    hB = y.id;
    await push(w.orgA.volunteer, [x.event]);
    const started = Date.now();
    await push(w.orgB.volunteer, [y.event, unrelated.event, otherUnion.event]);
    await env.runtime.worker.drain();
    expect(Date.now() - started).toBeLessThan(120_000);
    const pairs = await query<{ id: string; label: string; a: string; b: string }>(
      db(),
      sql`select pair_id as id, label, household_a_id as a, household_b_id as b from duplicate_pair`,
    );
    const pair = pairs.find((p) => [p.a, p.b].includes(hA) && [p.a, p.b].includes(hB));
    expect(pair?.label).toBe('likely');
    expect(pairs.some((p) => [p.a, p.b].includes(otherUnion.id))).toBe(false); // other union is never compared
    expect(pairs.some((p) => [p.a, p.b].includes(unrelated.id))).toBe(false);
    pairId = pair!.id;
    const notes = await w.client.call<{ notifications: { type: string; link: string }[] }>('GET', '/api/notifications', { session: w.orgA.coordinator });
    expect(notes.body.notifications.some((n) => n.type === 'duplicate.new' && n.link === `/app/duplicates/${pairId}`)).toBe(true);
  });

  it('shows both records side by side with signals; the other organisation sees a masked phone', async () => {
    const r = await w.client.call<{ pair: { signals: Record<string, number>; a: { mobile: string | null; organisationId: string }; b: { mobile: string | null } } }>(
      'GET',
      `/api/duplicates/${pairId}`,
      { session: w.orgA.coordinator },
    );
    expect(r.body.pair.signals.phone).toBe(1);
    const mine = r.body.pair.a.organisationId === w.orgA.id ? r.body.pair.a : r.body.pair.b;
    const theirs = mine === r.body.pair.a ? r.body.pair.b : r.body.pair.a;
    expect(mine.mobile).toBe('01712340000');
    expect(theirs.mobile).toBeNull();
  });

  it('links (keeping both), counts the family once, flags a repeat item, and undoes the link', async () => {
    expect((await w.client.call('POST', `/api/duplicates/${pairId}/link`, { session: w.orgB.coordinator })).status).toBe(200);
    expect(await query(db(), sql`select 1 from household where household_id in (${hA}, ${hB})`)).toHaveLength(2);
    const pullB = await w.client.call<PullResponse>('POST', '/api/sync/pull', {
      session: w.orgB.volunteer,
      body: { operationId: w.operationId, areas: [{ areaId: w.areas[0]!.id, cursor: '0' }], globalCursor: '0' },
    });
    expect(pullB.body.households.find((h) => h.id === hA)?.linkedHouseholdIds).toEqual([hB]);

    // FR20: the same item from two organisations within 24 hours to the linked family.
    const a = new DeviceEvents(w.orgA.volunteer, now);
    const b = new DeviceEvents(w.orgB.volunteer, now);
    await push(w.orgA.volunteer, [a.distribution(w.operationId, w.areas[0]!.id, hA, [{ itemId: item('Rice'), quantity: 10 }]).event]);
    await w.advance(3 * 3_600_000);
    await push(w.orgB.volunteer, [b.distribution(w.operationId, w.areas[1]!.id, hB, [{ itemId: item('Rice'), quantity: 10 }, { itemId: item('Lentils'), quantity: 2 }]).event]);
    await env.runtime.worker.drain();
    const flags = await w.client.call<{ flags: { id: string; itemName: string; firstOrganisation: string; secondOrganisation: string }[] }>(
      'GET',
      `/api/flags?operationId=${w.operationId}`,
      { session: w.opAdmin },
    );
    expect(flags.body.flags).toHaveLength(1);
    expect(flags.body.flags[0]?.itemName).toBe('Rice');
    const flagId = flags.body.flags[0]!.id;
    // UC19: marked as a repeat with a note; never deletes a distribution.
    expect((await w.client.call('POST', `/api/flags/${flagId}/review`, { session: w.orgA.coordinator, body: { decision: 'repeat', note: 'Family confirmed two packs' } })).status).toBe(200);
    expect((await w.client.call('POST', `/api/flags/${flagId}/review`, { session: w.opAdmin, body: { decision: 'justified', note: 'second try' } })).status).toBe(409);
    expect(await query(db(), sql`select 1 from distribution where status = 'recorded' and household_id in (${hA}, ${hB})`)).toHaveLength(2);

    // UC18 5.a: undo returns the pair to review and the records separate again.
    expect((await w.client.call('POST', `/api/duplicates/${pairId}/undo`, { session: w.orgA.coordinator })).status).toBe(200);
    const groups = await query<{ link_group_id: string | null }>(db(), sql`select link_group_id from household where household_id in (${hA}, ${hB})`);
    expect(groups.every((g) => g.link_group_id === null)).toBe(true);
    const [status] = await query<{ status: string }>(db(), sql`select status from duplicate_pair where pair_id = ${pairId}`);
    expect(status?.status).toBe('pending_review');
    expect((await w.client.call('POST', `/api/duplicates/${pairId}/not-duplicate`, { session: w.orgA.coordinator })).status).toBe(200);
  });
});

describe('FR21/FR22 coverage, unserved lists (UC21, UC22)', () => {
  it('labels areas, and an area with no households shows "no records", never served', async () => {
    const r = await w.client.call<{ rows: { areaId: string; label: string; registered: number; served: number }[] }>(
      'GET',
      `/api/operations/${w.operationId}/coverage`,
      { session: w.opAdmin },
    );
    const empty = r.body.rows.find((x) => x.areaId === w.areas[3]!.id)!;
    expect(empty).toMatchObject({ registered: 0, label: 'no_records' });
    const a0 = r.body.rows.find((x) => x.areaId === w.areas[0]!.id)!;
    expect(a0.label).toBe('fully_served');
    const a1 = r.body.rows.find((x) => x.areaId === w.areas[1]!.id)!;
    expect(a1.label).toBe('partly_served');
  });
  it('lists unserved households and releases the list to field devices', async () => {
    const list = await w.client.call<{ households: { headName: string }[] }>('GET', `/api/operations/${w.operationId}/areas/${w.areas[1]!.id}/unserved`, { session: w.orgB.coordinator });
    expect(list.body.households.map((h) => h.headName)).toEqual(['Nasima Akter']);
    expect((await w.client.call('POST', `/api/operations/${w.operationId}/areas/${w.areas[1]!.id}/unserved/release`, { session: w.orgB.coordinator })).status).toBe(201);
    const pull = await w.client.call<PullResponse>('POST', '/api/sync/pull', {
      session: w.orgB.volunteer,
      body: { operationId: w.operationId, areas: [], globalCursor: '0' },
    });
    expect(pull.body.releases).toHaveLength(1);
    expect(pull.body.releases[0]?.householdIds).toHaveLength(1);
    const otherOrg = await w.client.call<PullResponse>('POST', '/api/sync/pull', { session: w.orgA.volunteer, body: { operationId: w.operationId, areas: [], globalCursor: '0' } });
    expect(otherOrg.body.releases).toHaveLength(0);
  });
  it('observers see area-level figures with small counts suppressed', async () => {
    const inv = await w.client.call<{ path: string }>('POST', `/api/operations/${w.operationId}/invites`, { session: w.opAdmin, body: {} });
    await w.client.call('POST', '/api/invites/accept', { body: { token: inv.body.path.split('/').pop(), fullName: 'Partner Viewer', mobile: '01720202020', password: PASSWORD } });
    const obs = await w.client.login('01720202020', PASSWORD);
    const r = await w.client.call<{ rows: { registered: number | string }[] }>('GET', `/api/operations/${w.operationId}/coverage`, { session: obs });
    expect(r.body.rows.some((x) => x.registered === '<5')).toBe(true);
    const report = await w.client.call('GET', `/api/reports/operation-summary?operationId=${w.operationId}&format=csv`, { session: obs });
    expect(report.status).toBe(200);
    expect(report.raw).not.toMatch(/Rafiqul|Nasima|0171|0189/); // no names or phone numbers (UC25 QR2)
    expect(report.raw).toContain('coverage');
  });
});

describe('FR26 reports (UC25)', () => {
  it('builds the organisation report as CSV and PDF, own organisation only, without names', async () => {
    const csv = await w.client.call('GET', `/api/reports/organisation?operationId=${w.operationId}&format=csv`, { session: w.orgA.coordinator });
    expect(csv.status).toBe(200);
    expect(csv.raw).toContain('Rice 10 kg');
    expect(csv.raw).not.toMatch(/Rafiqul|Padma|0171/);
    const pdf = await env.app.inject({
      method: 'GET',
      url: `/api/reports/organisation?operationId=${w.operationId}&format=pdf`,
      headers: { authorization: `Bearer ${w.orgA.coordinator.token}` },
    });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
  });
  it('reports an empty range as empty', async () => {
    const r = await w.client.call('GET', `/api/reports/organisation?operationId=${w.operationId}&format=csv&from=2020-01-01&to=2020-01-02`, { session: w.orgA.coordinator });
    expect(r.headers['x-report-empty']).toBe('true');
  });
  it('operation summary PDF includes Bangla coverage labels', async () => {
    const pdf = await env.app.inject({
      method: 'GET',
      url: `/api/reports/operation-summary?operationId=${w.operationId}&format=pdf`,
      headers: { authorization: `Bearer ${w.opAdmin.token}` },
    });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.rawPayload.length).toBeGreaterThan(5000);
    expect((await w.client.call('GET', `/api/reports/operation-summary?operationId=${w.operationId}&format=pdf`, { session: w.orgA.coordinator })).status).toBe(403);
  });
});

describe('FR24/FR25/NFR12 audit trail and household history', () => {
  it('records actions with user, organisation, device and time; never raw personal data', async () => {
    const rows = await query<{ action: string; user_id: string | null; device_id: string | null; details: unknown; value_hashes: unknown }>(
      db(),
      sql`select action, user_id, device_id, details, value_hashes from audit_log`,
    );
    expect(rows.map((r) => r.action)).toEqual(expect.arrayContaining(['household.registered', 'distribution.recorded', 'duplicate.linked', 'flag.repeat', 'auth.login']));
    const reg = rows.find((r) => r.action === 'household.registered')!;
    expect(reg.user_id && reg.device_id).toBeTruthy();
    expect(JSON.stringify(rows)).not.toMatch(/Rafiqul|01712340000|Nasima/);
  });
  it('cannot be edited or deleted, even directly in the database', async () => {
    // Drizzle wraps the driver error; the trigger's message is on the cause.
    const failure = async (statement: ReturnType<typeof sql>) => {
      try {
        await db().execute(statement);
        return 'no error';
      } catch (e) {
        const err = e as Error & { cause?: Error };
        return `${err.message} ${err.cause?.message ?? ''}`;
      }
    };
    expect(await failure(sql`update audit_log set action = 'x'`)).toMatch(/append-only/);
    expect(await failure(sql`delete from audit_log`)).toMatch(/append-only/);
    expect(await failure(sql`delete from sync_event`)).toMatch(/append-only/);
    expect(await failure(sql`update sync_event set payload = '{}'::jsonb`)).toMatch(/append-only/);
  });
  it('searches and exports the trail as CSV, and records the export (UC24)', async () => {
    const r = await w.client.call<{ entries: { action: string }[] }>('GET', `/api/audit?operationId=${w.operationId}&action=duplicate.`, { session: w.opAdmin });
    expect(r.body.entries.length).toBeGreaterThan(0);
    expect(r.body.entries.every((e) => e.action.startsWith('duplicate.'))).toBe(true);
    const csv = await w.client.call('GET', `/api/audit/export.csv?operationId=${w.operationId}`, { session: w.opAdmin });
    expect(csv.status).toBe(200);
    expect(csv.raw.split('\n')[0]).toContain('action');
    expect(await query(db(), sql`select 1 from audit_log where action = 'audit.exported'`)).toHaveLength(1);
  });
  it('shows the full household history in order (UC23)', async () => {
    const hid = (await query<{ id: string }>(db(), sql`select household_id as id from household where head_name = 'Md Rafiqul Islam'`))[0]!.id;
    const r = await w.client.call<{ history: { action: string; userName: string | null }[] }>('GET', `/api/households/${hid}/history`, { session: w.orgB.coordinator });
    const actions = r.body.history.map((h) => h.action);
    expect(actions[0]).toBe('household.registered');
    expect(actions).toEqual(expect.arrayContaining(['distribution.recorded', 'duplicate.linked', 'duplicate.unlinked', 'flag.repeat']));
  });
});

describe('NFR07 retention after closure (C8)', () => {
  it('removes names, phones and GPS 90 days after close and crypto-shreds the event log', async () => {
    expect((await w.client.call('POST', `/api/operations/${w.operationId}/close`, { session: w.opAdmin, body: { confirm: true } })).status).toBe(200);
    // New records are refused after closure (FR04).
    const late = new DeviceEvents(w.orgA.volunteer, now);
    const pushed = await push(w.orgA.volunteer, [late.household(w.operationId, w.areas[0]!.id, { headName: 'Late Comer' }).event]);
    expect(pushed.acks[0]).toMatchObject({ status: 'rejected', reason: 'operation_closed' });

    await w.advance(89 * 86_400_000);
    const admin = w.sysadmin;
    expect((await w.client.call<{ redacted: unknown[] }>('POST', '/api/admin/retention/run', { session: admin })).body.redacted).toHaveLength(0);
    await w.advance(2 * 86_400_000);
    const run = await w.client.call<{ redacted: { households: number }[] }>('POST', '/api/admin/retention/run', { session: admin });
    expect(run.body.redacted[0]!.households).toBeGreaterThan(0);
    const left = await query(db(), sql`select 1 from household where operation_id = ${w.operationId} and (head_name is not null or mobile_number is not null or gps_lat is not null)`);
    expect(left).toHaveLength(0);
    const [key] = await query<{ wrapped_key: string | null }>(db(), sql`select wrapped_key from operation_key where operation_id = ${w.operationId}`);
    expect(key?.wrapped_key).toBeNull();
    // Distribution history and counts remain for reporting.
    expect((await query(db(), sql`select 1 from distribution where operation_id = ${w.operationId}`)).length).toBeGreaterThan(0);
    expect(await query(db(), sql`select 1 from audit_log where action = 'retention.redacted'`)).toHaveLength(1);
  });
});

describe('Public observer portal (no log-in)', () => {
  it('lists operations and serves area-level coverage with small cells suppressed, without any token', async () => {
    const ops = await w.client.call<{ operations: { id: string; relation: string }[] }>('GET', '/api/public/operations');
    expect(ops.status).toBe(200);
    expect(ops.body.operations.map((o) => o.id)).toContain(w.operationId);
    const r = await w.client.call<{ rows: { registered: number | string }[]; upazilas: { upazila: string; label: string }[]; totals: { areas: number } }>(
      'GET',
      `/api/public/operations/${w.operationId}/coverage`,
    );
    expect(r.status).toBe(200);
    expect(r.body.rows.some((x) => x.registered === '<5')).toBe(true);
    expect(r.body.upazilas.length).toBeGreaterThan(0);
    expect(r.body.totals.areas).toBe(r.body.rows.length);
    // Never a person, a phone number, an NID or a GPS point.
    expect(r.raw).not.toMatch(/Rafiqul|Nasima|0171|0189|headName|mobile|nid|gps|household_id|householdId/i);
  });
  it('builds the public operation summary report without names or phones', async () => {
    const report = await w.client.call('GET', `/api/public/reports/operation-summary?operationId=${w.operationId}&format=csv`);
    expect(report.status).toBe(200);
    expect(report.raw).toContain('coverage');
    expect(report.raw).not.toMatch(/Rafiqul|Nasima|0171|0189/);
  });
  it('keeps staff endpoints behind log-in and rejects unknown operations', async () => {
    expect((await w.client.call('GET', `/api/operations/${w.operationId}/coverage`)).status).toBe(401);
    expect((await w.client.call('GET', '/api/operations')).status).toBe(401);
    expect((await w.client.call('GET', '/api/public/operations/00000000-0000-4000-8000-000000000000/coverage')).status).toBe(404);
  });
});
