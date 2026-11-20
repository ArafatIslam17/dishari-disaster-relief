/**
 * LocalStore (class diagram) + SyncQueue: the phone's encrypted offline database.
 * Every save writes the record and its outbox event in one IndexedDB transaction, so a
 * crash or battery failure can never leave one without the other (NFR08).
 */
import {
  CANCEL_WINDOW_HOURS,
  MAX_PIN_ATTEMPTS,
  OFFLINE_SESSION_DAYS,
  generateShortCode,
  isValidShortCode,
  jaroWinkler,
  normaliseName,
  normalisePhone,
  normaliseShortCode,
  scoreHouseholds,
  uuidv7,
  type AckStatus,
  type Gps,
  type HouseholdChanges,
  type OutboxStore,
  type PullRequest,
  type PullResponse,
  type PushAck,
  type ReliefItemDTO,
  type Role,
  type SnapshotStore,
  type SyncEventInput,
} from '@relief/shared';
import {
  deriveKek,
  generateDek,
  importRecoveryKey,
  newSalt,
  phoneHmac,
  seal,
  unseal,
  unwrapDek,
  wrapDek,
  type Sealed,
  type WrappedKey,
} from './crypto';
import { ReliefDb, type DistributionRow, type HouseholdRow, type LocalArea, type NoticeRow, type SealedHouseholdFields } from './db';

export interface LocalSession {
  userId: string;
  fullName: string;
  role: Role;
  organisationId: string;
  organisationName: string;
  deviceId: string;
  devicePrefix: string;
  lastOnlineAuthAt: string;
  operationId: string | null;
}

interface Vault {
  salt: Uint8Array;
  iterations: number;
  byPin: WrappedKey | null;
  byRecovery: WrappedKey;
  pinAttempts: number;
  locked: boolean;
}

export interface HouseholdView extends Omit<HouseholdRow, 'sealed'> {
  headName: string | null;
  mobile: string | null;
  gps: Gps | null;
  nameNorm: string;
}

export interface SimilarMatch {
  household: HouseholdView;
  score: number;
  label: 'likely' | 'possible';
}

export class UnlockError extends Error {
  constructor(
    public readonly reason: 'wrong' | 'locked' | 'expired' | 'no_vault',
    public readonly attemptsLeft = 0,
  ) {
    super(reason);
  }
}

export interface NewHousehold {
  areaId: string;
  headName: string;
  mobile: string | null;
  memberCount: number;
  gps: Gps | null;
}

export interface NewDistribution {
  areaId: string;
  householdId: string | null;
  items: { itemId: string; quantity: number }[];
  receivedElsewhereToday: boolean;
}

const unionOf = (a: { upazila: string; unionName: string }) =>
  `${a.upazila.trim().toLowerCase()}|${a.unionName.trim().toLowerCase()}`;

export class LocalStore implements OutboxStore, SnapshotStore {
  readonly db: ReliefDb;
  private dek: CryptoKey | null = null;
  private index = new Map<string, HouseholdView>();
  private areaCache = new Map<string, LocalArea>();
  private listeners = new Set<() => void>();
  /** Pin iterations are lowered only in unit tests. */
  constructor(name = 'relief-field', private readonly iterations?: number) {
    this.db = new ReliefDb(name);
  }

  // ---------- change notification for the UI ----------
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(): void {
    this.listeners.forEach((fn) => fn());
  }

  // ---------- meta ----------
  private async getMeta<T>(key: string): Promise<T | undefined> {
    return (await this.db.meta.get(key))?.value as T | undefined;
  }
  private async setMeta(key: string, value: unknown): Promise<void> {
    await this.db.meta.put({ key, value });
  }

  async deviceId(): Promise<string> {
    let id = await this.getMeta<string>('deviceId');
    if (!id) {
      id = uuidv7();
      await this.setMeta('deviceId', id);
    }
    return id;
  }
  getSession(): Promise<LocalSession | undefined> {
    return this.getMeta<LocalSession>('session');
  }
  async saveSession(session: LocalSession): Promise<void> {
    await this.setMeta('session', session);
    this.emit();
  }
  async hasVault(): Promise<boolean> {
    return (await this.getMeta<Vault>('vault')) !== undefined;
  }
  async vaultStatus(): Promise<{ exists: boolean; hasPin: boolean; locked: boolean; attemptsLeft: number }> {
    const v = await this.getMeta<Vault>('vault');
    return {
      exists: !!v,
      hasPin: !!v?.byPin,
      locked: !!v?.locked,
      attemptsLeft: v ? MAX_PIN_ATTEMPTS - v.pinAttempts : MAX_PIN_ATTEMPTS,
    };
  }
  isUnlocked(): boolean {
    return this.dek !== null;
  }

