/**
 * Server side of the sync protocol (UC16, Fig 5.5, DECISIONS §5).
 *
 * Exactly-once (NFR09): every event is stored in `sync_event` under its client UUIDv7 id
 * in the same transaction as its effect. A repeat is answered from the stored outcome.
 * Out of order: an update/void/distribution that refers to an entity not yet known is
 * stored as `deferred` and replayed when the entity arrives.
 */
import { and, eq, sql } from 'drizzle-orm';
import {
  CANCEL_WINDOW_HOURS,
  generateShortCode,
  maskPhone,
  mergeUpdate,
  normaliseName,
  pushRequestSchema,
  syncEventSchema,
  uuidv7,
  type FieldStamp,
  type HouseholdChanges,
  type HouseholdCreatePayload,
  type PushAck,
  type PushResponse,
  type SyncEvent,
} from '@relief/shared';
import type { AppContext, AuthInfo } from '../context.js';
import { lockOperationFeed, query, queryOne, type Tx } from '../db/client.js';
import {
  area,
  conflict,
  device,
  distribution,
  distributionItem,
  household,
  operationKey,
  syncEvent,
} from '../db/schema.js';
import { audit, notify } from '../lib/audit.js';
import { aesDecrypt, aesEncrypt } from '../lib/crypto.js';
import { badRequest, forbidden } from '../lib/errors.js';
import { enqueue } from './jobs.js';

type Outcome = { status: 'applied' | 'conflict' | 'deferred' | 'rejected'; reason?: string; shortCode?: string };

interface EventActor {
  userId: string;
  organisationId: string;
  deviceId: string;
  clockOffsetMs: number;
}

interface HouseholdValues extends Record<string, unknown> {
  headName: string | null;
  mobile: string | null;
  memberCount: number;
  areaId: string;
  gps: { lat: number; lng: number } | null;
}

/** Stamp with authorship, so a conflict can show who entered each value and when (UC17 step 3). */
type AuthoredStamp = FieldStamp & { userId: string; organisationId: string; at: string };

const PII_FIELDS = ['headName', 'mobile', 'gps'] as const;

// ---------- per-operation keys (C8) ----------
const keyCache = new Map<string, Buffer | null>();

async function operationDataKey(ctx: AppContext, tx: Tx, operationId: string): Promise<Buffer | null> {
  if (keyCache.has(operationId)) return keyCache.get(operationId) ?? null;
  const [row] = await tx.select().from(operationKey).where(eq(operationKey.operationId, operationId));
  const k = row?.wrappedKey && !row.destroyedAt ? ctx.crypto.unwrap(row.wrappedKey) : null;
  keyCache.set(operationId, k);
  return k;
}

export function forgetOperationKey(operationId: string): void {
  keyCache.delete(operationId);
}

function splitPii(payload: Record<string, unknown>): { plain: Record<string, unknown>; pii: Record<string, unknown> | null } {
  const plain: Record<string, unknown> = {};
  const pii: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (k === 'changes' && v && typeof v === 'object') {
      const inner = splitPii(v as Record<string, unknown>);
      plain.changes = inner.plain;
      if (inner.pii) pii.changes = inner.pii;
    } else if ((PII_FIELDS as readonly string[]).includes(k)) pii[k] = v;
    else plain[k] = v;
  }
  return { plain, pii: Object.keys(pii).length > 0 ? pii : null };
}

function joinPii(plain: Record<string, unknown>, pii: Record<string, unknown> | null): Record<string, unknown> {
  if (!pii) return plain;
  const out = { ...plain, ...pii };
  if (plain.changes || pii.changes) {
    out.changes = { ...((plain.changes as object) ?? {}), ...((pii.changes as object) ?? {}) };
  }
  return out;
}

const effective = (iso: string, offsetMs: number) => new Date(Date.parse(iso) + offsetMs);

