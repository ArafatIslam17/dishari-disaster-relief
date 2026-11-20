import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { mergeUpdate, type MergeState } from '../src/merge.js';

type H = { headName: string; memberCount: number; mobile: string | null };
const initial = (): MergeState<H> => ({
  version: 1,
  values: { headName: 'Abdul Karim', memberCount: 5, mobile: null },
  stamps: {
    headName: { version: 1, deviceId: 'A', deviceSeq: 1 },
    memberCount: { version: 1, deviceId: 'A', deviceSeq: 1 },
    mobile: { version: 1, deviceId: 'A', deviceSeq: 1 },
  },
});

describe('field-level merge (FR16, NFR11)', () => {
  it('auto-merges edits to different fields', () => {
    const s1 = mergeUpdate(initial(), { baseVersion: 1, deviceId: 'B', deviceSeq: 1, changes: { headName: 'Abdul Karim Mia' } });
    const s2 = mergeUpdate(s1.state, { baseVersion: 1, deviceId: 'C', deviceSeq: 1, changes: { memberCount: 6 } });
    expect(s2.conflicts).toHaveLength(0);
    expect(s2.state.values).toEqual({ headName: 'Abdul Karim Mia', memberCount: 6, mobile: null });
    expect(s2.state.version).toBe(3);
  });

  it('records a conflict for the same field with different values and keeps the current value', () => {
    const s1 = mergeUpdate(initial(), { baseVersion: 1, deviceId: 'B', deviceSeq: 1, changes: { memberCount: 6 } });
    const s2 = mergeUpdate(s1.state, { baseVersion: 1, deviceId: 'C', deviceSeq: 1, changes: { memberCount: 7 } });
    expect(s2.conflicts).toEqual([{ field: 'memberCount', incoming: 7, current: 6 }]);
    expect(s2.state.values.memberCount).toBe(6);
    expect(s2.state.version).toBe(2);
  });

  it('treats identical concurrent values as converged, not a conflict', () => {
    const s1 = mergeUpdate(initial(), { baseVersion: 1, deviceId: 'B', deviceSeq: 1, changes: { memberCount: 6 } });
    const s2 = mergeUpdate(s1.state, { baseVersion: 1, deviceId: 'C', deviceSeq: 1, changes: { memberCount: 6 } });
    expect(s2.conflicts).toHaveLength(0);
    expect(s2.noops).toEqual(['memberCount']);
  });

  it('applies sequential edits from the same device without conflict', () => {
    const s1 = mergeUpdate(initial(), { baseVersion: 1, deviceId: 'B', deviceSeq: 1, changes: { memberCount: 6 } });
    const s2 = mergeUpdate(s1.state, { baseVersion: 1, deviceId: 'B', deviceSeq: 2, changes: { memberCount: 7 } });
    expect(s2.conflicts).toHaveLength(0);
    expect(s2.state.values.memberCount).toBe(7);
  });

  it('ignores an older edit from the same device that arrives late (out of order)', () => {
    const s1 = mergeUpdate(initial(), { baseVersion: 1, deviceId: 'B', deviceSeq: 2, changes: { memberCount: 7 } });
    const s2 = mergeUpdate(s1.state, { baseVersion: 1, deviceId: 'B', deviceSeq: 1, changes: { memberCount: 6 } });
    expect(s2.state.values.memberCount).toBe(7);
    expect(s2.conflicts).toHaveLength(0);
  });

  it('property: every same-field divergent concurrent edit is either applied or reported, never lost', () => {
    const fieldArb = fc.constantFrom<'headName' | 'memberCount'>('headName', 'memberCount');
    const editArb = fc.record({
      device: fc.constantFrom('B', 'C', 'D'),
      field: fieldArb,
      n: fc.integer({ min: 1, max: 9 }),
    });
    fc.assert(
      fc.property(fc.array(editArb, { minLength: 1, maxLength: 12 }), (edits) => {
        let state = initial();
        const seq: Record<string, number> = {};
        for (const e of edits) {
          seq[e.device] = (seq[e.device] ?? 0) + 1;
          const value = e.field === 'memberCount' ? e.n : `Name ${e.n}`;
          const before = state.values[e.field];
          const r = mergeUpdate(state, {
            baseVersion: 1, // all devices edited offline from the same base
            deviceId: e.device,
            deviceSeq: seq[e.device] as number,
            changes: { [e.field]: value },
          });
          const applied = r.applied.includes(e.field);
          const conflicted = r.conflicts.some((c) => c.field === e.field && c.incoming === value);
          const noop = r.noops.includes(e.field);
          // Exactly one outcome, and a no-op only when the value already matched.
          if ([applied, conflicted, noop].filter(Boolean).length !== 1) return false;
          if (noop && before !== value) return false;
          if (conflicted && r.state.values[e.field] !== before) return false; // never silently overwritten
          state = r.state;
        }
        return true;
      }),
      { numRuns: 1000 },
    );
  });
});