  // ---------- vault: PIN and recovery (UC02 step 5, 1.a, 1.b) ----------
  /** After an online login: open (or create) the data key with the server's recovery key. */
  async openWithRecovery(recoveryKeyB64: string): Promise<void> {
    const recovery = await importRecoveryKey(recoveryKeyB64);
    const vault = await this.getMeta<Vault>('vault');
    if (!vault) {
      const dek = await generateDek();
      await this.setMeta('vault', {
        salt: newSalt(),
        iterations: this.iterations ?? 0,
        byPin: null,
        byRecovery: await wrapDek(dek, recovery),
        pinAttempts: 0,
        locked: false,
      } satisfies Vault);
      this.dek = dek;
    } else {
      this.dek = await unwrapDek(vault.byRecovery, recovery);
      // A successful online log-in clears a PIN lock-out (Block Diagram 1).
      await this.setMeta('vault', { ...vault, pinAttempts: 0, locked: false });
    }
    await this.loadIndex();
  }

  async setPin(pin: string): Promise<void> {
    if (!this.dek) throw new Error('vault is locked');
    const vault = (await this.getMeta<Vault>('vault')) as Vault;
    const salt = newSalt();
    const kek = await deriveKek(pin, salt, this.iterations);
    await this.setMeta('vault', { ...vault, salt, iterations: this.iterations ?? 0, byPin: await wrapDek(this.dek, kek), pinAttempts: 0, locked: false });
  }

  async unlockWithPin(pin: string, now = new Date()): Promise<void> {
    const vault = await this.getMeta<Vault>('vault');
    const session = await this.getSession();
    if (!vault?.byPin || !session) throw new UnlockError('no_vault');
    if (vault.locked) throw new UnlockError('locked');
    const age = now.getTime() - Date.parse(session.lastOnlineAuthAt);
    if (age > OFFLINE_SESSION_DAYS * 86_400_000) throw new UnlockError('expired'); // UC02 1.b
    try {
      const kek = await deriveKek(pin, vault.salt, vault.iterations || undefined);
      this.dek = await unwrapDek(vault.byPin, kek);
    } catch {
      const attempts = vault.pinAttempts + 1;
      const locked = attempts >= MAX_PIN_ATTEMPTS;
      await this.setMeta('vault', { ...vault, pinAttempts: attempts, locked });
      throw new UnlockError(locked ? 'locked' : 'wrong', MAX_PIN_ATTEMPTS - attempts);
    }
    await this.setMeta('vault', { ...vault, pinAttempts: 0 });
    await this.loadIndex();
    this.emit();
  }

  lock(): void {
    this.dek = null;
    this.index.clear();
    this.emit();
  }

  /** Removes everything on this phone (switching to another volunteer, A8). */
  async wipe(): Promise<void> {
    this.lock();
    await this.db.delete();
    await this.db.open();
    this.areaCache.clear();
    this.emit();
  }

  private key(): CryptoKey {
    if (!this.dek) throw new Error('vault is locked');
    return this.dek;
  }

  // ---------- index ----------
  private toView(row: HouseholdRow, fields: SealedHouseholdFields): HouseholdView {
    const { sealed: _sealed, ...rest } = row;
    return { ...rest, ...fields, nameNorm: normaliseName(fields.headName ?? '') };
  }

  private async loadIndex(): Promise<void> {
    const dek = this.key();
    this.index.clear();
    const rows = await this.db.households.toArray();
    const fields = await Promise.all(rows.map((r) => unseal<SealedHouseholdFields>(dek, r.sealed)));
    rows.forEach((r, i) => this.index.set(r.id, this.toView(r, fields[i] as SealedHouseholdFields)));
    this.areaCache = new Map((await this.db.areas.toArray()).map((a) => [a.id, a]));
  }