// ---------- push ----------
export async function processPush(ctx: AppContext, auth: AuthInfo, body: unknown): Promise<PushResponse> {
  if (auth.role !== 'FIELD_VOLUNTEER' && auth.role !== 'GROUP_COORDINATOR') throw forbidden('role_not_allowed');
  if (!auth.deviceId || !auth.organisationId) throw forbidden('device_required');
  const request = pushRequestSchema.parse(body);
  const serverNow = ctx.now();
  const sentAt = Date.parse(request.sentAt);
  const clockOffsetMs = Math.max(-2_000_000_000, Math.min(2_000_000_000, serverNow.getTime() - sentAt));
  const actor: EventActor = {
    userId: auth.userId,
    organisationId: auth.organisationId,
    deviceId: auth.deviceId,
    clockOffsetMs,
  };

  // Parse each event on its own: one malformed event must not block the rest of the queue.
  const parsed: ({ ok: true; event: SyncEvent } | { ok: false; eventId: string; entityId: string; reason: string })[] = [];
  for (const raw of request.events) {
    const result = syncEventSchema.safeParse(raw);
    if (result.success) {
      parsed.push({ ok: true, event: result.data });
      continue;
    }
    const r = raw as { eventId?: unknown; entityId?: unknown };
    const eventId = typeof r?.eventId === 'string' && /^[0-9a-f-]{36}$/i.test(r.eventId) ? r.eventId : null;
    if (!eventId) throw badRequest('event_without_id');
    const entityId = typeof r.entityId === 'string' && /^[0-9a-f-]{36}$/i.test(r.entityId) ? r.entityId : eventId;
    parsed.push({ ok: false, eventId, entityId, reason: `invalid:${result.error.issues[0]?.message ?? 'event'}` });
  }

  const acks: PushAck[] = [];
  const touchedHouseholds = new Set<string>();
  const newDistributions = new Set<string>();

  await ctx.db.transaction(async (tx) => {
    // Lock every operation this batch writes to, in a fixed order (no deadlocks).
    const opIds = new Set<string>();
    for (const p of parsed) {
      if (!p.ok) continue;
      const e = p.event;
      if (e.type === 'household.create' || e.type === 'distribution.create') opIds.add(e.payload.operationId);
      else {
        const table = e.type === 'household.update' ? 'household' : 'distribution';
        const idCol = e.type === 'household.update' ? 'household_id' : 'distribution_id';
        const row = await queryOne<{ operation_id: string }>(
          tx,
          sql`select operation_id from ${sql.identifier(table)} where ${sql.identifier(idCol)} = ${e.entityId}`,
        );
        if (row) opIds.add(row.operation_id);
      }
    }
    for (const op of [...opIds].sort()) await lockOperationFeed(tx, op);

    for (const p of parsed) {
      const eventId = p.ok ? p.event.eventId : p.eventId;
      const [seen] = await tx
        .select({ status: syncEvent.status, reason: syncEvent.rejectReason, deviceId: syncEvent.deviceId })
        .from(syncEvent)
        .where(eq(syncEvent.eventId, eventId));
      if (seen) {
        // Repeated upload (FR14, UC16 3.a): ignore the copy and confirm it.
        acks.push({ eventId, status: 'duplicate', reason: seen.status });
        continue;
      }
      if (!p.ok) {
        await storeEvent(tx, actor, {
          eventId,
          entityId: p.entityId,
          entityType: 'unknown',
          action: 'invalid',
          deviceSeq: 0,
          baseVersion: 0,
          plain: {},
          piiEnc: null,
          clientTime: serverNow,
          status: 'rejected',
          reason: p.reason.slice(0, 60),
        });
        acks.push({ eventId, status: 'rejected', reason: p.reason });
        continue;
      }
      const outcome = await applyAndStore(ctx, tx, actor, p.event, touchedHouseholds, newDistributions);
      acks.push({ eventId, status: outcome.status, reason: outcome.reason, shortCode: outcome.shortCode });
    }

    await tx
      .update(device)
      .set({ lastSyncAt: serverNow, lastClockOffsetMs: clockOffsetMs })
      .where(eq(device.id, actor.deviceId));
    if (touchedHouseholds.size > 0) await enqueue(tx, 'duplicates.score', { householdIds: [...touchedHouseholds] });
    if (newDistributions.size > 0) await enqueue(tx, 'flags.check', { distributionIds: [...newDistributions] });
  });

  if (touchedHouseholds.size > 0 || newDistributions.size > 0) ctx.kickJobs();
  return { acks, serverTime: serverNow.toISOString(), clockOffsetMs };
}

