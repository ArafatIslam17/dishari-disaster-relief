import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { sql } from 'drizzle-orm';
import type { PullResponse, PushResponse, SyncEventInput } from '@relief/shared';
import { query } from '../src/db/client.js';
import { DeviceEvents } from './events.js';
import { buildWorld, createTestEnv, type Session, type TestEnv, type World } from './helpers.js';

let env: TestEnv;
let w: World;
const now = () => new Date(env.clock.t);
/** Head names are Latin letters only (C10): 0 -> 'Aa', 1 -> 'Ab', ... */
const tag = (i: number) => String.fromCharCode(65 + Math.floor(i / 26) % 26) + String.fromCharCode(97 + (i % 26));

beforeAll(async () => {
  env = await createTestEnv();
  w = await buildWorld(env);
});
afterAll(async () => env?.close());

async function push(session: Session, events: SyncEventInput[], sentAt = now()) {
  const r = await w.client.call<PushResponse>('POST', '/api/sync/push', { session, body: { sentAt: sentAt.toISOString(), events } });
  if (r.status !== 200) throw new Error(`push ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}
async function pull(session: Session, areaIds: string[], cursors: Record<string, string> = {}) {
  const r = await w.client.call<PullResponse>('POST', '/api/sync/pull', {
    session,
    body: { operationId: w.operationId, areas: areaIds.map((areaId) => ({ areaId, cursor: cursors[areaId] ?? '0' })), globalCursor: '0' },
  });
  if (r.status !== 200) throw new Error(`pull ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}
const count = async (table: string, where = sql`true`) =>
  Number((await query<{ n: number }>(env.runtime.ctx.db, sql`select count(*)::int as n from ${sql.identifier(table)} where ${where}`))[0]?.n);

describe('FR13/FR14 push: batches, acknowledgements, exactly once', () => {
  it('stores a household and a distribution and acknowledges each event', async () => {
    const dev = new DeviceEvents(w.orgA.volunteer, now);
    const area = w.areas[0]!;
    const h = dev.household(w.operationId, area.id, { headName: 'Abdul Karim', mobile: '01911111111', memberCount: 5 });
    const d = dev.distribution(w.operationId, area.id, h.id, [{ itemId: w.items[0]!.id, quantity: 10 }]);
    const res = await push(w.orgA.volunteer, [h.event, d.event]);
    expect(res.acks.map((a) => a.status)).toEqual(['applied', 'applied']);
    // A repeated upload is confirmed but stored once (UC16 3.a).
    const again = await push(w.orgA.volunteer, [h.event, d.event]);
    expect(again.acks.map((a) => a.status)).toEqual(['duplicate', 'duplicate']);
    expect(await count('sync_event', sql`event_id in (${h.event.eventId}, ${d.event.eventId})`)).toBe(2);
    expect(await count('household', sql`household_id = ${h.id}`)).toBe(1);
  });

  it('keeps personal data out of the event payload; it is encrypted under the operation key (C8)', async () => {
    const [row] = await query<{ payload: unknown; pii_enc: string | null }>(
      env.runtime.ctx.db,
      sql`select payload, pii_enc from sync_event where entity_type = 'household' and action = 'create' limit 1`,
    );
    expect(JSON.stringify(row?.payload)).not.toMatch(/Abdul|0191/);
    expect(row?.pii_enc).toBeTruthy();
  });

  it('rejects a malformed event without blocking the rest of the batch', async () => {
    const dev = new DeviceEvents(w.orgA.volunteer, now);
    const ok = dev.household(w.operationId, w.areas[0]!.id, { headName: 'Rahima Begum' });
    const bad = { ...dev.household(w.operationId, w.areas[0]!.id, { headName: 'Bad 123' }).event };
    const res = await push(w.orgA.volunteer, [bad, ok.event]);
    expect(res.acks[0]?.status).toBe('rejected');
    expect(res.acks[1]?.status).toBe('applied');
  });

  it('handles an update and a distribution that arrive before their household (out of order, NFR09)', async () => {
    const dev = new DeviceEvents(w.orgA.volunteer, now);
    const h = dev.household(w.operationId, w.areas[1]!.id, { headName: 'Jamal Uddin', memberCount: 3 });
    const upd = dev.update(h.id, 1, { memberCount: 4 });
    const d = dev.distribution(w.operationId, w.areas[1]!.id, h.id, [{ itemId: w.items[1]!.id, quantity: 2 }]);
    const first = await push(w.orgA.volunteer, [upd, d.event]);
    expect(first.acks.map((a) => a.status)).toEqual(['deferred', 'deferred']);
    const second = await push(w.orgA.volunteer, [h.event]);
    expect(second.acks[0]?.status).toBe('applied');
    const [row] = await query<{ member_count: number; version: number }>(env.runtime.ctx.db, sql`select member_count, version from household where household_id = ${h.id}`);
    expect(row).toEqual({ member_count: 4, version: 2 });
    expect(await count('distribution', sql`distribution_id = ${d.id}`)).toBe(1);
    expect(await count('sync_event', sql`status = 'deferred' and entity_id in (${h.id}, ${d.id})`)).toBe(0);
  });

  it('property: random batches, repeats and reordering store every event exactly once (NFR09) and converge (NFR10)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.record({ device: fc.integer({ min: 0, max: 2 }), kind: fc.integer({ min: 0, max: 9 }) }), { minLength: 4, maxLength: 24 }),
        fc.array(fc.integer({ min: 1, max: 3 }), { minLength: 24, maxLength: 24 }),
        fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 72, maxLength: 72 }),
        fc.integer({ min: 1, max: 7 }),
        async (plan, repeats, keys, batchSize) => {
          const sessions = [w.orgA.volunteer, w.orgA.volunteer2, w.orgB.volunteer];
          const devices = sessions.map((s) => new DeviceEvents(s, now));
          const area = w.areas[2]!;
          const households: string[] = [];
          const produced: { device: number; event: SyncEventInput }[] = [];
          for (const step of plan) {
            const dev = devices[step.device]!;
            if (households.length === 0 || step.kind < 4) {
              const h = dev.household(w.operationId, area.id, { headName: `Prop Person ${tag(produced.length)}` });
              households.push(h.id);
              produced.push({ device: step.device, event: h.event });
            } else if (step.kind < 7) {
              const target = households[step.kind % households.length]!;
              produced.push({ device: step.device, event: dev.distribution(w.operationId, area.id, target, [{ itemId: w.items[2]!.id, quantity: 1 }]).event });
            } else {
              const target = households[step.kind % households.length]!;
              produced.push({ device: step.device, event: dev.update(target, 1, { memberCount: (step.kind % 5) + 1 }) });
            }
          }
          // Each event is delivered 1-3 times in a shuffled order, grouped into per-device batches.
          const deliveries = produced.flatMap((p, i) =>
            Array.from({ length: repeats[i % repeats.length]! }, (_, r) => ({ ...p, key: keys[(i * 3 + r) % keys.length]! + r })),
          );
          deliveries.sort((a, b) => a.key - b.key);
          for (let i = 0; i < deliveries.length; ) {
            const device = deliveries[i]!.device;
            const batch: SyncEventInput[] = [];
            while (i < deliveries.length && deliveries[i]!.device === device && batch.length < batchSize) batch.push(deliveries[i++]!.event);
            await push(sessions[device]!, batch);
          }
          const ids = produced.map((p) => p.event.eventId);
          const stored = await query<{ event_id: string; status: string }>(
            env.runtime.ctx.db,
            sql`select event_id, status from sync_event where event_id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`,
          );
          expect(stored).toHaveLength(ids.length); // exactly once
          expect(stored.filter((s) => s.status === 'deferred')).toHaveLength(0);
          expect(await count('household', sql`household_id in (${sql.join(households.map((h) => sql`${h}::uuid`), sql`, `)})`)).toBe(households.length);
          // Convergence: every device sees the same households with the same versions.
          const views = await Promise.all(sessions.map((s) => pull(s, [area.id])));
          const fingerprint = (r: PullResponse) =>
            r.households.map((h) => `${h.id}:${h.version}:${h.memberCount}`).sort().join('|');
          expect(new Set(views.map(fingerprint)).size).toBe(1);
          return true;
        },
      ),
      { numRuns: 12 },
    );
  });
});