  householdCount(): number {
    return this.index.size;
  }
  getHousehold(id: string): HouseholdView | undefined {
    return this.index.get(id);
  }
  households(): HouseholdView[] {
    return [...this.index.values()];
  }
  area(id: string): LocalArea | undefined {
    return this.areaCache.get(id);
  }

  async phoneKey(): Promise<string | null> {
    const sealed = await this.getMeta<Sealed>('phoneKey');
    return sealed && this.dek ? unseal<string>(this.dek, sealed) : null;
  }
  async setPhoneKey(b64: string): Promise<void> {
    await this.setMeta('phoneKey', await seal(this.key(), b64));
  }

  // ---------- search (UC14) and similarity (UC12) ----------
  async search(query: string, limit = 50): Promise<HouseholdView[]> {
    const q = query.trim();
    if (q.length < 2) return [];
    const code = normaliseShortCode(q);
    if (code && isValidShortCode(code)) {
      const byCode = [...this.index.values()].filter((h) => h.shortCode === code);
      if (byCode.length > 0) return byCode;
    }
    const compact = q.toUpperCase().replace(/[\s-]/g, '');
    const phone = normalisePhone(q);
    if (phone) {
      const key = await this.phoneKey();
      const hmac = key ? await phoneHmac(key, phone) : null;
      return [...this.index.values()].filter((h) => h.mobile === phone || (hmac !== null && h.mobileHmac === hmac));
    }
    if (/^[0-9A-Z]{3,8}$/.test(compact) && /\d/.test(compact)) {
      const partial = [...this.index.values()].filter((h) => h.shortCode.startsWith(compact));
      if (partial.length > 0) return partial.slice(0, limit);
    }
    const term = normaliseName(q);
    if (!term) return [];
    const queryTokens = term.split(' ');
    const scored: { h: HouseholdView; s: number }[] = [];
    for (const h of this.index.values()) {
      if (!h.nameNorm) continue;
      let s: number;
      if (h.nameNorm.includes(term)) s = 1 + term.length / 100;
      else {
        // Each query word against its best-matching name word, so "Rafikul Islam" finds "Md Rafiqul Islam".
        const tokens = h.nameNorm.split(' ');
        const tokenScore = queryTokens.reduce((sum, qt) => sum + Math.max(...tokens.map((nt) => jaroWinkler(qt, nt))), 0) / queryTokens.length;
        s = Math.max(jaroWinkler(term, h.nameNorm), tokenScore);
      }
      if (s >= 0.86) scored.push({ h, s });
    }
    return scored
      .sort((a, b) => b.s - a.s)
      .slice(0, limit)
      .map((x) => x.h);
  }

  /** Local similarity warning before saving (FR09): same union, score >= 0.65. */
  async findSimilar(input: NewHousehold): Promise<SimilarMatch[]> {
    const area = this.areaCache.get(input.areaId);
    if (!area) return [];
    const union = unionOf(area);
    const key = await this.phoneKey();
    const mobile = input.mobile ? normalisePhone(input.mobile) : null;
    const hmac = mobile && key ? await phoneHmac(key, mobile) : null;
    const target = {
      headName: input.headName,
      phone: mobile,
      phoneHmac: hmac,
      memberCount: input.memberCount,
      unionKey: union,
      wardKey: area.ward.trim().toLowerCase(),
      gps: input.gps,
    };
    const out: SimilarMatch[] = [];
    for (const h of this.index.values()) {
      const ha = this.areaCache.get(h.areaId);
      if (!ha || unionOf(ha) !== union || !h.headName) continue;
      const s = scoreHouseholds(target, {
        headName: h.headName,
        phone: h.mobile,
        phoneHmac: h.mobileHmac,
        memberCount: h.memberCount,
        unionKey: union,
        wardKey: ha.ward.trim().toLowerCase(),
        gps: h.gps,
      });
      if (s.label) out.push({ household: h, score: s.score, label: s.label });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 5);
  }

  async distributionsFor(householdId: string): Promise<DistributionRow[]> {
    const linked = this.index.get(householdId)?.linked ?? [];
    const rows = await this.db.distributions.where('householdId').anyOf([householdId, ...linked]).toArray();
    return rows.sort((a, b) => b.distributedAt.localeCompare(a.distributedAt));
  }