interface StoredEvent {
  eventId: string;
  entityId: string;
  entityType: string;
  action: string;
  deviceSeq: number;
  baseVersion: number;
  plain: Record<string, unknown>;
  piiEnc: string | null;
  clientTime: Date;
  status: Outcome['status'];
  reason?: string;
  operationId?: string | null;
}

async function storeEvent(tx: Tx, actor: EventActor, e: StoredEvent): Promise<void> {
  await tx.insert(syncEvent).values({
    eventId: e.eventId,
    deviceId: actor.deviceId,
    userId: actor.userId,
    organisationId: actor.organisationId,
    operationId: e.operationId ?? null,
    entityType: e.entityType,
    entityId: e.entityId,
    action: e.action,
    deviceSeq: e.deviceSeq,
    baseVersion: e.baseVersion,
    payload: e.plain,
    piiEnc: e.piiEnc,
    clientTime: e.clientTime,
    clockOffsetMs: actor.clockOffsetMs,
    status: e.status,
    rejectReason: e.reason?.slice(0, 60) ?? null,
  });
}

async function eventOperationId(tx: Tx, event: SyncEvent): Promise<string | null> {
  if (event.type === 'household.create' || event.type === 'distribution.create') return event.payload.operationId;
  const table = event.type === 'household.update' ? household : distribution;
  const [row] = await tx.select({ op: table.operationId }).from(table).where(eq(table.id, event.entityId));
  return row?.op ?? null;
}

async function applyAndStore(
  ctx: AppContext,
  tx: Tx,
  actor: EventActor,
  event: SyncEvent,
  touched: Set<string>,
  newDistributions: Set<string>,
): Promise<Outcome> {
  const operationId = await eventOperationId(tx, event);
  const { plain, pii } = splitPii(event.payload as Record<string, unknown>);
  let piiEnc: string | null = null;
  if (pii && operationId) {
    const key = await operationDataKey(ctx, tx, operationId);
    piiEnc = key ? aesEncrypt(key, Buffer.from(JSON.stringify(pii))) : null;
  }
  const [entityType, action] = event.type.split('.') as [string, string];
  // Store first, so a deferred replay inside `apply` can find this very event.
  await storeEvent(tx, actor, {
    eventId: event.eventId,
    entityId: event.entityId,
    entityType,
    action,
    deviceSeq: event.deviceSeq,
    baseVersion: event.baseVersion,
    plain,
    piiEnc,
    clientTime: new Date(event.clientTime),
    status: 'deferred',
    operationId,
  });
  const outcome = await apply(ctx, tx, actor, event, touched, newDistributions);
  await finaliseEvent(tx, event.eventId, outcome);
  if (outcome.status === 'rejected') {
    await notify(
      tx,
      [actor.userId],
      'event.rejected',
      { reason: outcome.reason ?? 'rejected', entity: entityType, entityId: event.entityId },
      '/field/sync',
    );
  }
  return outcome;
}

async function finaliseEvent(tx: Tx, eventId: string, outcome: Outcome): Promise<void> {
  if (outcome.status === 'deferred') return;
  await tx
    .update(syncEvent)
    .set({ status: outcome.status, rejectReason: outcome.reason?.slice(0, 60) ?? null })
    .where(and(eq(syncEvent.eventId, eventId), eq(syncEvent.status, 'deferred')));
}

async function apply(
  ctx: AppContext,
  tx: Tx,
  actor: EventActor,
  event: SyncEvent,
  touched: Set<string>,
  newDistributions: Set<string>,
): Promise<Outcome> {
  switch (event.type) {
    case 'household.create':
      return applyHouseholdCreate(ctx, tx, actor, event, touched, newDistributions);
    case 'household.update':
      return applyHouseholdUpdate(ctx, tx, actor, event, touched);
    case 'distribution.create':
      return applyDistributionCreate(ctx, tx, actor, event, newDistributions);
    case 'distribution.void':
      return applyDistributionVoid(ctx, tx, actor, event);
  }
}

