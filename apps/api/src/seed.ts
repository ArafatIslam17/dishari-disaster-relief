/**
 * Demo data for `pnpm seed` and the end-to-end tests: every role, one operation with areas and
 * items, two organisations, households and distributions created through the real sync path, an
 * injected duplicate pair, a same-field conflict, a cross-organisation repeat distribution and
 * one area with no records.
 */
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import {
  generateDevicePrefix,
  generateShortCode,
  uuidv7,
  type Role,
  type SyncEventInput,
} from '@relief/shared';
import { hashPassword } from './auth/tokens.js';
import type { AppContext, AuthInfo } from './context.js';
import {
  appUser,
  area,
  device,
  disasterType,
  donation,
  operation,
  operationAdmin,
  operationKey,
  operationMembership,
  operationObserver,
  organisation,
  reliefItem,
} from './db/schema.js';
import { areaKeys } from './routes/operations.js';
import { processPush } from './services/sync.js';
import { FENI_AREAS, RELIEF_ITEMS, mobile, personName, rng, varyName } from './synthetic.js';

export const DEMO_ACCOUNTS = [
  { key: 'admin', role: 'SYSTEM_ADMINISTRATOR', mobile: '01700000000', name: 'System Administrator' },
  { key: 'opadmin', role: 'OPERATION_ADMINISTRATOR', mobile: '01711000001', name: 'Nusrat Jahan' },
  { key: 'coordA', role: 'GROUP_COORDINATOR', mobile: '01722000001', name: 'Tanvir Ahmed', org: 'A' },
  { key: 'volA1', role: 'FIELD_VOLUNTEER', mobile: '01733000001', name: 'Sumaiya Akter', org: 'A' },
  { key: 'volA2', role: 'FIELD_VOLUNTEER', mobile: '01733000002', name: 'Rakib Hasan', org: 'A' },
  { key: 'coordB', role: 'GROUP_COORDINATOR', mobile: '01844000001', name: 'Farhana Rahman', org: 'B' },
  { key: 'volB1', role: 'FIELD_VOLUNTEER', mobile: '01855000001', name: 'Imran Hossain', org: 'B' },
  { key: 'observer', role: 'OBSERVER', mobile: '01766000001', name: 'Partner Observer' },
] as const;

export interface SeedResult {
  created: boolean;
  operationId: string;
  accounts: { role: string; mobile: string; name: string }[];
}