  // ---------- writes: record + outbox in one transaction ----------
  private async nextSeq(): Promise<number> {
    const n = ((await this.getMeta<number>('deviceSeq')) ?? 0) + 1;
    await this.setMeta('deviceSeq', n);
    return n;
  }

  /**
   * IndexedDB transactions auto-commit when they await anything that is not IndexedDB, so the
   * event is encrypted *before* the transaction; inside it only the sequence number and the
   * write happen. `deviceSeq` lives in a plaintext column and is merged back when read.
   */
  private async prepareEvent(event: Omit<SyncEventInput, 'deviceSeq' | 'eventId'>, areaId: string) {
    const eventId = uuidv7();
    return { eventId, type: event.type, entityId: event.entityId, areaId, sealed: await seal(this.key(), { ...event, eventId }) };
  }

  private async writeEvent(prepared: Awaited<ReturnType<LocalStore['prepareEvent']>>): Promise<void> {
    const deviceSeq = await this.nextSeq();
    await this.db.outbox.add({
      eventId: prepared.eventId,
      deviceSeq,
      type: prepared.type,
      entityId: prepared.entityId,
      areaId: prepared.areaId,
      status: 'pending',
      attempts: 0,
      lastError: null,
      createdAt: new Date().toISOString(),
      sealed: prepared.sealed,
    });
  }

  /** UC11 Register Household: saved and queued; returns the short code. */
  async saveHousehold(input: NewHousehold, consentAt: Date = new Date()): Promise<HouseholdView> {
    const session = await this.requireSession();
    const operationId = session.operationId as string;
    const id = uuidv7();
    const shortCode = generateShortCode(session.devicePrefix);
    const key = await this.phoneKey();
    const mobile = input.mobile ? normalisePhone(input.mobile) : null;
    const hmac = mobile && key ? await phoneHmac(key, mobile) : null;
    const fields: SealedHouseholdFields = { headName: input.headName.trim(), mobile, gps: input.gps };
    const now = new Date().toISOString();
    const row: HouseholdRow = {
      id,
      operationId,
      areaId: input.areaId,
      shortCode,
      version: 0,
      memberCount: input.memberCount,
      organisationId: session.organisationId,
      organisationName: session.organisationName,
      mobileHmac: hmac,
      mobileMasked: null,
      linked: [],
      redacted: false,
      createdAt: now,
      serverSeq: '0',
      pending: 1,
      sealed: await seal(this.key(), fields),
    };
    const prepared = await this.prepareEvent(
        {
          type: 'household.create',
          entityId: id,
          baseVersion: 0,
          clientTime: now,
          payload: {
            operationId,
            areaId: input.areaId,
            shortCode,
            headName: fields.headName as string,
            mobile,
            memberCount: input.memberCount,
            consentGiven: true,
            consentAt: consentAt.toISOString(),
            gps: input.gps,
          },
        },
        input.areaId,
      );
    await this.db.transaction('rw', [this.db.households, this.db.outbox, this.db.meta], async () => {
      await this.db.households.add(row);
      await this.writeEvent(prepared);
    });
    const view = this.toView(row, fields);
    this.index.set(id, view);
    this.emit();
    return view;
  }

  /** UC15 Correct Records: a new version is queued; the server merges per field. */
  async updateHousehold(id: string, changes: HouseholdChanges): Promise<boolean> {
    const current = this.index.get(id);
    if (!current) throw new Error('household not on this phone');
    const clean: HouseholdChanges = {};
    if (changes.headName !== undefined && changes.headName.trim() !== current.headName) clean.headName = changes.headName.trim();
    if (changes.mobile !== undefined) {
      const m = changes.mobile ? normalisePhone(changes.mobile) : null;
      if (m !== current.mobile) clean.mobile = m;
    }
    if (changes.memberCount !== undefined && changes.memberCount !== current.memberCount) clean.memberCount = changes.memberCount;
    if (changes.areaId !== undefined && changes.areaId !== current.areaId) clean.areaId = changes.areaId;
    if (changes.gps !== undefined && JSON.stringify(changes.gps) !== JSON.stringify(current.gps)) clean.gps = changes.gps;
    if (Object.keys(clean).length === 0) return false;
    const updated = await this.applyLocalChanges(id, clean, true);
    const prepared = await this.prepareEvent(
      { type: 'household.update', entityId: id, baseVersion: current.version, clientTime: new Date().toISOString(), payload: { changes: clean } },
      updated.row.areaId,
    );
    await this.db.transaction('rw', [this.db.households, this.db.outbox, this.db.meta], async () => {
      await this.db.households.put(updated.row);
      await this.writeEvent(prepared);
    });
    this.index.set(id, updated.view);
    this.emit();
    return true;
  }

