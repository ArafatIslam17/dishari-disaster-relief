/**
 * PostgreSQL schema. Derived from the ERD (Fig 5.15) with the attributes the
 * use cases need (DECISIONS C20-C23). Comments name the ERD entity.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgSequence,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const created = () => ts('created_at').notNull().defaultNow();

/** Global change-feed sequence for device downloads (FR15). */
export const changeSeq = pgSequence('change_seq', { startWith: 1 });

// ORGANISATION
export const organisation = pgTable(
  'organisation',
  {
    id: uuid('organisation_id').primaryKey(),
    name: varchar('name', { length: 100 }).notNull(),
    nameKey: varchar('name_key', { length: 100 }).notNull(),
    nameBn: varchar('name_bn', { length: 100 }),
    orgType: varchar('org_type', { length: 30 }).notNull(),
    contactName: varchar('contact_name', { length: 80 }).notNull(),
    contactPhone: varchar('contact_phone', { length: 15 }).notNull(),
    contactEmail: varchar('contact_email', { length: 120 }),
    status: varchar('status', { length: 10 }).notNull().default('pending'),
    rejectionReason: varchar('rejection_reason', { length: 200 }),
    reviewedBy: uuid('reviewed_by'),
    reviewedAt: ts('reviewed_at'),
    createdAt: created(),
  },
  (t) => [
    uniqueIndex('organisation_name_key_uq').on(t.nameKey),
    check('organisation_status_ck', sql`${t.status} in ('pending','approved','rejected')`),
  ],
);

// USER
export const appUser = pgTable(
  'app_user',
  {
    id: uuid('user_id').primaryKey(),
    organisationId: uuid('organisation_id').references(() => organisation.id),
    fullName: varchar('full_name', { length: 80 }).notNull(),
    mobileNumber: varchar('mobile_number', { length: 15 }).notNull(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    role: varchar('role', { length: 25 }).notNull(),
    status: varchar('status', { length: 12 }).notNull().default('pending'),
    failedAttempts: integer('failed_attempts').notNull().default(0),
    lockedUntil: ts('locked_until'),
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    rejectionReason: varchar('rejection_reason', { length: 200 }),
    approvedBy: uuid('approved_by'),
    approvedAt: ts('approved_at'),
    createdAt: created(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('app_user_mobile_uq').on(t.mobileNumber),
    index('app_user_org_idx').on(t.organisationId, t.status),
    check(
      'app_user_role_ck',
      sql`${t.role} in ('FIELD_VOLUNTEER','GROUP_COORDINATOR','OPERATION_ADMINISTRATOR','SYSTEM_ADMINISTRATOR','OBSERVER')`,
    ),
    check('app_user_status_ck', sql`${t.status} in ('pending','active','locked','deactivated','rejected')`),
    check(
      'app_user_org_role_ck',
      sql`(${t.role} in ('FIELD_VOLUNTEER','GROUP_COORDINATOR')) = (${t.organisationId} is not null) or ${t.role} = 'OBSERVER'`,
    ),
  ],
);

// DEVICE
export const device = pgTable(
  'device',
  {
    id: uuid('device_id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => appUser.id),
    deviceLabel: varchar('device_label', { length: 40 }).notNull(),
    status: varchar('status', { length: 10 }).notNull().default('active'),
    shortCodePrefix: varchar('short_code_prefix', { length: 3 }).notNull(),
    recoveryKeyEnc: text('recovery_key_enc').notNull(),
    lastClockOffsetMs: integer('last_clock_offset_ms'),
    registeredAt: ts('registered_at').notNull().defaultNow(),
    lastSyncAt: ts('last_sync_at'),
    revokedAt: ts('revoked_at'),
    revokedBy: uuid('revoked_by'),
  },
  (t) => [
    uniqueIndex('device_prefix_uq').on(t.shortCodePrefix),
    index('device_user_idx').on(t.userId),
    check('device_status_ck', sql`${t.status} in ('active','revoked')`),
  ],
);

export const refreshToken = pgTable(
  'refresh_token',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => appUser.id),
    deviceId: uuid('device_id').references(() => device.id),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    familyId: uuid('family_id').notNull(),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    replacedBy: uuid('replaced_by'),
    createdAt: created(),
  },
  (t) => [uniqueIndex('refresh_token_hash_uq').on(t.tokenHash), index('refresh_token_family_idx').on(t.familyId)],
);

export const disasterType = pgTable(
  'disaster_type',
  {
    id: uuid('id').primaryKey(),
    nameEn: varchar('name_en', { length: 40 }).notNull(),
    nameBn: varchar('name_bn', { length: 60 }).notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: created(),
  },
  (t) => [uniqueIndex('disaster_type_name_uq').on(sql`lower(${t.nameEn})`)],
);

// OPERATION
export const operation = pgTable(
  'operation',
  {
    id: uuid('operation_id').primaryKey(),
    name: varchar('name', { length: 100 }).notNull(),
    disasterTypeId: uuid('disaster_type_id')
      .notNull()
      .references(() => disasterType.id),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }),
    status: varchar('status', { length: 10 }).notNull().default('active'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => appUser.id),
    closedBy: uuid('closed_by'),
    closedAt: ts('closed_at'),
    redactedAt: ts('redacted_at'),
    createdAt: created(),
  },
  (t) => [check('operation_status_ck', sql`${t.status} in ('active','closed')`)],
);