export async function seedDemo(ctx: AppContext, opts: { demoPassword: string; adminPassword?: string; households?: number }): Promise<SeedResult> {
  const db = ctx.db;
  const [existing] = await db.select({ id: organisation.id }).from(organisation).where(eq(organisation.nameKey, 'shapla relief team'));
  if (existing) {
    const [op] = await db.select({ id: operation.id }).from(operation).where(eq(operation.name, 'Feni Flash Flood 2024 (demo)'));
    if (op) await seedDonations(ctx, op.id);
    return { created: false, operationId: op?.id ?? '', accounts: DEMO_ACCOUNTS.map((a) => ({ role: a.role, mobile: a.mobile, name: a.name })) };
  }
  const r = rng(20240824);
  const demoHash = await hashPassword(opts.demoPassword);
  const adminHash = opts.adminPassword ? await hashPassword(opts.adminPassword) : demoHash;
  const now = ctx.now();
  const ids: Record<string, string> = {};

  // Disaster types (NFR21: data, not code).
  const types = [
    ['Flood', 'বন্যা'],
    ['Flash flood', 'আকস্মিক বন্যা'],
    ['Cyclone', 'ঘূর্ণিঝড়'],
    ['Landslide', 'ভূমিধস'],
  ];
  const typeIds: string[] = [];
  for (const [en, bn] of types) {
    const id = uuidv7();
    typeIds.push(id);
    await db.insert(disasterType).values({ id, nameEn: en as string, nameBn: bn as string }).onConflictDoNothing();
  }

  // Organisations: two approved and joined, one pending for the System Administrator's queue.
  const orgs = {
    A: { id: uuidv7(), name: 'Shapla Relief Team', nameBn: 'শাপলা ত্রাণ দল', type: 'volunteer_group' },
    B: { id: uuidv7(), name: 'Padma Youth Volunteers', nameBn: 'পদ্মা যুব স্বেচ্ছাসেবক', type: 'volunteer_group' },
  };
  for (const o of Object.values(orgs)) {
    await db.insert(organisation).values({
      id: o.id,
      name: o.name,
      nameKey: o.name.toLowerCase(),
      nameBn: o.nameBn,
      orgType: o.type,
      contactName: 'Demo Contact',
      contactPhone: '01799000000',
      status: 'approved',
      reviewedAt: now,
    });
  }
  const pendingOrg = uuidv7();
  await db.insert(organisation).values({
    id: pendingOrg,
    name: 'Meghna Flood Response',
    nameKey: 'meghna flood response',
    nameBn: 'মেঘনা বন্যা সাড়াদান',
    orgType: 'ngo',
    contactName: 'Salma Khatun',
    contactPhone: '01799000001',
    status: 'pending',
  });
  await db.insert(appUser).values({
    id: uuidv7(),
    organisationId: pendingOrg,
    fullName: 'Salma Khatun',
    mobileNumber: '01799000001',
    passwordHash: demoHash,
    role: 'GROUP_COORDINATOR',
    status: 'pending',
  });

  for (const a of DEMO_ACCOUNTS) {
    const id = uuidv7();
    ids[a.key] = id;
    await db.insert(appUser).values({
      id,
      organisationId: 'org' in a ? orgs[a.org].id : null,
      fullName: a.name,
      mobileNumber: a.mobile,
      passwordHash: a.role === 'SYSTEM_ADMINISTRATOR' ? adminHash : demoHash,
      role: a.role as Role,
      status: 'active',
      approvedAt: now,
    });
  }
  // A volunteer waiting for the coordinator's approval (UC05 demo).
  await db.insert(appUser).values({
    id: uuidv7(),
    organisationId: orgs.A.id,
    fullName: 'Nayeem Islam',
    mobileNumber: '01733000009',
    passwordHash: demoHash,
    role: 'FIELD_VOLUNTEER',
    status: 'pending',
  });

  // The operation, its areas (one union left without households) and items.
  const opId = uuidv7();
  await db.insert(operation).values({
    id: opId,
    name: 'Feni Flash Flood 2024 (demo)',
    disasterTypeId: typeIds[1] as string,
    startDate: '2024-08-21',
    status: 'active',
    createdBy: ids.opadmin as string,
  });
  await db.insert(operationAdmin).values({ operationId: opId, userId: ids.opadmin as string, addedBy: ids.opadmin as string });
  await db.insert(operationKey).values({ operationId: opId, wrappedKey: ctx.crypto.wrap(randomBytes(32)) });
  await db.insert(operationObserver).values({ operationId: opId, userId: ids.observer as string, invitedBy: ids.opadmin as string });
  const areaRows: { id: string; union: string }[] = [];
  for (const a of FENI_AREAS) {
    for (let w = 1; w <= a.wards; w++) {
      const id = uuidv7();
      const input = { upazila: a.upazila, unionName: a.union, ward: String(w) };
      await db.insert(area).values({ id, operationId: opId, ...input, upazilaBn: a.upazilaBn, unionBn: a.unionBn, ...areaKeys(input) });
      areaRows.push({ id, union: a.union });
    }
  }
  const itemIds: string[] = [];
  for (const it of RELIEF_ITEMS) {
    const id = uuidv7();
    itemIds.push(id);
    await db.insert(reliefItem).values({ id, operationId: opId, itemName: it.itemName, nameKey: it.itemName.toLowerCase(), itemNameBn: it.itemNameBn, unit: it.unit });
  }
  for (const o of Object.values(orgs)) {
    await db.insert(operationMembership).values({ operationId: opId, organisationId: o.id, status: 'approved', requestedBy: ids.opadmin as string, reviewedAt: now });
  }

  // Field devices for the volunteers, then data through the real sync path.
  const devices: Record<string, { auth: AuthInfo; prefix: string; seq: number }> = {};
  for (const key of ['volA1', 'volA2', 'volB1'] as const) {
    const acc = DEMO_ACCOUNTS.find((a) => a.key === key)!;
    const deviceId = uuidv7();
    const prefix = generateDevicePrefix(r);
    await db.insert(device).values({ id: deviceId, userId: ids[key] as string, deviceLabel: 'Demo phone', shortCodePrefix: prefix, recoveryKeyEnc: ctx.crypto.wrap(randomBytes(32)), registeredAt: now });
    devices[key] = {
      prefix,
      seq: 0,
      auth: { userId: ids[key] as string, role: 'FIELD_VOLUNTEER', organisationId: orgs['org' in acc ? acc.org : 'A'].id, deviceId, fullName: acc.name, mustChangePassword: false },
    };
  }
  const event = (dev: (typeof devices)[string], e: Omit<SyncEventInput, 'eventId' | 'deviceSeq' | 'clientTime'>, at: Date): SyncEventInput =>
    ({ ...e, eventId: uuidv7(), deviceSeq: ++dev.seq, clientTime: at.toISOString() }) as SyncEventInput;
  const push = async (key: string, events: SyncEventInput[]) => {
    const dev = devices[key]!;
    for (let i = 0; i < events.length; i += 100) await processPush(ctx, dev.auth, { sentAt: ctx.now().toISOString(), events: events.slice(i, i + 100) });
  };

  const populated = areaRows.filter((a) => a.union !== 'Pathannagar'); // Pathannagar shows "No records"
  const total = opts.households ?? 60;
  const created: { id: string; key: string; area: string; name: string; phone: string | null; members: number }[] = [];
  const batches: Record<string, SyncEventInput[]> = { volA1: [], volA2: [], volB1: [] };
  for (let i = 0; i < total; i++) {
    const key = (['volA1', 'volA2', 'volB1'] as const)[i % 3] as 'volA1' | 'volA2' | 'volB1';
    const dev = devices[key]!;
    const a = populated[i % populated.length]!;
    const id = uuidv7();
    const name = personName(r);
    const phone = r() < 0.8 ? mobile(r) : null;
    const members = 2 + Math.floor(r() * 7);
    const at = new Date(now.getTime() - (48 - i * 0.6) * 3_600_000);
    batches[key]!.push(
      event(dev, { type: 'household.create', entityId: id, baseVersion: 0, payload: { operationId: opId, areaId: a.id, shortCode: generateShortCode(dev.prefix, r), headName: name, mobile: phone, memberCount: members, consentGiven: true, consentAt: at.toISOString(), gps: null } }, at),
    );
    created.push({ id, key, area: a.id, name, phone, members });
  }
  // Injected duplicate: Padma registers a family Shapla already registered (same phone, varied name).
  const original = created.find((c) => c.key === 'volA1' && c.phone)!;
  const dupId = uuidv7();
  batches.volB1!.push(
    event(devices.volB1!, { type: 'household.create', entityId: dupId, baseVersion: 0, payload: { operationId: opId, areaId: original.area, shortCode: generateShortCode(devices.volB1!.prefix, r), headName: varyName(r, original.name), mobile: original.phone, memberCount: original.members, consentGiven: true, consentAt: now.toISOString(), gps: null } }, now),
  );
  for (const key of Object.keys(batches)) await push(key, batches[key]!);

  // Distributions to about 60% of households; anonymous ones too.
  const dist: Record<string, SyncEventInput[]> = { volA1: [], volA2: [], volB1: [] };
  created.forEach((c, i) => {
    if (r() > 0.6) return;
    const dev = devices[c.key]!;
    const at = new Date(now.getTime() - (30 - i * 0.4) * 3_600_000);
    dist[c.key]!.push(
      event(dev, { type: 'distribution.create', entityId: uuidv7(), baseVersion: 0, payload: { operationId: opId, areaId: c.area, householdId: c.id, isAnonymous: false, items: [{ itemId: itemIds[0] as string, quantity: 10 }, { itemId: itemIds[3] as string, quantity: 4 }], distributedAt: at.toISOString(), receivedElsewhereToday: false } }, at),
    );
  });
  dist.volA2!.push(event(devices.volA2!, { type: 'distribution.create', entityId: uuidv7(), baseVersion: 0, payload: { operationId: opId, areaId: populated[2]!.id, householdId: null, isAnonymous: true, items: [{ itemId: itemIds[5] as string, quantity: 2 }], distributedAt: now.toISOString(), receivedElsewhereToday: false } }, now));
  // Cross-organisation repeat of the same item within 24 hours (FR20 flag).
  dist.volA1!.push(event(devices.volA1!, { type: 'distribution.create', entityId: uuidv7(), baseVersion: 0, payload: { operationId: opId, areaId: original.area, householdId: original.id, isAnonymous: false, items: [{ itemId: itemIds[1] as string, quantity: 2 }], distributedAt: new Date(now.getTime() - 5 * 3_600_000).toISOString(), receivedElsewhereToday: false } }, now));
  dist.volB1!.push(event(devices.volB1!, { type: 'distribution.create', entityId: uuidv7(), baseVersion: 0, payload: { operationId: opId, areaId: original.area, householdId: original.id, isAnonymous: false, items: [{ itemId: itemIds[1] as string, quantity: 2 }], distributedAt: new Date(now.getTime() - 2 * 3_600_000).toISOString(), receivedElsewhereToday: true } }, now));
  for (const key of Object.keys(dist)) await push(key, dist[key]!);

  // Same-field conflict: two volunteers change one family's size differently while offline (FR16).
  const target = created.find((c) => c.key === 'volA2')!;
  await push('volA2', [event(devices.volA2!, { type: 'household.update', entityId: target.id, baseVersion: 1, payload: { changes: { memberCount: target.members + 1 } } }, now)]);
  await push('volB1', [event(devices.volB1!, { type: 'household.update', entityId: target.id, baseVersion: 1, payload: { changes: { memberCount: target.members + 2 } } }, now)]);

  await seedDonations(ctx, opId);
  return { created: true, operationId: opId, accounts: DEMO_ACCOUNTS.map((a) => ({ role: a.role, mobile: a.mobile, name: a.name })) };
}