/** Operation open and the actor's organisation an approved member (A5, NFR01). */
async function checkOperation(tx: Tx, actor: EventActor, operationId: string): Promise<string | null> {
  const row = await queryOne<{ status: string; member: string | null; redacted: Date | null }>(
    tx,
    sql`select o.status, o.redacted_at as redacted, m.status as member
          from operation o
          left join operation_membership m on m.operation_id = o.operation_id and m.organisation_id = ${actor.organisationId}
         where o.operation_id = ${operationId}`,
  );
  if (!row) return 'operation_not_found';
  if (row.status !== 'active' || row.redacted) return 'operation_closed';
  if (row.member !== 'approved') return 'organisation_not_member';
  return null;
}

async function areaInOperation(tx: Tx, areaId: string, operationId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: area.id })
    .from(area)
    .where(and(eq(area.id, areaId), eq(area.operationId, operationId)));
  return !!row;
}

function stampFor(actor: EventActor, version: number, deviceSeq: number, at: Date): AuthoredStamp {
  return {
    version,
    deviceId: actor.deviceId,
    deviceSeq,
    userId: actor.userId,
    organisationId: actor.organisationId,
    at: at.toISOString(),
  };
}

function householdColumns(ctx: AppContext, operationId: string, v: Partial<HouseholdValues>) {
  const out: Record<string, unknown> = {};
  if (v.headName !== undefined) {
    out.headName = v.headName;
    out.nameNorm = v.headName ? normaliseName(v.headName) : null;
  }
  if (v.mobile !== undefined) {
    out.mobileNumber = v.mobile;
    out.mobileHmac = v.mobile ? ctx.crypto.phoneHmac(operationId, v.mobile) : null;
    out.mobileMasked = v.mobile ? maskPhone(v.mobile) : null;
  }
  if (v.memberCount !== undefined) out.memberCount = v.memberCount;
  if (v.areaId !== undefined) out.areaId = v.areaId;
  if (v.gps !== undefined) {
    out.gpsLat = v.gps ? v.gps.lat.toFixed(5) : null;
    out.gpsLng = v.gps ? v.gps.lng.toFixed(5) : null;
  }
  return out;
}

async function applyHouseholdCreate(
  ctx: AppContext,
  tx: Tx,
  actor: EventActor,
  event: Extract<SyncEvent, { type: 'household.create' }>,
  touched: Set<string>,
  newDistributions: Set<string>,
): Promise<Outcome> {
  const p: HouseholdCreatePayload = event.payload;
  const bad = await checkOperation(tx, actor, p.operationId);
  if (bad) return { status: 'rejected', reason: bad };
  if (!(await areaInOperation(tx, p.areaId, p.operationId))) return { status: 'rejected', reason: 'invalid_area' };
  const [exists] = await tx.select({ id: household.id }).from(household).where(eq(household.id, event.entityId));
  if (exists) return { status: 'rejected', reason: 'entity_exists' };

  // C6: on the rare short-code clash keep the first household and reissue this one's code.
  let shortCode = p.shortCode;
  let reissued = false;
  for (let i = 0; i < 10; i++) {
    const [clash] = await tx.select({ id: household.id }).from(household).where(eq(household.shortCode, shortCode));
    if (!clash) break;
    const [dev] = await tx.select({ prefix: device.shortCodePrefix }).from(device).where(eq(device.id, actor.deviceId));
    shortCode = generateShortCode(dev?.prefix ?? shortCode.slice(0, 3));
    reissued = true;
  }

  const at = effective(event.clientTime, actor.clockOffsetMs);
  const stamp = stampFor(actor, 1, event.deviceSeq, at);
  const stamps = { headName: stamp, mobile: stamp, memberCount: stamp, areaId: stamp, gps: stamp };
  await tx.insert(household).values({
    id: event.entityId,
    operationId: p.operationId,
    areaId: p.areaId,
    shortCode,
    registeredBy: actor.userId,
    organisationId: actor.organisationId,
    deviceId: actor.deviceId,
    memberCount: p.memberCount,
    consentGiven: true,
    consentAt: effective(p.consentAt, actor.clockOffsetMs),
    version: 1,
    fieldStamps: stamps,
    createdAt: at,
    ...householdColumns(ctx, p.operationId, { headName: p.headName, mobile: p.mobile, gps: p.gps }),
  });
  touched.add(event.entityId);
  await audit(tx, ctx.crypto, actor, {
    action: 'household.registered',
    entityType: 'household',
    entityId: event.entityId,
    operationId: p.operationId,
    changes: { headName: p.headName, mobile: p.mobile, memberCount: p.memberCount, areaId: p.areaId, gps: p.gps },
    details: { eventId: event.eventId, consent: true },
  });
  if (reissued) {
    await audit(tx, ctx.crypto, actor, {
      action: 'household.short_code_reissued',
      entityType: 'household',
      entityId: event.entityId,
      operationId: p.operationId,
      details: { from: p.shortCode, to: shortCode },
    });
    await notify(tx, [actor.userId], 'shortcode.reissued', { from: p.shortCode, to: shortCode, householdId: event.entityId }, `/field/households/${event.entityId}`);
  }
  await replayDeferred(ctx, tx, event.entityId, p.operationId, event.eventId, touched, newDistributions);
  return reissued ? { status: 'applied', shortCode, reason: 'short_code_reissued' } : { status: 'applied' };
}