/** Per-operation data key (wrapped by DATA_MASTER_KEY); destroyed by retention (C8). */
export const operationKey = pgTable('operation_key', {
  operationId: uuid('operation_id')
    .primaryKey()
    .references(() => operation.id),
  wrappedKey: text('wrapped_key'),
  destroyedAt: ts('destroyed_at'),
  createdAt: created(),
});

export const operationAdmin = pgTable(
  'operation_admin',
  {
    operationId: uuid('operation_id')
      .notNull()
      .references(() => operation.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => appUser.id),
    addedBy: uuid('added_by').notNull(),
    addedAt: ts('added_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.operationId, t.userId] })],
);

export const operationObserver = pgTable(
  'operation_observer',
  {
    operationId: uuid('operation_id')
      .notNull()
      .references(() => operation.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => appUser.id),
    invitedBy: uuid('invited_by').notNull(),
    addedAt: ts('added_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.operationId, t.userId] })],
);

// OPERATION_MEMBERSHIP
export const operationMembership = pgTable(
  'operation_membership',
  {
    operationId: uuid('operation_id')
      .notNull()
      .references(() => operation.id),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisation.id),
    status: varchar('status', { length: 10 }).notNull().default('pending'),
    requestedBy: uuid('requested_by').notNull(),
    requestedAt: ts('requested_at').notNull().defaultNow(),
    reviewedBy: uuid('reviewed_by'),
    reviewedAt: ts('reviewed_at'),
    rejectionReason: varchar('rejection_reason', { length: 200 }),
  },
  (t) => [
    primaryKey({ columns: [t.operationId, t.organisationId] }),
    check('membership_status_ck', sql`${t.status} in ('pending','approved','rejected')`),
  ],
);

export const invite = pgTable(
  'invite',
  {
    id: uuid('id').primaryKey(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    operationId: uuid('operation_id')
      .notNull()
      .references(() => operation.id),
    organisationName: varchar('organisation_name', { length: 100 }),
    invitedBy: uuid('invited_by').notNull(),
    expiresAt: ts('expires_at').notNull(),
    usedAt: ts('used_at'),
    usedBy: uuid('used_by'),
    createdAt: created(),
  },
  (t) => [uniqueIndex('invite_token_uq').on(t.tokenHash)],
);

// AREA
export const area = pgTable(
  'area',
  {
    id: uuid('area_id').primaryKey(),
    operationId: uuid('operation_id')
      .notNull()
      .references(() => operation.id),
    upazila: varchar('upazila', { length: 50 }).notNull(),
    unionName: varchar('union_name', { length: 50 }).notNull(),
    ward: varchar('ward', { length: 20 }).notNull(),
    upazilaBn: varchar('upazila_bn', { length: 100 }),
    unionBn: varchar('union_bn', { length: 100 }),
    /** lower(upazila)|lower(union): duplicate detection runs within one union (FR18). */
    unionKey: varchar('union_key', { length: 110 }).notNull(),
    wardKey: varchar('ward_key', { length: 20 }).notNull(),
    createdAt: created(),
  },
  (t) => [
    uniqueIndex('area_unique_ward_uq').on(t.operationId, t.unionKey, t.wardKey),
    index('area_operation_idx').on(t.operationId, t.unionKey),
  ],
);

// RELIEF_ITEM
export const reliefItem = pgTable(
  'relief_item',
  {
    id: uuid('item_id').primaryKey(),
    operationId: uuid('operation_id')
      .notNull()
      .references(() => operation.id),
    itemName: varchar('item_name', { length: 50 }).notNull(),
    nameKey: varchar('name_key', { length: 50 }).notNull(),
    itemNameBn: varchar('item_name_bn', { length: 100 }),
    unit: varchar('unit', { length: 15 }).notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: created(),
  },
  (t) => [uniqueIndex('relief_item_name_uq').on(t.operationId, t.nameKey)],
);

// HOUSEHOLD
export const household = pgTable(
  'household',
  {
    id: uuid('household_id').primaryKey(),
    operationId: uuid('operation_id')
      .notNull()
      .references(() => operation.id),
    areaId: uuid('area_id')
      .notNull()
      .references(() => area.id),
    shortCode: varchar('short_code', { length: 10 }).notNull(),
    registeredBy: uuid('registered_by')
      .notNull()
      .references(() => appUser.id),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisation.id),
    deviceId: uuid('device_id').notNull(),
    headName: varchar('head_name', { length: 80 }),
    nameNorm: varchar('name_norm', { length: 80 }),
    mobileNumber: varchar('mobile_number', { length: 15 }),
    mobileHmac: varchar('mobile_hmac', { length: 64 }),
    mobileMasked: varchar('mobile_masked', { length: 15 }),
    memberCount: integer('member_count').notNull(),
    consentGiven: boolean('consent_given').notNull(),
    consentAt: ts('consent_at').notNull(),
    gpsLat: numeric('gps_lat', { precision: 8, scale: 5 }),
    gpsLng: numeric('gps_lng', { precision: 8, scale: 5 }),
    version: integer('version').notNull().default(1),
    fieldStamps: jsonb('field_stamps').notNull(),
    linkGroupId: uuid('link_group_id'),
    createdAt: ts('created_at').notNull(),
    serverReceivedAt: ts('server_received_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    serverSeq: bigint('server_seq', { mode: 'bigint' }).notNull().default(sql`nextval('change_seq')`),
    redactedAt: ts('redacted_at'),
  },
  (t) => [
    uniqueIndex('household_short_code_uq').on(t.shortCode),
    index('household_area_seq_idx').on(t.areaId, t.serverSeq),
    index('household_op_hmac_idx').on(t.operationId, t.mobileHmac),
    index('household_link_idx').on(t.linkGroupId),
    index('household_name_trgm_idx').using('gin', sql`${t.nameNorm} gin_trgm_ops`),
    check('household_consent_ck', sql`${t.consentGiven} = true`),
    check('household_members_ck', sql`${t.memberCount} between 1 and 50`),
  ],
);

// DISTRIBUTION
export const distribution = pgTable(
  'distribution',
  {
    id: uuid('distribution_id').primaryKey(),
    operationId: uuid('operation_id')
      .notNull()
      .references(() => operation.id),
    areaId: uuid('area_id')
      .notNull()
      .references(() => area.id),
    householdId: uuid('household_id').references(() => household.id),
    isAnonymous: boolean('is_anonymous').notNull(),
    recordedBy: uuid('recorded_by')
      .notNull()
      .references(() => appUser.id),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisation.id),
    deviceId: uuid('device_id').notNull(),
    /** Server-corrected time of the distribution (C7). */
    distributedAt: ts('distributed_at').notNull(),
    clientTime: ts('client_time').notNull(),
    serverReceivedAt: ts('server_received_at').notNull().defaultNow(),
    status: varchar('status', { length: 10 }).notNull().default('recorded'),
    cancelReason: varchar('cancel_reason', { length: 100 }),
    voidedAt: ts('voided_at'),
    voidedBy: uuid('voided_by'),
    receivedElsewhereToday: boolean('received_elsewhere_today').notNull().default(false),
    version: integer('version').notNull().default(1),
    serverSeq: bigint('server_seq', { mode: 'bigint' }).notNull().default(sql`nextval('change_seq')`),
  },
  (t) => [
    index('distribution_area_seq_idx').on(t.areaId, t.serverSeq),
    index('distribution_household_idx').on(t.householdId),
    index('distribution_op_time_idx').on(t.operationId, t.distributedAt),
    check('distribution_status_ck', sql`${t.status} in ('recorded','voided')`),
    check('distribution_anon_ck', sql`${t.isAnonymous} = (${t.householdId} is null)`),
  ],
);

// DISTRIBUTION_ITEM
export const distributionItem = pgTable(
  'distribution_item',
  {
    distributionId: uuid('distribution_id')
      .notNull()
      .references(() => distribution.id),
    itemId: uuid('item_id')
      .notNull()
      .references(() => reliefItem.id),
    quantity: integer('quantity').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.distributionId, t.itemId] }),
    check('distribution_item_qty_ck', sql`${t.quantity} > 0`),
  ],
);

