/**
 * Device simulator: in-memory field devices running the real shared sync engine over HTTP
 * against the real API, with injectable bandwidth, latency, dropped requests, lost responses
 * and repeated uploads.
 */
import {
  SyncError,
  generateShortCode,
  runSync,
  uuidv7,
  type DistributionDTO,
  type HouseholdDTO,
  type OutboxStore,
  type PullRequest,
  type PullResponse,
  type PushAck,
  type PushResponse,
  type SnapshotStore,
  type SyncEventInput,
  type SyncResult,
  type SyncTransport,
} from '@relief/shared';

export interface SimSession {
  token: string;
  deviceId: string;
  prefix: string;
  userId: string;
  organisationId: string;
}

export async function simLogin(baseUrl: string, mobile: string, password: string, deviceId = uuidv7()): Promise<SimSession> {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mobile, password, device: { id: deviceId, label: 'Simulated phone' } }),
  });
  if (!res.ok) throw new Error(`login ${mobile}: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { accessToken: string; user: { id: string; organisationId: string }; device: { id: string; prefix: string } };
  return { token: body.accessToken, deviceId: body.device.id, prefix: body.device.prefix, userId: body.user.id, organisationId: body.user.organisationId };
}

export interface NetworkProfile {
  /** Bits per second each way; 0 = unlimited. */
  bandwidthBps?: number;
  latencyMs?: number;
  /** Probability that a push request is lost before reaching the server. */
  dropBefore?: number;
  /** Probability that the server processes a push but the response is lost. */
  dropAfter?: number;
  /** Probability of sending a just-acknowledged batch again (duplicate upload). */
  repeat?: number;
  random?: () => number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class HttpTransport implements SyncTransport {
  bytesSent = 0;
  bytesReceived = 0;
  requests = 0;
  latencies: number[] = [];
  private lastBatch: { sentAt: string; events: SyncEventInput[] } | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly session: SimSession,
    private readonly net: NetworkProfile = {},
  ) {}

  private async wire(bytes: number): Promise<void> {
    const ms = (this.net.latencyMs ?? 0) + (this.net.bandwidthBps ? (bytes * 8 * 1000) / this.net.bandwidthBps : 0);
    if (ms > 0) await sleep(ms);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const payload = JSON.stringify(body);
    this.requests++;
    this.bytesSent += payload.length;
    const started = performance.now();
    await this.wire(payload.length);
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.session.token}` },
      body: payload,
    });
    const text = await res.text();
    this.bytesReceived += text.length;
    await this.wire(text.length); // charged uncompressed: a conservative upper bound
    this.latencies.push(performance.now() - started);
    if (res.status === 401) throw new SyncError('auth', 'expired');
    if (res.status === 403) throw new SyncError('revoked', text);
    if (!res.ok) throw new SyncError('server', `${res.status} ${text.slice(0, 200)}`);
    return JSON.parse(text) as T;
  }

  async push(body: { sentAt: string; events: SyncEventInput[] }): Promise<PushResponse> {
    const r = this.net.random ?? Math.random;
    if (this.lastBatch && r() < (this.net.repeat ?? 0)) {
      await this.post<PushResponse>('/api/sync/push', this.lastBatch); // an old batch arrives again
    }
    if (r() < (this.net.dropBefore ?? 0)) throw new SyncError('network', 'connection lost before upload');
    const res = await this.post<PushResponse>('/api/sync/push', body);
    this.lastBatch = body;
    if (r() < (this.net.dropAfter ?? 0)) throw new SyncError('network', 'response lost after upload');
    return res;
  }

  pull(body: PullRequest): Promise<PullResponse> {
    return this.post<PullResponse>('/api/sync/pull', body);
  }
}

/** One simulated phone: outbox + snapshot in memory, the same contracts as the PWA's LocalStore. */
export class SimDevice implements OutboxStore, SnapshotStore {
  private seq = 0;
  readonly outbox = new Map<string, SyncEventInput>();
  readonly households = new Map<string, HouseholdDTO>();
  readonly distributions = new Map<string, DistributionDTO>();
  readonly acks: PushAck[] = [];
  readonly generated: SyncEventInput[] = [];
  private cursors = new Map<string, string>();
  private globalCursor = '0';

