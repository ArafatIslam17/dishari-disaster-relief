import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isValidShortCode, runSync, uuidv7, type PullResponse, type PushResponse, type SyncTransport } from '@relief/shared';
import { LocalStore, UnlockError } from '../src/local/store';
import { phoneHmac } from '../src/local/crypto';

const RECOVERY = Buffer.alloc(32, 7).toString('base64');
const PHONE_KEY = Buffer.alloc(32, 9).toString('base64');
const OP = uuidv7();
const AREA = uuidv7();
const AREA2 = uuidv7();
const ITEM = uuidv7();

let store: LocalStore;
let name: string;

async function freshStore(): Promise<LocalStore> {
  name = `test-${uuidv7()}`;
  const s = new LocalStore(name, 1000); // fewer PBKDF2 iterations to keep unit tests fast
  await s.openWithRecovery(RECOVERY);
  await s.saveSession({
    userId: 'u1',
    fullName: 'Field Volunteer',
    role: 'FIELD_VOLUNTEER',
    organisationId: 'org-a',
    organisationName: 'Shapla Relief Team',
    deviceId: uuidv7(),
    devicePrefix: 'K7M',
    lastOnlineAuthAt: new Date().toISOString(),
    operationId: OP,
  });
  await s.setPhoneKey(PHONE_KEY);
  const area = (id: string, ward: string) => ({
    id,
    operationId: OP,
    upazila: 'Feni Sadar',
    unionName: 'Dharmapur',
    ward,
    upazilaBn: 'ফেনী সদর',
    unionBn: 'ধর্মপুর',
    downloadedAt: new Date().toISOString(),
    cursor: '0',
  });
  await s.storeAreasAndItems([area(AREA, '1'), area(AREA2, '2')], [{ id: ITEM, operationId: OP, itemName: 'Rice', itemNameBn: 'চাল', unit: 'kg', active: true }]);
  await s.selectAreas([AREA, AREA2]);
  return s;
}

beforeEach(async () => {
  store = await freshStore();
});
afterEach(() => {
  store.lock();
  store.db.close();
});

describe('vault: PIN, lock-out, recovery (NFR02, UC02 1.a/1.b, C18, C19)', () => {
  it('unlocks with the right PIN and counts wrong ones down to a lock', async () => {
    await store.setPin('2468');
    store.lock();
    await expect(store.unlockWithPin('1111')).rejects.toMatchObject({ reason: 'wrong', attemptsLeft: 4 });
    for (let i = 0; i < 3; i++) await expect(store.unlockWithPin('1111')).rejects.toBeInstanceOf(UnlockError);
    await expect(store.unlockWithPin('1111')).rejects.toMatchObject({ reason: 'locked' });
    await expect(store.unlockWithPin('2468')).rejects.toMatchObject({ reason: 'locked' }); // right PIN no longer enough
    // An online log-in (recovery key) opens the vault again and keeps unsynced data.
    await store.openWithRecovery(RECOVERY);
    expect(store.isUnlocked()).toBe(true);
    expect((await store.vaultStatus()).locked).toBe(false);
  });

  it('refuses PIN unlock 7 days after the last online log-in (UC02 1.b)', async () => {
    await store.setPin('2468');
    store.lock();
    const eightDays = new Date(Date.now() + 8 * 86_400_000);
    await expect(store.unlockWithPin('2468', eightDays)).rejects.toMatchObject({ reason: 'expired' });
    await expect(store.unlockWithPin('2468', new Date(Date.now() + 6 * 86_400_000))).resolves.toBeUndefined();
  });

  it('never stores the PIN or the data key in plain form', async () => {
    await store.setPin('2468');
    const vault = (await store.db.meta.get('vault'))?.value as Record<string, unknown>;
    expect(JSON.stringify(vault)).not.toContain('2468');
    expect(Object.keys(vault)).not.toContain('pinHash');
  });
});