// DISTRIBUTION_FLAG
export const distributionFlag = pgTable(
  'distribution_flag',
  {
    id: uuid('flag_id').primaryKey(),
    operationId: uuid('operation_id')
      .notNull()
      .references(() => operation.id),
    firstDistributionId: uuid('first_distribution_id')
      .notNull()
      .references(() => distribution.id),
    secondDistributionId: uuid('second_distribution_id')
      .notNull()
      .references(() => distribution.id),
    itemId: uuid('item_id')
      .notNull()
      .references(() => reliefItem.id),
    status: varchar('status', { length: 10 }).notNull().default('pending'),
    note: varchar('note', { length: 300 }),
    reviewedBy: uuid('reviewed_by'),
    reviewedAt: ts('reviewed_at'),
    createdAt: created(),
  },
  (t) => [
    uniqueIndex('distribution_flag_uq').on(t.firstDistributionId, t.secondDistributionId, t.itemId),
    index('distribution_flag_op_idx').on(t.operationId, t.status),
    check('distribution_flag_status_ck', sql`${t.status} in ('pending','justified','repeat')`),
  ],
);

// DUPLICATE_PAIR
export const duplicatePair = pgTable(
  'duplicate_pair',
  {
    id: uuid('pair_id').primaryKey(),
    operationId: uuid('operation_id')
      .notNull()
      .references(() => operation.id),
    householdAId: uuid('household_a_id')
      .notNull()
      .references(() => household.id),
    householdBId: uuid('household_b_id')
      .notNull()
      .references(() => household.id),
    score: numeric('score', { precision: 4, scale: 3 }).notNull(),
    label: varchar('label', { length: 10 }).notNull(),
    signals: jsonb('signals').notNull(),
    status: varchar('status', { length: 15 }).notNull().default('pending_review'),
    reviewedBy: uuid('reviewed_by'),
    reviewedAt: ts('reviewed_at'),
    createdAt: created(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('duplicate_pair_uq').on(t.householdAId, t.householdBId),
    index('duplicate_pair_op_idx').on(t.operationId, t.status, t.score),
    check('duplicate_pair_order_ck', sql`${t.householdAId} < ${t.householdBId}`),
    check('duplicate_pair_status_ck', sql`${t.status} in ('pending_review','linked','not_duplicate')`),
    check('duplicate_pair_label_ck', sql`${t.label} in ('likely','possible')`),
  ],
);

// SYNC_EVENT (append-only; see triggers migration)
export const syncEvent = pgTable(
  'sync_event',
  {
    eventId: uuid('event_id').primaryKey(),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => device.id),
    userId: uuid('user_id').notNull(),
    organisationId: uuid('organisation_id'),
    operationId: uuid('operation_id'),
    entityType: varchar('entity_type', { length: 20 }).notNull(),
    entityId: uuid('entity_id').notNull(),
    action: varchar('action', { length: 10 }).notNull(),
    deviceSeq: integer('device_seq').notNull(),
    baseVersion: integer('base_version').notNull(),
    /** Payload without personal data. */
    payload: jsonb('payload').notNull(),
    /** Personal data, AES-256-GCM under the operation key (C8). */
    piiEnc: text('pii_enc'),
    clientTime: ts('client_time').notNull(),
    receivedAt: ts('received_at').notNull().defaultNow(),
    clockOffsetMs: integer('clock_offset_ms').notNull(),
    status: varchar('status', { length: 10 }).notNull(),
    rejectReason: varchar('reject_reason', { length: 60 }),
    seq: bigint('seq', { mode: 'bigint' }).generatedAlwaysAsIdentity(),
  },
  (t) => [
    index('sync_event_entity_idx').on(t.entityId, t.status),
    index('sync_event_device_idx').on(t.deviceId, t.deviceSeq),
    check('sync_event_status_ck', sql`${t.status} in ('applied','conflict','deferred','rejected')`),
  ],
);