describe('FR16/NFR11 field-level merge and conflicts', () => {
  it('merges different fields and records a conflict for the same field (100% of injected conflicts)', async () => {
    const a = new DeviceEvents(w.orgA.volunteer, now);
    const b = new DeviceEvents(w.orgB.volunteer, now);
    const injected = 10;
    const created: { id: string; event: SyncEventInput }[] = [];
    for (let i = 0; i < injected; i++) {
      created.push(a.household(w.operationId, w.areas[0]!.id, { headName: `Conflict Case ${tag(i)}`, memberCount: 4 }));
    }
    await push(w.orgA.volunteer, created.map((c) => c.event));
    // Offline on two devices from the same base version 1:
    await push(w.orgA.volunteer, created.map((c) => a.update(c.id, 1, { memberCount: 5, headName: `Conflict Case Edited` })));
    const res = await push(w.orgB.volunteer, created.map((c) => b.update(c.id, 1, { memberCount: 6 })));
    expect(res.acks.every((x) => x.status === 'conflict')).toBe(true);
    const conflicts = await query<{ field_name: string; local_value: string; server_value: string }>(
      env.runtime.ctx.db,
      sql`select field_name, local_value, server_value from conflict where household_id in (${sql.join(created.map((c) => sql`${c.id}::uuid`), sql`, `)})`,
    );
    expect(conflicts).toHaveLength(injected);
    expect(conflicts.every((c) => c.field_name === 'memberCount' && c.local_value === '6' && c.server_value === '5')).toBe(true);

    // A different-field edit from B merges cleanly.
    const merged = await push(w.orgB.volunteer, [b.update(created[0]!.id, 1, { areaId: w.areas[1]!.id })]);
    expect(merged.acks[0]?.status).toBe('applied');

    // Coordinators of both organisations are notified (FR23).
    const notes = await w.client.call<{ notifications: { type: string }[] }>('GET', '/api/notifications', { session: w.orgB.coordinator });
    expect(notes.body.notifications.some((n) => n.type === 'conflict.new')).toBe(true);

    // UC17: the coordinator compares both values and saves a corrected one as a new version.
    const list = await w.client.call<{ conflicts: { id: string; householdId: string; localUserName: string; serverUserName: string }[] }>(
      'GET',
      `/api/conflicts?operationId=${w.operationId}`,
      { session: w.orgA.coordinator },
    );
    const target = list.body.conflicts.find((c) => c.householdId === created[0]!.id)!;
    expect(target.localUserName).toBeTruthy();
    expect(target.serverUserName).toBeTruthy();
    const before = await query<{ version: number }>(env.runtime.ctx.db, sql`select version from household where household_id = ${created[0]!.id}`);
    expect((await w.client.call('POST', `/api/conflicts/${target.id}/resolve`, { session: w.orgA.coordinator, body: { value: 7 } })).status).toBe(200);
    const after = await query<{ version: number; member_count: number }>(env.runtime.ctx.db, sql`select version, member_count from household where household_id = ${created[0]!.id}`);
    expect(after[0]?.member_count).toBe(7);
    expect(after[0]!.version).toBe(before[0]!.version + 1);
    expect((await w.client.call('POST', `/api/conflicts/${target.id}/resolve`, { session: w.orgB.coordinator, body: { value: 6 } })).status).toBe(409);
  });

  it('only the registering organisation may change the mobile number (C27)', async () => {
    const a = new DeviceEvents(w.orgA.volunteer, now);
    const b = new DeviceEvents(w.orgB.volunteer, now);
    const h = a.household(w.operationId, w.areas[0]!.id, { headName: 'Phone Owner', mobile: '01912345678' });
    await push(w.orgA.volunteer, [h.event]);
    const res = await push(w.orgB.volunteer, [b.update(h.id, 1, { mobile: '01800000000' })]);
    expect(res.acks[0]).toMatchObject({ status: 'rejected', reason: 'mobile_not_editable' });
  });
});