  constructor(
    readonly session: SimSession,
    readonly operationId: string,
    areaIds: string[],
  ) {
    for (const a of areaIds) this.cursors.set(a, '0');
  }

  private add(e: Omit<SyncEventInput, 'eventId' | 'deviceSeq' | 'clientTime'>): SyncEventInput {
    const event = { ...e, eventId: uuidv7(), deviceSeq: ++this.seq, clientTime: new Date().toISOString() } as SyncEventInput;
    this.outbox.set(event.eventId, event);
    this.generated.push(event);
    return event;
  }

  household(areaId: string, f: { headName: string; mobile: string | null; memberCount: number }, id = uuidv7()): string {
    this.add({
      type: 'household.create',
      entityId: id,
      baseVersion: 0,
      payload: {
        operationId: this.operationId,
        areaId,
        shortCode: generateShortCode(this.session.prefix),
        headName: f.headName,
        mobile: f.mobile,
        memberCount: f.memberCount,
        consentGiven: true,
        consentAt: new Date().toISOString(),
        gps: null,
      },
    });
    return id;
  }

  update(householdId: string, baseVersion: number, changes: Record<string, unknown>): void {
    this.add({ type: 'household.update', entityId: householdId, baseVersion, payload: { changes } } as Omit<SyncEventInput, 'eventId' | 'deviceSeq' | 'clientTime'>);
  }

  distribution(areaId: string, householdId: string | null, itemId: string, quantity: number): string {
    const id = uuidv7();
    this.add({
      type: 'distribution.create',
      entityId: id,
      baseVersion: 0,
      payload: {
        operationId: this.operationId,
        areaId,
        householdId,
        isAnonymous: householdId === null,
        items: [{ itemId, quantity }],
        distributedAt: new Date().toISOString(),
        receivedElsewhereToday: false,
      },
    });
    return id;
  }

  // OutboxStore
  async unacknowledged(limit: number) {
    return [...this.outbox.values()].sort((a, b) => a.deviceSeq - b.deviceSeq).slice(0, limit);
  }
  async markUploading() {}
  async markFailed() {}
  async applyAcks(acks: PushAck[]) {
    for (const a of acks) {
      this.outbox.delete(a.eventId);
      this.acks.push(a);
    }
  }
  async pendingCount() {
    return this.outbox.size;
  }

  // SnapshotStore
  async pullRequest(): Promise<PullRequest> {
    return {
      operationId: this.operationId,
      areas: [...this.cursors.entries()].map(([areaId, cursor]) => ({ areaId, cursor })),
      globalCursor: this.globalCursor,
      limit: 2000,
    };
  }
  async applyPull(res: PullResponse) {
    for (const h of res.households) this.households.set(h.id, h);
    for (const d of res.distributions) this.distributions.set(d.id, d);
    for (const [a, c] of Object.entries(res.areaCursors)) this.cursors.set(a, c);
    this.globalCursor = res.globalCursor;
  }

  /** Repeats sync until the outbox is empty, as a phone would on each reconnection. */
  async syncUntilDone(transport: SyncTransport, opts: { maxEvents?: number; maxRounds?: number } = {}): Promise<{ rounds: number; results: SyncResult[] }> {
    const results: SyncResult[] = [];
    for (let round = 1; round <= (opts.maxRounds ?? 200); round++) {
      const r = await runSync({ outbox: this, snapshot: this, transport }, { maxEvents: opts.maxEvents });
      results.push(r);
      if (r.ok && this.outbox.size === 0) return { rounds: round, results };
      if (r.error?.kind === 'auth' || r.error?.kind === 'revoked') throw new Error(`sync stopped: ${r.error.kind}`);
    }
    throw new Error('sync did not finish');
  }

  /** Comparable view of what this device believes (for convergence, NFR10). */
  fingerprint(): string {
    const hs = [...this.households.values()].map((h) => `${h.id}:${h.version}:${h.memberCount}:${h.areaId}:${h.headName}`).sort();
    const ds = [...this.distributions.values()].map((d) => `${d.id}:${d.status}`).sort();
    return `${hs.join('|')}#${ds.join('|')}`;
  }
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] as number;
}