// CONFLICT
export const conflict = pgTable(
  'conflict',
  {
    id: uuid('conflict_id').primaryKey(),
    operationId: uuid('operation_id')
      .notNull()
      .references(() => operation.id),
    householdId: uuid('household_id')
      .notNull()
      .references(() => household.id),
    eventId: uuid('event_id')
      .notNull()
      .references(() => syncEvent.eventId),
    fieldName: varchar('field_name', { length: 40 }).notNull(),
    localValue: text('local_value'),
    serverValue: text('server_value'),
    localUserId: uuid('local_user_id').notNull(),
    localDeviceId: uuid('local_device_id').notNull(),
    localOrganisationId: uuid('local_organisation_id'),
    localTime: ts('local_time').notNull(),
    serverUserId: uuid('server_user_id'),
    serverDeviceId: uuid('server_device_id'),
    serverOrganisationId: uuid('server_organisation_id'),
    serverTime: ts('server_time'),
    resolvedValue: text('resolved_value'),
    status: varchar('status', { length: 10 }).notNull().default('open'),
    resolvedBy: uuid('resolved_by'),
    resolvedAt: ts('resolved_at'),
    createdAt: created(),
  },
  (t) => [
    index('conflict_op_status_idx').on(t.operationId, t.status),
    index('conflict_household_idx').on(t.householdId),
    check('conflict_status_ck', sql`${t.status} in ('open','resolved')`),
  ],
);

