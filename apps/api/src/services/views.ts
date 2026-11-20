import { sql, type SQL } from 'drizzle-orm';
import type { DistributionDTO, HouseholdDTO } from '@relief/shared';
import { query, type DbOrTx } from '../db/client.js';

interface HouseholdRow {
  id: string;
  operation_id: string;
  area_id: string;
  short_code: string;
  head_name: string | null;
  mobile_number: string | null;
  mobile_masked: string | null;
  mobile_hmac: string | null;
  member_count: number;
  gps_lat: string | null;
  gps_lng: string | null;
  version: number;
  organisation_id: string;
  organisation_name: string;
  linked: string[] | null;
  created_at: Date;
  redacted_at: Date | null;
  server_seq: string;
}

/** Selects households with the linked-household ids (confirmed duplicates) attached. */
export async function selectHouseholds(db: DbOrTx, where: SQL, tail: SQL = sql``): Promise<HouseholdRow[]> {
  return query<HouseholdRow>(
    db,
    sql`select h.household_id as id, h.operation_id, h.area_id, h.short_code, h.head_name, h.mobile_number,
               h.mobile_masked, h.mobile_hmac, h.member_count, h.gps_lat::text, h.gps_lng::text, h.version,
               h.organisation_id, o.name as organisation_name, h.created_at, h.redacted_at, h.server_seq::text,
               case when h.link_group_id is null then null else
                 (select array_agg(l.household_id) from household l
                   where l.link_group_id = h.link_group_id and l.household_id <> h.household_id) end as linked
          from household h
          join organisation o on o.organisation_id = h.organisation_id
         where ${where} ${tail}`,
  );
}

/**
 * Masks per organisation (NFR06, C5, C9): the raw number and GPS point go only to the
 * registering organisation; others get the masked number and the HMAC.
 */
export function toHouseholdDTO(row: HouseholdRow, viewerOrganisationId: string | null, viewerIsSystem = false): HouseholdDTO {
  const own = viewerIsSystem || (viewerOrganisationId !== null && row.organisation_id === viewerOrganisationId);
  return {
    id: row.id,
    operationId: row.operation_id,
    areaId: row.area_id,
    shortCode: row.short_code,
    headName: row.head_name,
    mobile: own ? row.mobile_number : null,
    mobileMasked: row.mobile_masked,
    mobileHmac: row.mobile_hmac,
    memberCount: row.member_count,
    gps: own && row.gps_lat && row.gps_lng ? { lat: Number(row.gps_lat), lng: Number(row.gps_lng) } : null,
    version: row.version,
    organisationId: row.organisation_id,
    organisationName: row.organisation_name,
    linkedHouseholdIds: row.linked ?? [],
    createdAt: new Date(row.created_at).toISOString(),
    redacted: row.redacted_at !== null,
    serverSeq: row.server_seq,
  };
}

interface DistributionRow {
  id: string;
  operation_id: string;
  area_id: string;
  household_id: string | null;
  is_anonymous: boolean;
  items: { itemId: string; quantity: number }[];
  distributed_at: Date;
  status: 'recorded' | 'voided';
  cancel_reason: string | null;
  organisation_id: string;
  organisation_name: string;
  recorded_by: string;
  received_elsewhere_today: boolean;
  server_seq: string;
}

export async function selectDistributions(db: DbOrTx, where: SQL, tail: SQL = sql``): Promise<DistributionDTO[]> {
  const rows = await query<DistributionRow>(
    db,
    sql`select d.distribution_id as id, d.operation_id, d.area_id, d.household_id, d.is_anonymous,
               coalesce((select json_agg(json_build_object('itemId', di.item_id, 'quantity', di.quantity))
                           from distribution_item di where di.distribution_id = d.distribution_id), '[]'::json) as items,
               d.distributed_at, d.status, d.cancel_reason, d.organisation_id, o.name as organisation_name,
               d.recorded_by, d.received_elsewhere_today, d.server_seq::text
          from distribution d
          join organisation o on o.organisation_id = d.organisation_id
         where ${where} ${tail}`,
  );
  return rows.map((r) => ({
    id: r.id,
    operationId: r.operation_id,
    areaId: r.area_id,
    householdId: r.household_id,
    isAnonymous: r.is_anonymous,
    items: r.items,
    distributedAt: new Date(r.distributed_at).toISOString(),
    status: r.status,
    cancelReason: r.cancel_reason,
    organisationId: r.organisation_id,
    organisationName: r.organisation_name,
    recordedBy: r.recorded_by,
    receivedElsewhereToday: r.received_elsewhere_today,
    serverSeq: r.server_seq,
  }));
}