async function applyHouseholdUpdate(
  ctx: AppContext,
  tx: Tx,
  actor: EventActor,
  event: Extract<SyncEvent, { type: 'household.update' }>,
  touched: Set<string>,
): Promise<Outcome> {
  const [h] = await tx.select().from(household).where(eq(household.id, event.entityId)).for('update');
  if (!h) return { status: 'deferred' };
  const bad = await checkOperation(tx, actor, h.operationId);
  if (bad) return { status: 'rejected', reason: bad };
  if (h.redactedAt) return { status: 'rejected', reason: 'household_redacted' };

  const changes: HouseholdChanges = { ...event.payload.changes };
  let note: string | undefined;
  // C27: only the registering organisation may change the mobile number.
  if (changes.mobile !== undefined && h.organisationId !== actor.organisationId) {
    delete changes.mobile;
    note = 'mobile_not_editable';
  }
  if (changes.areaId !== undefined && !(await areaInOperation(tx, changes.areaId, h.operationId))) {
    return { status: 'rejected', reason: 'invalid_area' };
  }
  if (Object.values(changes).every((v) => v === undefined)) {
    return note ? { status: 'rejected', reason: note } : { status: 'applied' };
  }

  const current: HouseholdValues = {
    headName: h.headName,
    mobile: h.mobileNumber,
    memberCount: h.memberCount,
    areaId: h.areaId,
    gps: h.gpsLat && h.gpsLng ? { lat: Number(h.gpsLat), lng: Number(h.gpsLng) } : null,
  };
  const stamps = h.fieldStamps as Record<string, AuthoredStamp>;
  const result = mergeUpdate<HouseholdValues>(
    { version: h.version, values: current, stamps },
    {
      baseVersion: event.baseVersion,
      deviceId: actor.deviceId,
      deviceSeq: event.deviceSeq,
      changes: changes as Partial<HouseholdValues>,
    },
  );
  const at = effective(event.clientTime, actor.clockOffsetMs);

  if (result.applied.length > 0) {
    const newStamps: Record<string, AuthoredStamp> = { ...stamps };
    const appliedValues: Partial<HouseholdValues> = {};
    for (const f of result.applied) {
      newStamps[f] = stampFor(actor, result.state.version, event.deviceSeq, at);
      (appliedValues as Record<string, unknown>)[f] = result.state.values[f];
    }
    await tx
      .update(household)
      .set({
        ...householdColumns(ctx, h.operationId, appliedValues),
        version: result.state.version,
        fieldStamps: newStamps,
        updatedAt: ctx.now(),
        serverSeq: sql`nextval('change_seq')`,
      })
      .where(eq(household.id, h.id));
    touched.add(h.id);
    await audit(tx, ctx.crypto, actor, {
      action: 'household.corrected',
      entityType: 'household',
      entityId: h.id,
      operationId: h.operationId,
      changes: appliedValues,
      details: { eventId: event.eventId, version: result.state.version },
    });
  }

  for (const c of result.conflicts) {
    const holder = stamps[c.field];
    const conflictId = uuidv7();
    await tx.insert(conflict).values({
      id: conflictId,
      operationId: h.operationId,
      householdId: h.id,
      eventId: event.eventId,
      fieldName: c.field,
      localValue: JSON.stringify(c.incoming ?? null),
      serverValue: JSON.stringify(c.current ?? null),
      localUserId: actor.userId,
      localDeviceId: actor.deviceId,
      localOrganisationId: actor.organisationId,
      localTime: at,
      serverUserId: holder?.userId ?? null,
      serverDeviceId: holder?.deviceId ?? null,
      serverOrganisationId: holder?.organisationId ?? null,
      serverTime: holder?.at ? new Date(holder.at) : null,
      status: 'open',
    });
    await audit(tx, ctx.crypto, actor, {
      action: 'conflict.detected',
      entityType: 'conflict',
      entityId: conflictId,
      operationId: h.operationId,
      details: { householdId: h.id, field: c.field },
    });
    const orgs = [h.organisationId, actor.organisationId, holder?.organisationId].filter((o): o is string => !!o);
    const coordinators = await query<{ user_id: string }>(
      tx,
      sql`select user_id from app_user where role = 'GROUP_COORDINATOR' and status = 'active'
            and organisation_id in (${sql.join(orgs.map((o) => sql`${o}::uuid`), sql`, `)})`,
    );
    await notify(tx, coordinators.map((r) => r.user_id), 'conflict.new', { field: c.field, householdId: h.id }, `/app/conflicts/${conflictId}`);
  }

  if (result.conflicts.length > 0) return { status: 'conflict', reason: note };
  return { status: 'applied', reason: note };
}