// AUDIT_LOG (append-only; no raw PII, C8)
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigint('audit_id', { mode: 'bigint' }).generatedAlwaysAsIdentity().primaryKey(),
    userId: uuid('user_id'),
    organisationId: uuid('organisation_id'),
    deviceId: uuid('device_id'),
    operationId: uuid('operation_id'),
    action: varchar('action', { length: 60 }).notNull(),
    entityType: varchar('entity_type', { length: 30 }),
    entityId: uuid('entity_id'),
    changedFields: text('changed_fields').array(),
    valueHashes: jsonb('value_hashes'),
    details: jsonb('details'),
    createdAt: created(),
  },
  (t) => [
    index('audit_created_idx').on(t.createdAt),
    index('audit_entity_idx').on(t.entityId),
    index('audit_user_idx').on(t.userId, t.createdAt),
    index('audit_op_idx').on(t.operationId, t.createdAt),
  ],
);

// NOTIFICATION
export const notification = pgTable(
  'notification',
  {
    id: uuid('notification_id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => appUser.id),
    type: varchar('type', { length: 30 }).notNull(),
    params: jsonb('params').notNull(),
    link: varchar('link', { length: 200 }),
    isRead: boolean('is_read').notNull().default(false),
    readAt: ts('read_at'),
    createdAt: created(),
  },
  (t) => [index('notification_user_idx').on(t.userId, t.isRead, t.createdAt)],
);

/** Unserved list sent to field devices (UC21 step 4). */
export const unservedRelease = pgTable(
  'unserved_release',
  {
    id: uuid('id').primaryKey(),
    operationId: uuid('operation_id')
      .notNull()
      .references(() => operation.id),
    areaId: uuid('area_id')
      .notNull()
      .references(() => area.id),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisation.id),
    releasedBy: uuid('released_by')
      .notNull()
      .references(() => appUser.id),
    householdIds: uuid('household_ids').array().notNull(),
    releasedAt: ts('released_at').notNull().defaultNow(),
    serverSeq: bigint('server_seq', { mode: 'bigint' }).notNull().default(sql`nextval('change_seq')`),
  },
  (t) => [index('unserved_release_org_idx').on(t.organisationId, t.serverSeq)],
);

