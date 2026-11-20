/** Roles from the class diagram's UserRole enumeration (Fig 5.16). */
export const ROLES = [
  'FIELD_VOLUNTEER',
  'GROUP_COORDINATOR',
  'OPERATION_ADMINISTRATOR',
  'SYSTEM_ADMINISTRATOR',
  'OBSERVER',
] as const;
export type Role = (typeof ROLES)[number];

/** Roles that belong to an organisation and use the field app (A1). */
export const FIELD_ROLES: readonly Role[] = ['FIELD_VOLUNTEER', 'GROUP_COORDINATOR'];
/** Roles a coordinator may assign inside their own organisation (FR03). */
export const ORG_MEMBER_ROLES = ['FIELD_VOLUNTEER', 'GROUP_COORDINATOR'] as const;
export type OrgMemberRole = (typeof ORG_MEMBER_ROLES)[number];

/** User account status (Fig 5.10) plus `rejected` for refused registrations. */
export const ACCOUNT_STATUSES = ['pending', 'active', 'locked', 'deactivated', 'rejected'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/** Organisation approval status (Fig 5.11). */
export const APPROVAL_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

/** Operation lifecycle (Fig 5.12). */
export const OPERATION_STATUSES = ['active', 'closed'] as const;
export type OperationStatus = (typeof OPERATION_STATUSES)[number];

/** Conflict review status (Fig 5.13). */
export const CONFLICT_STATUSES = ['open', 'resolved'] as const;
export type ConflictStatus = (typeof CONFLICT_STATUSES)[number];

/** Duplicate pair review status (Fig 5.14). */
export const PAIR_STATUSES = ['pending_review', 'linked', 'not_duplicate'] as const;
export type PairStatus = (typeof PAIR_STATUSES)[number];
export const PAIR_LABELS = ['likely', 'possible'] as const;
export type PairLabel = (typeof PAIR_LABELS)[number];

/** Distribution flag review (UC19 step 5). */
export const FLAG_STATUSES = ['pending', 'justified', 'repeat'] as const;
export type FlagStatus = (typeof FLAG_STATUSES)[number];

/** Distribution record status (class diagram RecordStatus). */
export const RECORD_STATUSES = ['recorded', 'voided'] as const;
export type RecordStatus = (typeof RECORD_STATUSES)[number];

/** Device status (class diagram DeviceStatus). */
export const DEVICE_STATUSES = ['active', 'revoked'] as const;
export type DeviceStatus = (typeof DEVICE_STATUSES)[number];

/** Local outbox state (Fig 5.9). */
export const OUTBOX_STATUSES = ['pending', 'uploading', 'failed', 'acknowledged'] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

/** Coverage labels (DECISIONS C11). */
export const COVERAGE_LABELS = ['no_records', 'not_served', 'partly_served', 'fully_served'] as const;
export type CoverageLabel = (typeof COVERAGE_LABELS)[number];

/** Duplicate thresholds (DECISIONS C12). */
export const DUPLICATE_LIKELY_THRESHOLD = 0.8;
export const DUPLICATE_POSSIBLE_THRESHOLD = 0.65;

/** Security limits (NFR02, UC02). */
export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;
export const OFFLINE_SESSION_DAYS = 7;
export const MAX_PIN_ATTEMPTS = 5;
export const PIN_PBKDF2_ITERATIONS = 310_000;

/** Distribution rules (FR12, FR20). */
export const CANCEL_WINDOW_HOURS = 24;
export const DUPLICATE_DISTRIBUTION_WINDOW_HOURS = 24;
/** Skew above this is shown as a warning in the offline UI (DECISIONS C7). */
export const CLOCK_SKEW_WARN_MS = 5 * 60 * 1000;

/** Sync batching (FR14). */
export const SYNC_BATCH_MAX_EVENTS = 100;
export const SYNC_BATCH_MAX_BYTES = 64 * 1024;
export const SYNC_FAILURES_BEFORE_NOTICE = 3;

/** Observer small-cell suppression (A6). */
export const OBSERVER_MIN_CELL = 5;

/** Household fields that may be merged field by field (FR16). */
export const HOUSEHOLD_MERGE_FIELDS = ['headName', 'mobile', 'memberCount', 'areaId', 'gps'] as const;
export type HouseholdMergeField = (typeof HOUSEHOLD_MERGE_FIELDS)[number];
/** Fields that are personal data (NFR07 retention, C8). */
export const HOUSEHOLD_PII_FIELDS: readonly HouseholdMergeField[] = ['headName', 'mobile', 'gps'];

export const NOTIFICATION_TYPES = [
  'duplicate.new',
  'conflict.new',
  'flag.new',
  'sync.failed',
  'sync.stale',
  'member.pending',
  'organisation.pending',
  'operation_admin.pending',
  'join.requested',
  'join.decided',
  'shortcode.reissued',
  'event.rejected',
  'unserved.released',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