  private async applyLocalChanges(id: string, changes: HouseholdChanges, pending: boolean) {
    const row = (await this.db.households.get(id)) as HouseholdRow;
    const fields = await unseal<SealedHouseholdFields>(this.key(), row.sealed);
    if (changes.headName !== undefined) fields.headName = changes.headName;
    if (changes.mobile !== undefined) {
      fields.mobile = changes.mobile;
      const key = await this.phoneKey();
      row.mobileHmac = changes.mobile && key ? await phoneHmac(key, changes.mobile) : null;
    }
    if (changes.gps !== undefined) fields.gps = changes.gps;
    if (changes.memberCount !== undefined) row.memberCount = changes.memberCount;
    if (changes.areaId !== undefined) row.areaId = changes.areaId;
    if (pending) row.pending = 1;
    row.sealed = await seal(this.key(), fields);
    return { row, view: this.toView(row, fields) };
  }

  /** UC13 Record Relief Distribution (or anonymous, UC13 1.a). */
  async saveDistribution(input: NewDistribution, at: Date = new Date()): Promise<DistributionRow> {
    const session = await this.requireSession();
    if (input.items.length === 0 || input.items.some((i) => !Number.isInteger(i.quantity) || i.quantity <= 0)) {
      throw new Error('quantity_positive');
    }
    const id = uuidv7();
    const row: DistributionRow = {
      id,
      operationId: session.operationId as string,
      areaId: input.areaId,
      householdId: input.householdId,
      isAnonymous: input.householdId === null,
      items: input.items,
      distributedAt: at.toISOString(),
      status: 'recorded',
      cancelReason: null,
      organisationId: session.organisationId,
      organisationName: session.organisationName,
      recordedBy: session.userId,
      receivedElsewhereToday: input.receivedElsewhereToday,
      serverSeq: '0',
      pending: 1,
    };
    const prepared = await this.prepareEvent(
        {
          type: 'distribution.create',
          entityId: id,
          baseVersion: 0,
          clientTime: at.toISOString(),
          payload: {
            operationId: row.operationId,
            areaId: row.areaId,
            householdId: row.householdId,
            isAnonymous: row.isAnonymous,
            items: row.items,
            distributedAt: row.distributedAt,
            receivedElsewhereToday: row.receivedElsewhereToday,
          },
        },
        row.areaId,
      );
    await this.db.transaction('rw', [this.db.distributions, this.db.outbox, this.db.meta], async () => {
      await this.db.distributions.add(row);
      await this.writeEvent(prepared);
    });
    this.emit();
    return row;
  }

  /** UC15 2.a / 2.b: own distribution within 24 hours (device time; the server re-checks on its clock). */
  async canVoid(d: DistributionRow, now = new Date()): Promise<boolean> {
    const session = await this.getSession();
    return (
      d.status === 'recorded' &&
      d.recordedBy === session?.userId &&
      now.getTime() - Date.parse(d.distributedAt) <= CANCEL_WINDOW_HOURS * 3_600_000
    );
  }

  async voidDistribution(id: string, reason: string): Promise<void> {
    const d = await this.db.distributions.get(id);
    if (!d || !(await this.canVoid(d))) throw new Error('cannot_void');
    const prepared = await this.prepareEvent(
      { type: 'distribution.void', entityId: id, baseVersion: 0, clientTime: new Date().toISOString(), payload: { reason } },
      d.areaId,
    );
    await this.db.transaction('rw', [this.db.distributions, this.db.outbox, this.db.meta], async () => {
      await this.db.distributions.put({ ...d, status: 'voided', cancelReason: reason, pending: 1 });
      await this.writeEvent(prepared);
    });
    this.emit();
  }