describe('FR15 pull and NFR06 masking', () => {
  it('returns the raw number only to the registering organisation', async () => {
    const own = await pull(w.orgA.volunteer2, [w.areas[0]!.id]);
    const other = await pull(w.orgB.volunteer, [w.areas[0]!.id]);
    const mine = own.households.find((h) => h.headName === 'Abdul Karim')!;
    const theirs = other.households.find((h) => h.id === mine.id)!;
    expect(mine.mobile).toBe('01911111111');
    expect(theirs.mobile).toBeNull();
    expect(theirs.mobileMasked).toBe('019******11');
    expect(theirs.mobileHmac).toBe(mine.mobileHmac);
  });
  it('advances per-area cursors and returns only changes after them', async () => {
    const first = await pull(w.orgB.volunteer, [w.areas[0]!.id]);
    const second = await pull(w.orgB.volunteer, [w.areas[0]!.id], first.areaCursors);
    expect(second.households).toHaveLength(0);
    const dev = new DeviceEvents(w.orgA.volunteer, now);
    await push(w.orgA.volunteer, [dev.household(w.operationId, w.areas[0]!.id, { headName: 'New Arrival' }).event]);
    const third = await pull(w.orgB.volunteer, [w.areas[0]!.id], first.areaCursors);
    expect(third.households.map((h) => h.headName)).toEqual(['New Arrival']);
  });
  it('paginates large areas without skipping rows', async () => {
    const dev = new DeviceEvents(w.orgB.volunteer, now);
    const area = w.areas[3]!;
    const events = Array.from({ length: 260 }, (_, i) => dev.household(w.operationId, area.id, { headName: `Bulk Person ${tag(i)}` }).event);
    for (let i = 0; i < events.length; i += 100) await push(w.orgB.volunteer, events.slice(i, i + 100));
    const seen = new Set<string>();
    let cursors: Record<string, string> = {};
    for (let page = 0; page < 10; page++) {
      const r = await w.client.call<PullResponse>('POST', '/api/sync/pull', {
        session: w.orgA.volunteer,
        body: { operationId: w.operationId, areas: [{ areaId: area.id, cursor: cursors[area.id] ?? '0' }], globalCursor: '0', limit: 100 },
      });
      r.body.households.forEach((h) => seen.add(h.id));
      cursors = r.body.areaCursors;
      if (!r.body.hasMore) break;
    }
    expect(seen.size).toBe(260);
  });
});

