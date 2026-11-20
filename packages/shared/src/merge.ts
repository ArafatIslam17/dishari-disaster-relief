/**
 * Field-level merge with base_version detection (FR16, NFR11).
 *
 * The server keeps, per household field, the version at which it last changed and
 * which device wrote it (with that device's local sequence number). An incoming
 * update was prepared against `baseVersion`:
 *   - value equal to the current value          -> no-op (already converged)
 *   - same device wrote the field after base     -> sequential local edit: apply,
 *                                                   unless it is older (out of order) -> stale no-op
 *   - field unchanged since base                 -> apply
 *   - another device changed it since base       -> conflict, current value kept
 * Different fields never interfere, so edits to different fields always merge.
 */
export interface FieldStamp {
  version: number;
  deviceId: string;
  deviceSeq: number;
}

export interface MergeState<V extends Record<string, unknown>> {
  version: number;
  values: V;
  stamps: Partial<Record<keyof V & string, FieldStamp>>;
}

export interface MergeConflict<V> {
  field: keyof V & string;
  incoming: unknown;
  current: unknown;
}

export interface MergeResult<V extends Record<string, unknown>> {
  state: MergeState<V>;
  applied: (keyof V & string)[];
  conflicts: MergeConflict<V>[];
  noops: (keyof V & string)[];
}

export function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a === 'object' && typeof b === 'object') return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
  return false;
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}

export function mergeUpdate<V extends Record<string, unknown>>(
  state: MergeState<V>,
  update: { baseVersion: number; deviceId: string; deviceSeq: number; changes: Partial<V> },
): MergeResult<V> {
  const nextVersion = state.version + 1;
  const values = { ...state.values };
  const stamps = { ...state.stamps };
  const applied: (keyof V & string)[] = [];
  const conflicts: MergeConflict<V>[] = [];
  const noops: (keyof V & string)[] = [];

  for (const field of Object.keys(update.changes) as (keyof V & string)[]) {
    const incoming = update.changes[field];
    if (incoming === undefined) continue;
    const current = state.values[field];
    const stamp = state.stamps[field];

    if (stamp && stamp.deviceId === update.deviceId && stamp.deviceSeq > update.deviceSeq) {
      noops.push(field); // an older local edit arriving after a newer one from the same device
      continue;
    }
    if (valuesEqual(current, incoming)) {
      noops.push(field);
      continue;
    }
    const changedSinceBase = stamp !== undefined && stamp.version > update.baseVersion;
    const sameDevice = stamp !== undefined && stamp.deviceId === update.deviceId;
    if (changedSinceBase && !sameDevice) {
      conflicts.push({ field, incoming, current });
      continue;
    }
    values[field] = incoming as V[typeof field];
    stamps[field] = { version: nextVersion, deviceId: update.deviceId, deviceSeq: update.deviceSeq };
    applied.push(field);
  }

  return {
    state: { version: applied.length > 0 ? nextVersion : state.version, values, stamps },
    applied,
    conflicts,
    noops,
  };
}