  private async requireSession(): Promise<LocalSession> {
    const s = await this.getSession();
    if (!s?.operationId) throw new Error('no operation selected');
    return s;
  }

  // ---------- notices (local notifications: sync failures, rejections) ----------
  async addNotice(type: string, params: Record<string, string | number>, link: string | null = null): Promise<void> {
    await this.db.notices.add({ id: uuidv7(), type, params, link, createdAt: new Date().toISOString(), read: 0 });
    this.emit();
  }
  notices(): Promise<NoticeRow[]> {
    return this.db.notices.orderBy('createdAt').reverse().limit(100).toArray();
  }
  async markNoticesRead(): Promise<void> {
    await this.db.notices.toCollection().modify({ read: 1 });
    this.emit();
  }

  // ---------- SyncQueue / OutboxStore ----------
  pendingCount(): Promise<number> {
    return this.db.outbox.count();
  }
  async oldestPendingAt(): Promise<string | null> {
    const first = await this.db.outbox.orderBy('deviceSeq').first();
    return first?.createdAt ?? null;
  }
  outboxRows() {
    return this.db.outbox.orderBy('deviceSeq').toArray();
  }

  async unacknowledged(limit: number): Promise<SyncEventInput[]> {
    const rows = await this.db.outbox.orderBy('deviceSeq').limit(limit).toArray();
    return Promise.all(rows.map(async (r) => ({ ...(await unseal<SyncEventInput>(this.key(), r.sealed)), deviceSeq: r.deviceSeq })));
  }
  async markUploading(eventIds: string[]): Promise<void> {
    await this.db.outbox.where('eventId').anyOf(eventIds).modify({ status: 'uploading' });
  }
  async markFailed(eventIds: string[], error: string): Promise<void> {
    await this.db.outbox
      .where('eventId')
      .anyOf(eventIds)
      .modify((r) => {
        r.status = 'failed';
        r.attempts += 1;
        r.lastError = error;
      });
    this.emit();
  }

  async applyAcks(acks: PushAck[], meta: { clockOffsetMs: number; serverTime: string }): Promise<void> {
    await this.setMeta('clockOffsetMs', meta.clockOffsetMs);
    const resync = new Set<string>();
    for (const ack of acks) {
      const row = await this.db.outbox.get(ack.eventId);
      if (!row) continue;
      await this.handleAck(row.type, row.entityId, row.areaId, ack.status, ack, resync);
      await this.db.outbox.delete(ack.eventId);
    }
    // Rejected or conflicting edits: download the area again so the phone shows the server's value.
    for (const areaId of resync) await this.db.areas.update(areaId, { cursor: '0' });
    this.emit();
  }

  private async handleAck(type: string, entityId: string, areaId: string, status: AckStatus, ack: PushAck, resync: Set<string>) {
    if (ack.shortCode && type === 'household.create') {
      await this.db.households.update(entityId, { shortCode: ack.shortCode });
      const view = this.index.get(entityId);
      if (view) this.index.set(entityId, { ...view, shortCode: ack.shortCode });
      await this.addNotice('shortcode.reissued', { from: view?.shortCode ?? '', to: ack.shortCode }, `/field/households/${entityId}`);
    }
    if (status === 'rejected') {
      await this.addNotice('event.rejected', { entity: type.split('.')[0] ?? type, reason: ack.reason ?? 'rejected' }, '/field/sync');
      if (type === 'household.create') {
        await this.db.households.delete(entityId);
        this.index.delete(entityId);
      } else if (type === 'distribution.create') {
        await this.db.distributions.delete(entityId);
      } else resync.add(areaId);
    } else if (status === 'conflict' || ack.reason === 'mobile_not_editable') {
      resync.add(areaId);
    }
  }

  // ---------- SnapshotStore (download, FR15) ----------
  async selectedAreas(): Promise<LocalArea[]> {
    return (await this.db.areas.toArray()).filter((a) => a.downloadedAt !== null);
  }

  async pullRequest(): Promise<PullRequest | null> {
    const session = await this.getSession();
    if (!session?.operationId) return null;
    const areas = (await this.selectedAreas()).filter((a) => a.operationId === session.operationId);
    return {
      operationId: session.operationId,
      areas: areas.map((a) => ({ areaId: a.id, cursor: a.cursor })),
      globalCursor: (await this.getMeta<string>('globalCursor')) ?? '0',
      limit: 1000,
    };
  }

