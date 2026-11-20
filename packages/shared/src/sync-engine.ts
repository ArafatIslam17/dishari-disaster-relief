import { SYNC_BATCH_MAX_BYTES, SYNC_BATCH_MAX_EVENTS } from './constants.js';
import type { PullRequest, PullResponse, PushAck, PushResponse, SyncEventInput } from './schemas.js';

/**
 * Client sync engine (UC16, Fig 5.5, Fig 5.9). Storage and transport are injected,
 * so the PWA (Dexie + fetch) and the device simulator (memory + HTTP) run the same code.
 */
export type SyncErrorKind = 'network' | 'auth' | 'revoked' | 'server' | 'closed';

export class SyncError extends Error {
  constructor(
    public readonly kind: SyncErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'SyncError';
  }
}

export interface OutboxStore {
  /** Unacknowledged events in device order (deviceSeq ascending); resumes from the first unconfirmed one. */
  unacknowledged(limit: number): Promise<SyncEventInput[]>;
  markUploading(eventIds: string[]): Promise<void>;
  /** Removes acknowledged events from the queue and records server outcomes. */
  applyAcks(acks: PushAck[], meta: { clockOffsetMs: number; serverTime: string }): Promise<void>;
  /** Connection lost or timeout: events stay queued as failed/retryable (Fig 5.9). */
  markFailed(eventIds: string[], error: string): Promise<void>;
  pendingCount(): Promise<number>;
}

export interface SnapshotStore {
  /** Null when no area has been downloaded yet. */
  pullRequest(): Promise<PullRequest | null>;
  applyPull(response: PullResponse): Promise<void>;
}

export interface SyncTransport {
  push(body: { sentAt: string; events: SyncEventInput[] }): Promise<PushResponse>;
  pull(body: PullRequest): Promise<PullResponse>;
}

export interface SyncResult {
  ok: boolean;
  uploaded: number;
  duplicates: number;
  conflicts: number;
  deferred: number;
  rejected: number;
  downloadedHouseholds: number;
  downloadedDistributions: number;
  batches: number;
  error?: { kind: SyncErrorKind; message: string };
  finishedAt: string;
}

export interface SyncOptions {
  maxEvents?: number;
  maxBytes?: number;
  now?: () => Date;
  /** Upper bound on pull pages per run, so a run always ends. */
  maxPullPages?: number;
}

/** Take a prefix of `events` that fits both the count and the byte budget (at least one event). */
export function takeBatch(events: SyncEventInput[], maxEvents: number, maxBytes: number): SyncEventInput[] {
  const batch: SyncEventInput[] = [];
  let bytes = 2;
  for (const e of events) {
    if (batch.length >= maxEvents) break;
    const size = JSON.stringify(e).length + 1;
    if (batch.length > 0 && bytes + size > maxBytes) break;
    batch.push(e);
    bytes += size;
  }
  return batch;
}

export async function runSync(
  deps: { outbox: OutboxStore; snapshot: SnapshotStore; transport: SyncTransport },
  options: SyncOptions = {},
): Promise<SyncResult> {
  const maxEvents = options.maxEvents ?? SYNC_BATCH_MAX_EVENTS;
  const maxBytes = options.maxBytes ?? SYNC_BATCH_MAX_BYTES;
  const now = options.now ?? (() => new Date());
  const result: SyncResult = {
    ok: true,
    uploaded: 0,
    duplicates: 0,
    conflicts: 0,
    deferred: 0,
    rejected: 0,
    downloadedHouseholds: 0,
    downloadedDistributions: 0,
    batches: 0,
    finishedAt: now().toISOString(),
  };

  // ---- upload loop: "pending batches remain" ----
  for (;;) {
    const candidates = await deps.outbox.unacknowledged(maxEvents);
    if (candidates.length === 0) break;
    const batch = takeBatch(candidates, maxEvents, maxBytes);
    const ids = batch.map((e) => e.eventId);
    await deps.outbox.markUploading(ids);
    let response: PushResponse;
    try {
      response = await deps.transport.push({ sentAt: now().toISOString(), events: batch });
    } catch (err) {
      const e = toSyncError(err);
      await deps.outbox.markFailed(ids, e.message);
      return finish(result, e, now);
    }
    await deps.outbox.applyAcks(response.acks, { clockOffsetMs: response.clockOffsetMs, serverTime: response.serverTime });
    result.batches++;
    for (const ack of response.acks) {
      if (ack.status === 'applied') result.uploaded++;
      else if (ack.status === 'duplicate') result.duplicates++;
      else if (ack.status === 'conflict') result.conflicts++;
      else if (ack.status === 'deferred') result.deferred++;
      else result.rejected++;
    }
    const acked = new Set(response.acks.map((a) => a.eventId));
    const missing = ids.filter((id) => !acked.has(id));
    if (missing.length > 0) {
      // A partial acknowledgement: keep the rest queued and stop, so we resume from the first unconfirmed event.
      await deps.outbox.markFailed(missing, 'not acknowledged');
      return finish(result, new SyncError('server', 'Batch partially acknowledged'), now);
    }
  }

  // ---- download shared updates ----
  const maxPages = options.maxPullPages ?? 200;
  for (let page = 0; page < maxPages; page++) {
    const request = await deps.snapshot.pullRequest();
    if (!request) break;
    let response: PullResponse;
    try {
      response = await deps.transport.pull(request);
    } catch (err) {
      return finish(result, toSyncError(err), now);
    }
    await deps.snapshot.applyPull(response);
    result.downloadedHouseholds += response.households.length;
    result.downloadedDistributions += response.distributions.length;
    if (!response.hasMore) break;
  }
  result.finishedAt = now().toISOString();
  return result;
}

function toSyncError(err: unknown): SyncError {
  if (err instanceof SyncError) return err;
  return new SyncError('network', err instanceof Error ? err.message : String(err));
}

function finish(result: SyncResult, error: SyncError, now: () => Date): SyncResult {
  result.ok = false;
  result.error = { kind: error.kind, message: error.message };
  result.finishedAt = now().toISOString();
  return result;
}