/** Durable background jobs (duplicate scoring, flags, retention). */
export const job = pgTable(
  'job',
  {
    id: bigint('id', { mode: 'bigint' }).generatedAlwaysAsIdentity().primaryKey(),
    type: varchar('type', { length: 40 }).notNull(),
    payload: jsonb('payload').notNull(),
    status: varchar('status', { length: 10 }).notNull().default('queued'),
    runAfter: ts('run_after').notNull().defaultNow(),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: created(),
    finishedAt: ts('finished_at'),
  },
  (t) => [index('job_queue_idx').on(t.status, t.runAfter)],
);

export const backupRun = pgTable('backup_run', {
  id: uuid('id').primaryKey(),
  kind: varchar('kind', { length: 10 }).notNull(),
  status: varchar('status', { length: 10 }).notNull(),
  file: varchar('file', { length: 300 }),
  sizeBytes: bigint('size_bytes', { mode: 'number' }),
  detail: text('detail'),
  startedAt: ts('started_at').notNull().defaultNow(),
  finishedAt: ts('finished_at'),
});

/** Relief fund donations taken through the sandbox payment gateway (SSLCommerz / aamarPay style). */
export const donation = pgTable(
  'donation',
  {
    id: uuid('donation_id').primaryKey(),
    operationId: uuid('operation_id').references(() => operation.id),
    donorName: varchar('donor_name', { length: 80 }),
    donorPhone: varchar('donor_phone', { length: 15 }),
    donorEmail: varchar('donor_email', { length: 120 }),
    isAnonymous: boolean('is_anonymous').notNull().default(false),
    amountBdt: integer('amount_bdt').notNull(),
    paymentMethod: varchar('payment_method', { length: 12 }),
    transactionId: varchar('transaction_id', { length: 24 }).notNull(),
    status: varchar('status', { length: 10 }).notNull().default('pending'),
    createdAt: created(),
    completedAt: ts('completed_at'),
  },
  (t) => [
    uniqueIndex('donation_transaction_uq').on(t.transactionId),
    index('donation_status_idx').on(t.status, t.completedAt),
    check('donation_amount_ck', sql`${t.amountBdt} > 0 and ${t.amountBdt} <= 10000000`),
    check('donation_status_ck', sql`${t.status} in ('pending','completed','failed','cancelled')`),
    check('donation_method_ck', sql`${t.paymentMethod} is null or ${t.paymentMethod} in ('bkash','nagad','rocket','visa','mastercard')`),
  ],
);