describe('encrypted, atomic local writes (NFR04, NFR08, UC11)', () => {
  it('saves a household and its outbox event together, with personal data encrypted at rest', async () => {
    const h = await store.saveHousehold({ areaId: AREA, headName: 'Abdul Karim', mobile: '01712345678', memberCount: 5, gps: null });
    expect(isValidShortCode(h.shortCode)).toBe(true);
    expect(h.shortCode.startsWith('K7M')).toBe(true);
    expect(await store.db.households.count()).toBe(1);
    expect(await store.db.outbox.count()).toBe(1);
    // Read the raw IndexedDB records: no plaintext name or number anywhere.
    const raw = JSON.stringify(await store.db.households.toArray()) + JSON.stringify(await store.db.outbox.toArray());
    expect(raw).not.toContain('Abdul');
    expect(raw).not.toContain('01712345678');
  });

  it('keeps records after a restart (new store instance on the same database)', async () => {
    await store.setPin('2468');
    await store.saveHousehold({ areaId: AREA, headName: 'Rahima Begum', mobile: null, memberCount: 3, gps: null });
    store.db.close();
    const reopened = new LocalStore(name, 1000);
    await reopened.unlockWithPin('2468');
    expect(reopened.households().map((h) => h.headName)).toEqual(['Rahima Begum']);
    expect(await reopened.pendingCount()).toBe(1);
    store = reopened;
  });

  it('rejects zero or invalid quantities (UC13 3.a)', async () => {
    await expect(
      store.saveDistribution({ areaId: AREA, householdId: null, items: [{ itemId: ITEM, quantity: 0 }], receivedElsewhereToday: false }),
    ).rejects.toThrow('quantity_positive');
  });

  it('records an anonymous distribution with the area only (UC13 1.a)', async () => {
    const d = await store.saveDistribution({ areaId: AREA, householdId: null, items: [{ itemId: ITEM, quantity: 5 }], receivedElsewhereToday: false });
    expect(d.isAnonymous).toBe(true);
    expect(d.householdId).toBeNull();
  });
});

describe('search and similarity (UC12, UC14)', () => {
  beforeEach(async () => {
    await store.saveHousehold({ areaId: AREA, headName: 'Mohammad Rafiqul Islam', mobile: '01712340000', memberCount: 6, gps: null });
    await store.saveHousehold({ areaId: AREA2, headName: 'Nasima Akter', mobile: null, memberCount: 2, gps: null });
  });

  it('finds by short code (also lower-case), name and mobile number', async () => {
    const first = store.households().find((h) => h.headName === 'Nasima Akter')!;
    expect((await store.search(first.shortCode.toLowerCase())).map((h) => h.id)).toEqual([first.id]);
    expect((await store.search('nasima')).map((h) => h.headName)).toEqual(['Nasima Akter']);
    expect((await store.search('Rafikul Islam')).map((h) => h.headName)).toContain('Mohammad Rafiqul Islam');
    expect((await store.search('017-1234 0000')).map((h) => h.headName)).toEqual(['Mohammad Rafiqul Islam']);
  });

  it('matches another organisation’s household by phone HMAC (C5)', async () => {
    const hmac = await phoneHmac(PHONE_KEY, '01899999999');
    await store.db.households.update(store.households()[0]!.id, { mobileHmac: hmac });
    const reopened = new LocalStore(name, 1000);
    await reopened.openWithRecovery(RECOVERY);
    expect((await reopened.search('01899999999')).length).toBe(1);
    store = reopened;
  });

  it('warns about a similar household in the same union before saving (FR09)', async () => {
    const matches = await store.findSimilar({ areaId: AREA2, headName: 'Md Rafiqul Islam', mobile: '01712340000', memberCount: 6, gps: null });
    expect(matches[0]?.household.headName).toBe('Mohammad Rafiqul Islam');
    expect(matches[0]?.label).toBe('likely');
    const none = await store.findSimilar({ areaId: AREA, headName: 'Completely Different', mobile: null, memberCount: 1, gps: null });
    expect(none).toHaveLength(0);
  });
});