/**
 * Demo relief-fund donations (sandbox gateway). Runs on its own so databases seeded before the
 * fund existed still get them; does nothing once any donation is recorded.
 */
export async function seedDonations(ctx: AppContext, operationId: string): Promise<number> {
  const [any] = await ctx.db.select({ id: donation.id }).from(donation).limit(1);
  if (any) return 0;
  const now = ctx.now().getTime();
  const rows: { name: string | null; amount: number; method: 'bkash' | 'nagad' | 'rocket' | 'visa' | 'mastercard'; hoursAgo: number; txn: string }[] = [
    { name: 'Nusrat Jahan', amount: 5000, method: 'bkash', hoursAgo: 52, txn: 'NJ5K8Q' },
    { name: null, amount: 2500, method: 'nagad', hoursAgo: 30, txn: 'AN2R7M' },
    { name: 'Rahim Uddin Traders', amount: 25000, method: 'visa', hoursAgo: 20, txn: 'RU9T4X' },
    { name: 'Farzana Akter', amount: 1000, method: 'rocket', hoursAgo: 9, txn: 'FA3H6W' },
    { name: null, amount: 10000, method: 'mastercard', hoursAgo: 3, txn: 'AN8P2D' },
  ];
  for (const r of rows) {
    const at = new Date(now - r.hoursAgo * 3_600_000);
    await ctx.db.insert(donation).values({
      id: uuidv7(at.getTime()),
      operationId,
      donorName: r.name,
      isAnonymous: r.name === null,
      amountBdt: r.amount,
      paymentMethod: r.method,
      transactionId: `DSH-${at.getUTCFullYear()}-${r.txn}`,
      status: 'completed',
      createdAt: new Date(at.getTime() - 4 * 60_000),
      completedAt: at,
    });
  }
  return rows.length;
}
