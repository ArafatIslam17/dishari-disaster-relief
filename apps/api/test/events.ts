import { generateShortCode, uuidv7, type SyncEventInput } from '@relief/shared';
import type { Session } from './helpers.js';

/** Builds field-app events the way the PWA does: one device sequence, client UUIDv7 ids. */
export class DeviceEvents {
  private seq = 0;
  constructor(
    readonly session: Session,
    private readonly now: () => Date,
  ) {}

  private base(entityId: string, baseVersion = 0) {
    return { eventId: uuidv7(), deviceSeq: ++this.seq, entityId, baseVersion, clientTime: this.now().toISOString() };
  }

  household(operationId: string, areaId: string, fields: { headName: string; mobile?: string | null; memberCount?: number; shortCode?: string }) {
    const id = uuidv7();
    const event: SyncEventInput = {
      ...this.base(id),
      type: 'household.create',
      payload: {
        operationId,
        areaId,
        shortCode: fields.shortCode ?? generateShortCode(this.session.devicePrefix),
        headName: fields.headName,
        mobile: fields.mobile ?? null,
        memberCount: fields.memberCount ?? 4,
        consentGiven: true,
        consentAt: this.now().toISOString(),
        gps: null,
      },
    };
    return { id, event };
  }

  update(householdId: string, baseVersion: number, changes: Record<string, unknown>): SyncEventInput {
    return { ...this.base(householdId, baseVersion), type: 'household.update', payload: { changes } } as SyncEventInput;
  }

  distribution(operationId: string, areaId: string, householdId: string | null, items: { itemId: string; quantity: number }[], at?: Date) {
    const id = uuidv7();
    const event: SyncEventInput = {
      ...this.base(id),
      type: 'distribution.create',
      payload: {
        operationId,
        areaId,
        householdId,
        isAnonymous: householdId === null,
        items,
        distributedAt: (at ?? this.now()).toISOString(),
        receivedElsewhereToday: false,
      },
    };
    return { id, event };
  }

  void(distributionId: string, reason = 'Entered by mistake'): SyncEventInput {
    return { ...this.base(distributionId), type: 'distribution.void', payload: { reason } };
  }
}