describe('corrections and cancellation (UC15, FR12)', () => {
  it('queues a new version with only the changed fields', async () => {
    const h = await store.saveHousehold({ areaId: AREA, headName: 'Jamal Uddin', mobile: null, memberCount: 3, gps: null });
    expect(await store.updateHousehold(h.id, { headName: 'Jamal Uddin', memberCount: 3 })).toBe(false);
    expect(await store.updateHousehold(h.id, { memberCount: 4 })).toBe(true);
    const events = await store.unacknowledged(10);
    expect(events.at(-1)).toMatchObject({ type: 'household.update', payload: { changes: { memberCount: 4 } } });
    expect(store.getHousehold(h.id)?.memberCount).toBe(4);
  });

  it('lets the recorder cancel within 24 hours and keeps the record as voided', async () => {
    const d = await store.saveDistribution({ areaId: AREA, householdId: null, items: [{ itemId: ITEM, quantity: 1 }], receivedElsewhereToday: false });
    expect(await store.canVoid(d)).toBe(true);
    expect(await store.canVoid(d, new Date(Date.now() + 25 * 3_600_000))).toBe(false);
    await store.voidDistribution(d.id, 'Entered twice');
    expect((await store.db.distributions.get(d.id))?.status).toBe('voided');
    expect(await store.canVoid({ ...d, recordedBy: 'someone-else' })).toBe(false);
  });
});

describe('sync queue with an unreliable transport (FR14, Fig 5.9)', () => {
  it('resumes from the first unconfirmed event and removes only acknowledged ones', async () => {
    for (let i = 0; i < 5; i++) {
      await store.saveDistribution({ areaId: AREA, householdId: null, items: [{ itemId: ITEM, quantity: i + 1 }], receivedElsewhereToday: false });
    }
    const seen: string[] = [];
    let calls = 0;
    const transport: SyncTransport = {
      async push(body) {
        calls++;
        if (calls === 2) throw new Error('connection lost');
        body.events.forEach((e) => seen.push(e.eventId));
        return {
          acks: body.events.map((e) => ({ eventId: e.eventId, status: 'applied' as const })),
          serverTime: new Date().toISOString(),
          clockOffsetMs: 0,
        } satisfies PushResponse;
      },
      async pull(): Promise<PullResponse> {
        return {
          households: [],
          distributions: [],
          areaCursors: {},
          globalCursor: '0',
          items: [],
          areas: [],
          releases: [],
          operationStatus: 'active',
          hasMore: false,
          serverTime: new Date().toISOString(),
        };
      },
    };
    const first = await runSync({ outbox: store, snapshot: store, transport }, { maxEvents: 2 });
    expect(first.ok).toBe(false);
    expect(await store.pendingCount()).toBe(3); // 2 acknowledged; the failed batch stays queued
    expect((await store.outboxRows())[0]?.status).toBe('failed');
    const second = await runSync({ outbox: store, snapshot: store, transport }, { maxEvents: 2 });
    expect(second.ok).toBe(true);
    expect(await store.pendingCount()).toBe(0);
    expect(new Set(seen).size).toBe(5);
  });
});

describe('NFR14 field performance with 5,000 households', () => {
  it('saves and searches within 1 second each', async () => {
    const pending: Promise<unknown>[] = [];
    for (let i = 0; i < 5000; i++) {
      const tag = String.fromCharCode(65 + (i % 26)) + String.fromCharCode(97 + (Math.floor(i / 26) % 26));
      pending.push(store.saveHousehold({ areaId: i % 2 ? AREA : AREA2, headName: `Person ${tag} Hossain`, mobile: null, memberCount: (i % 8) + 1, gps: null }));
      if (pending.length === 250) await Promise.all(pending.splice(0));
    }
    await Promise.all(pending);
    expect(store.householdCount()).toBe(5000);
    let t = performance.now();
    await store.saveHousehold({ areaId: AREA, headName: 'Timed Save', mobile: '01712345670', memberCount: 4, gps: null });
    const saveMs = performance.now() - t;
    t = performance.now();
    const found = await store.search('Timed Save');
    const searchMs = performance.now() - t;
    t = performance.now();
    await store.findSimilar({ areaId: AREA, headName: 'Person Qa Hossain', mobile: null, memberCount: 3, gps: null });
    const similarMs = performance.now() - t;
    console.info(JSON.stringify({ metric: 'NFR14', households: 5001, saveMs: Math.round(saveMs), searchMs: Math.round(searchMs), similarMs: Math.round(similarMs) }));
    expect(found[0]?.headName).toBe('Timed Save');
    expect(saveMs).toBeLessThan(1000);
    expect(searchMs).toBeLessThan(1000);
    expect(similarMs).toBeLessThan(1000);
  }, 180_000);
});