  async applyPull(res: PullResponse): Promise<void> {
    const dek = this.key();
    const sealedRows = await Promise.all(
      res.households.map(async (h) => {
        const fields: SealedHouseholdFields = { headName: h.headName, mobile: h.mobile, gps: h.gps };
        const row: HouseholdRow = {
          id: h.id,
          operationId: h.operationId,
          areaId: h.areaId,
          shortCode: h.shortCode,
          version: h.version,
          memberCount: h.memberCount,
          organisationId: h.organisationId,
          organisationName: h.organisationName,
          mobileHmac: h.mobileHmac,
          mobileMasked: h.mobileMasked,
          linked: h.linkedHouseholdIds,
          redacted: h.redacted,
          createdAt: h.createdAt,
          serverSeq: h.serverSeq,
          pending: 0,
          sealed: await seal(dek, fields),
        };
        return { row, fields };
      }),
    );
    // Events still waiting on this phone are re-applied on top of the server snapshot.
    const pendingEvents = await this.unacknowledged(10_000);
    await this.db.transaction('rw', [this.db.households, this.db.distributions, this.db.areas, this.db.items, this.db.releases, this.db.meta], async () => {
      await this.db.households.bulkPut(sealedRows.map((s) => s.row));
      await this.db.distributions.bulkPut(res.distributions.map((d) => ({ ...d, pending: 0 as const })));
      for (const [areaId, cursor] of Object.entries(res.areaCursors)) await this.db.areas.update(areaId, { cursor });
      const known = new Map((await this.db.areas.toArray()).map((a) => [a.id, a]));
      await this.db.areas.bulkPut(
        res.areas.map((a) => ({ ...a, downloadedAt: known.get(a.id)?.downloadedAt ?? null, cursor: known.get(a.id)?.cursor ?? '0' })),
      );
      await this.db.items.bulkPut(res.items);
      if (res.releases.length > 0) await this.db.releases.bulkPut(res.releases);
      await this.setMeta('globalCursor', res.globalCursor);
    });
    for (const { row, fields } of sealedRows) this.index.set(row.id, this.toView(row, fields));
    const touched = new Set(sealedRows.map((s) => s.row.id));
    for (const e of pendingEvents) {
      if (e.type === 'household.update' && touched.has(e.entityId)) {
        const updated = await this.applyLocalChanges(e.entityId, e.payload.changes as HouseholdChanges, true);
        await this.db.households.put(updated.row);
        this.index.set(e.entityId, updated.view);
      }
      if (e.type === 'distribution.void') {
        await this.db.distributions.update(e.entityId, { status: 'voided', cancelReason: e.payload.reason, pending: 1 });
      }
    }
    this.areaCache = new Map((await this.db.areas.toArray()).map((a) => [a.id, a]));
    await this.setMeta('lastPullAt', res.serverTime);
    this.emit();
  }

  /** UC10: mark areas for download; the next pull brings their households (cursor 0). */
  async selectAreas(areaIds: string[], now = new Date()): Promise<void> {
    await this.db.transaction('rw', this.db.areas, async () => {
      for (const id of areaIds) await this.db.areas.update(id, { downloadedAt: now.toISOString(), cursor: '0' });
    });
    this.areaCache = new Map((await this.db.areas.toArray()).map((a) => [a.id, a]));
    this.emit();
  }

  async storeAreasAndItems(areas: LocalArea[], items: ReliefItemDTO[]): Promise<void> {
    await this.db.transaction('rw', [this.db.areas, this.db.items], async () => {
      const known = new Map((await this.db.areas.toArray()).map((a) => [a.id, a]));
      await this.db.areas.bulkPut(areas.map((a) => ({ ...a, downloadedAt: known.get(a.id)?.downloadedAt ?? null, cursor: known.get(a.id)?.cursor ?? '0' })));
      await this.db.items.bulkPut(items);
    });
    this.areaCache = new Map((await this.db.areas.toArray()).map((a) => [a.id, a]));
    this.emit();
  }

  getNumber(key: 'clockOffsetMs'): Promise<number | undefined> {
    return this.getMeta<number>(key);
  }
}

export const localStore = new LocalStore();