describe('C6 short codes, C7 clock skew, FR12 voiding', () => {
  it('reissues a clashing short code and tells the volunteer', async () => {
    const a = new DeviceEvents(w.orgA.volunteer, now);
    const first = a.household(w.operationId, w.areas[0]!.id, { headName: 'First Holder' });
    await push(w.orgA.volunteer, [first.event]);
    const code = (first.event.payload as { shortCode: string }).shortCode;
    const b = new DeviceEvents(w.orgB.volunteer, now);
    const clash = b.household(w.operationId, w.areas[0]!.id, { headName: 'Second Holder', shortCode: code });
    const res = await push(w.orgB.volunteer, [clash.event]);
    expect(res.acks[0]?.shortCode).toBeTruthy();
    expect(res.acks[0]?.shortCode).not.toBe(code);
    expect(res.acks[0]?.shortCode?.startsWith(w.orgB.volunteer.devicePrefix)).toBe(true);
  });

  it('corrects a skewed device clock and enforces the 24-hour cancel window on server time', async () => {
    const skewMs = -3 * 3_600_000; // phone clock 3 hours slow
    const deviceNow = () => new Date(env.clock.t + skewMs);
    const dev = new DeviceEvents(w.orgA.volunteer, deviceNow);
    const d = dev.distribution(w.operationId, w.areas[0]!.id, null, [{ itemId: w.items[0]!.id, quantity: 5 }]);
    const res = await push(w.orgA.volunteer, [d.event], deviceNow());
    expect(Math.round(res.clockOffsetMs / 1000)).toBe(-skewMs / 1000);
    const [row] = await query<{ distributed_at: Date }>(env.runtime.ctx.db, sql`select distributed_at from distribution where distribution_id = ${d.id}`);
    expect(Math.abs(new Date(row!.distributed_at).getTime() - env.clock.t)).toBeLessThan(5000);
    // Another user cannot cancel it (UC15 2.b).
    const other = new DeviceEvents(w.orgA.volunteer2, now);
    expect((await push(w.orgA.volunteer2, [other.void(d.id)])).acks[0]).toMatchObject({ status: 'rejected', reason: 'not_owner' });
    // 23 hours of real time later the owner may cancel, even though the phone clock says only 20.
    env.advance(23 * 3_600_000);
    const fresh = await w.client.login('01733333333', 'Relief2026pass', w.orgA.volunteer.deviceId);
    w.orgA.volunteer.token = fresh.token;
    const v = await push(w.orgA.volunteer, [dev.void(d.id)], deviceNow());
    expect(v.acks[0]?.status).toBe('applied');
    const [voided] = await query<{ status: string; cancel_reason: string }>(env.runtime.ctx.db, sql`select status, cancel_reason from distribution where distribution_id = ${d.id}`);
    expect(voided).toEqual({ status: 'voided', cancel_reason: 'Entered by mistake' });
  });

  it('rejects a cancellation after 24 hours', async () => {
    const dev = new DeviceEvents(w.orgA.volunteer, now);
    const d = dev.distribution(w.operationId, w.areas[0]!.id, null, [{ itemId: w.items[0]!.id, quantity: 1 }]);
    await push(w.orgA.volunteer, [d.event]);
    env.advance(25 * 3_600_000);
    for (const s of [w.orgA.volunteer]) s.token = (await w.client.login('01733333333', 'Relief2026pass', s.deviceId)).token;
    const v = await push(w.orgA.volunteer, [dev.void(d.id)]);
    expect(v.acks[0]).toMatchObject({ status: 'rejected', reason: 'void_window_expired' });
  });
});
