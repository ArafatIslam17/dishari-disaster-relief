import Dexie, { type Table } from 'dexie';
import type { AreaDTO, DistributionDTO, ReliefItemDTO, UnservedReleaseDTO } from '@relief/shared';
import type { Sealed } from './crypto';

/** One household on the phone. Personal fields (name, mobile, GPS) exist only inside `sealed`. */
export interface HouseholdRow {
  id: string;
  operationId: string;
  areaId: string;
  shortCode: string;
  version: number;
  memberCount: number;
  organisationId: string;
  organisationName: string;
  mobileHmac: string | null;
  mobileMasked: string | null;
  linked: string[];
  redacted: boolean;
  createdAt: string;
  serverSeq: string;
  /** 1 while a local change waits to sync (shown in the UI). */
  pending: 0 | 1;
  sealed: Sealed;
}

export interface SealedHouseholdFields {
  headName: string | null;
  mobile: string | null;
  gps: { lat: number; lng: number } | null;
}

export type DistributionRow = Omit<DistributionDTO, 'serverSeq'> & { serverSeq: string; pending: 0 | 1 };

/** Outbox entry: the whole event is encrypted because household payloads carry personal data. */
export interface OutboxRow {
  eventId: string;
  deviceSeq: number;
  type: string;
  entityId: string;
  areaId: string;
  status: 'pending' | 'uploading' | 'failed';
  attempts: number;
  lastError: string | null;
  createdAt: string;
  sealed: Sealed;
}

export interface LocalArea extends AreaDTO {
  downloadedAt: string | null;
  cursor: string;
}

export interface NoticeRow {
  id: string;
  type: string;
  params: Record<string, string | number>;
  link: string | null;
  createdAt: string;
  read: 0 | 1;
}

export interface MetaRow {
  key: string;
  value: unknown;
}

export class ReliefDb extends Dexie {
  meta!: Table<MetaRow, string>;
  households!: Table<HouseholdRow, string>;
  distributions!: Table<DistributionRow, string>;
  outbox!: Table<OutboxRow, string>;
  areas!: Table<LocalArea, string>;
  items!: Table<ReliefItemDTO, string>;
  releases!: Table<UnservedReleaseDTO, string>;
  notices!: Table<NoticeRow, string>;

  constructor(name = 'relief-field') {
    super(name);
    this.version(1).stores({
      meta: 'key',
      households: 'id, shortCode, areaId, mobileHmac, operationId',
      distributions: 'id, householdId, areaId, operationId',
      outbox: 'eventId, deviceSeq, status, entityId',
      areas: 'id, operationId',
      items: 'id, operationId',
      releases: 'id, operationId',
      notices: 'id, createdAt',
    });
  }
}