async function applyDistributionCreate(
  ctx: AppContext,
  tx: Tx,
  actor: EventActor,
  event: Extract<SyncEvent, { type: 'distribution.create' }>,
  newDistributions: Set<string>,
): Promise<Outcome> {
  const p = event.payload;
  const bad = await checkOperation(tx, actor, p.operationId);
  if (bad) return { status: 'rejected', reason: bad };
  if (!(await areaInOperation(tx, p.areaId, p.operationId))) return { status: 'rejected', reason: 'invalid_area' };
  const [exists] = await tx.select({ id: distribution.id }).from(distribution).where(eq(distribution.id, event.entityId));
  if (exists) return { status: 'rejected', reason: 'entity_exists' };
  if (p.householdId) {
    const [h] = await tx
      .select({ op: household.operationId })
      .from(household)
      .where(eq(household.id, p.householdId));
    if (!h) return { status: 'deferred' }; // the household's registration has not arrived yet
    if (h.op !== p.operationId) return { status: 'rejected', reason: 'household_other_operation' };
  }
  const itemIds = p.items.map((i) => i.itemId);
  const known = await query<{ item_id: string }>(
    tx,
    sql`select item_id from relief_item where operation_id = ${p.operationId}
           and item_id in (${sql.join(itemIds.map((i) => sql`${i}::uuid`), sql`, `)})`,
  );
  if (known.length !== itemIds.length) return { status: 'rejected', reason: 'invalid_item' };

  const at = effective(p.distributedAt, actor.clockOffsetMs);
  await tx.insert(distribution).values({
    id: event.entityId,
    operationId: p.operationId,
    areaId: p.areaId,
    householdId: p.householdId,
    isAnonymous: p.isAnonymous,
    recordedBy: actor.userId,
    organisationId: actor.organisationId,
    deviceId: actor.deviceId,
    distributedAt: at,
    clientTime: new Date(p.distributedAt),
    status: 'recorded',
    receivedElsewhereToday: p.receivedElsewhereToday,
  });
  await tx.insert(distributionItem).values(
    p.items.map((i) => ({ distributionId: event.entityId, itemId: i.itemId, quantity: i.quantity })),
  );
  if (!p.isAnonymous) newDistributions.add(event.entityId);
  await audit(tx, ctx.crypto, actor, {
    action: p.isAnonymous ? 'distribution.recorded_anonymous' : 'distribution.recorded',
    entityType: 'distribution',
    entityId: event.entityId,
    operationId: p.operationId,
    details: {
      eventId: event.eventId,
      householdId: p.householdId,
      areaId: p.areaId,
      items: p.items,
      receivedElsewhereToday: p.receivedElsewhereToday,
    },
  });
  await replayDeferred(ctx, tx, event.entityId, p.operationId, event.eventId, new Set(), newDistributions);
  return { status: 'applied' };
}

