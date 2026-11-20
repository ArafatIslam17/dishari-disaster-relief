import {
  CLOCK_SKEW_WARN_MS,
  SYNC_FAILURES_BEFORE_NOTICE,
  SyncError,
  runSync,
  type PullRequest,
  type PullResponse,
  type PushResponse,
  type SyncEventInput,
  type SyncResult,
  type SyncTransport,
} from '@relief/shared';
import { ApiError, api } from '../api/client';
import { localStore, type LocalStore } from './store';

export interface SyncStatus {
  online: boolean;
  running: boolean;
  pending: number;
  lastSyncAt: string | null;
  lastResult: SyncResult | null;
  consecutiveFailures: number;
  needsLogin: boolean;
  revoked: boolean;
  skewMinutes: number;
}

const STALE_HOURS = 24;

/** Maps HTTP failures onto the engine's error kinds (Fig 5.9: failed/retryable, or rejected). */
export const httpTransport: SyncTransport = {
  async push(body: { sentAt: string; events: SyncEventInput[] }) {
    return call(() => api.post<PushResponse>('/api/sync/push', body));
  },
  async pull(body: PullRequest) {
    return call(() => api.post<PullResponse>('/api/sync/pull', body));
  },
};

async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 0) throw new SyncError('network', 'network');
      if (err.code === 'device_revoked') throw new SyncError('revoked', err.code);
      if (err.status === 401) throw new SyncError('auth', err.code);
      if (err.code === 'operation_closed') throw new SyncError('closed', err.code);
      throw new SyncError('server', err.code);
    }
    throw new SyncError('network', String(err));
  }
}

export class SyncManager {
  private status: SyncStatus = {
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    running: false,
    pending: 0,
    lastSyncAt: null,
    lastResult: null,
    consecutiveFailures: 0,
    needsLogin: false,
    revoked: false,
    skewMinutes: 0,
  };
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private canSync: () => boolean = () => false;

  constructor(
    private readonly store: LocalStore,
    private readonly transport: SyncTransport,
  ) {}

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getStatus = (): SyncStatus => this.status;

  private set(patch: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...patch };
    this.listeners.forEach((fn) => fn());
  }

  /** Starts automatic sync: when the connection returns, every 2 minutes, and shortly after each save. */
  start(canSync: () => boolean): () => void {
    this.canSync = canSync;
    const onOnline = () => {
      this.set({ online: true });
      void this.syncNow('auto');
    };
    const onOffline = () => this.set({ online: false });
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    const unsub = this.store.subscribe(() => void this.refreshCounts());
    this.timer = setInterval(() => void this.syncNow('auto'), 120_000);
    void this.refreshCounts().then(() => this.syncNow('auto'));
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      unsub();
      if (this.timer) clearInterval(this.timer);
    };
  }

  /** Called after a local save: sync soon if online, without blocking the volunteer. */
  soon(): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => void this.syncNow('auto'), 3000);
  }

  async refreshCounts(): Promise<void> {
    const pending = await this.store.pendingCount();
    const offset = (await this.store.getNumber('clockOffsetMs')) ?? 0;
    const lastSyncAt = (await this.store.db.meta.get('lastSyncAt'))?.value as string | undefined;
    this.set({
      pending,
      lastSyncAt: lastSyncAt ?? null,
      skewMinutes: Math.abs(offset) > CLOCK_SKEW_WARN_MS ? Math.round(offset / 60_000) : 0,
    });
    await this.checkStale();
  }

  /** UC16 Synchronise Data. Manual runs ignore the online flag (the radio may be wrong). */
  async syncNow(trigger: 'manual' | 'auto' = 'manual'): Promise<SyncResult | null> {
    if (this.status.running || !this.store.isUnlocked() || !this.canSync()) return null;
    if (trigger === 'auto' && !navigator.onLine) return null;
    this.set({ running: true });
    try {
      const result = await runSync({ outbox: this.store, snapshot: this.store, transport: this.transport });
      if (result.ok) {
        await this.store.db.meta.put({ key: 'lastSyncAt', value: result.finishedAt });
        this.set({ lastResult: result, consecutiveFailures: 0, needsLogin: false, revoked: false, online: true });
      } else {
        const failures = this.status.consecutiveFailures + 1;
        this.set({
          lastResult: result,
          consecutiveFailures: failures,
          needsLogin: result.error?.kind === 'auth',
          revoked: result.error?.kind === 'revoked',
          online: result.error?.kind === 'network' ? false : this.status.online,
        });
        // UC16 6.a: the volunteer is told when sync keeps failing.
        if (failures === SYNC_FAILURES_BEFORE_NOTICE) {
          await this.store.addNotice('sync.failed', { count: failures }, '/field/sync');
        }
      }
      return result;
    } finally {
      this.set({ running: false });
      await this.refreshCounts();
    }
  }

  private lastStaleNotice = 0;
  private async checkStale(): Promise<void> {
    const oldest = await this.store.oldestPendingAt();
    if (!oldest) return;
    const age = Date.now() - Date.parse(oldest);
    if (age > STALE_HOURS * 3_600_000 && Date.now() - this.lastStaleNotice > 12 * 3_600_000) {
      this.lastStaleNotice = Date.now();
      await this.store.addNotice('sync.stale', { hours: STALE_HOURS }, '/field/sync');
    }
  }
}

export const syncManager = new SyncManager(localStore, httpTransport);