async function applyDistributionVoid(
  ctx: AppContext,
  tx: Tx,
  actor: EventActor,
  event: Extract<SyncEvent, { type: 'distribution.void' }>,
): Promise<Outcome> {
  const [d] = await tx.select().from(distribution).where(eq(distribution.id, event.entityId)).for('update');
  if (!d) return { status: 'deferred' };
  if (d.status === 'voided') return { status: 'applied', reason: 'already_voided' };
  if (d.recordedBy !== actor.userId) return { status: 'rejected', reason: 'not_owner' }; // UC15 2.b
  const [op] = await query<{ status: string }>(tx, sql`select status from operation where operation_id = ${d.operationId}`);
  if (op?.status !== 'active') return { status: 'rejected', reason: 'operation_closed' };
  const voidAt = effective(event.clientTime, actor.clockOffsetMs);
  // C7: the 24-hour window is measured on server-corrected times.
  if (voidAt.getTime() - d.distributedAt.getTime() > CANCEL_WINDOW_HOURS * 3_600_000) {
    return { status: 'rejected', reason: 'void_window_expired' };
  }
  await tx
    .update(distribution)
    .set({
      status: 'voided',
      cancelReason: event.payload.reason,
      voidedAt: voidAt,
      voidedBy: actor.userId,
      version: d.version + 1,
      serverSeq: sql`nextval('change_seq')`,
    })
    .where(eq(distribution.id, d.id));
  await audit(tx, ctx.crypto, actor, {
    action: 'distribution.voided',
    entityType: 'distribution',
    entityId: d.id,
    operationId: d.operationId,
    details: { eventId: event.eventId, reason: event.payload.reason },
  });
  return { status: 'applied' };
}

/** Replays events that were waiting for `entityId` (out-of-order arrival, NFR09). */
async function replayDeferred(
  ctx: AppContext,
  tx: Tx,
  entityId: string,
  operationId: string,
  /** The event creating the entity: still stored as `deferred` until it is finalised. */
  excludeEventId: string,
  touched: Set<string>,
  newDistributions: Set<string>,
): Promise<void> {
  const waiting = await query<{
    event_id: string;
    entity_type: string;
    action: string;
    entity_id: string;
    device_id: string;
    user_id: string;
    organisation_id: string;
    operation_id: string | null;
    device_seq: number;
    base_version: number;
    payload: Record<string, unknown>;
    pii_enc: string | null;
    client_time: Date;
    clock_offset_ms: number;
  }>(
    tx,
    sql`select event_id, entity_type, action, entity_id, device_id, user_id, organisation_id, operation_id, device_seq,
               base_version, payload, pii_enc, client_time, clock_offset_ms
          from sync_event
         where status = 'deferred'
           and event_id <> ${excludeEventId}
           and (entity_id = ${entityId}
                or (action = 'create' and entity_type = 'distribution' and payload->>'householdId' = ${entityId}::text))
         order by device_id, device_seq`,
  );
  for (const w of waiting) {
    let pii: Record<string, unknown> | null = null;
    if (w.pii_enc) {
      const key = await operationDataKey(ctx, tx, w.operation_id ?? operationId);
      if (key) pii = JSON.parse(aesDecrypt(key, w.pii_enc).toString('utf8')) as Record<string, unknown>;
    }
    const replayed = syncEventSchema.safeParse({
      eventId: w.event_id,
      deviceSeq: w.device_seq,
      entityId: w.entity_id,
      baseVersion: w.base_version,
      clientTime: new Date(w.client_time).toISOString(),
      type: `${w.entity_type}.${w.action}`,
      payload: joinPii(w.payload, pii),
    });
    const actor: EventActor = {
      userId: w.user_id,
      organisationId: w.organisation_id,
      deviceId: w.device_id,
      clockOffsetMs: w.clock_offset_ms,
    };
    const outcome: Outcome = replayed.success
      ? await apply(ctx, tx, actor, replayed.data, touched, newDistributions)
      : { status: 'rejected', reason: 'replay_invalid' };
    await finaliseEvent(tx, w.event_id, outcome);
  }
}
