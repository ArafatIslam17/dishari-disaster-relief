import { z } from 'zod';
import { ORG_MEMBER_ROLES, SYNC_BATCH_MAX_EVENTS } from './constants.js';
import { normalisePhone } from './phone.js';
import { isValidShortCode, normaliseShortCode } from './shortcode.js';
import { HEAD_NAME_RE } from './similarity.js';

// ---------- primitives ----------
export const uuidSchema = z.string().uuid();
export const isoDateTime = z.string().datetime({ offset: true });
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

export const phoneSchema = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const n = normalisePhone(v);
    if (!n) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid_phone' });
      return z.NEVER;
    }
    return n;
  });

export const passwordSchema = z
  .string()
  .min(8, 'password_too_short')
  .max(128)
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'password_needs_letter_and_digit');

export const personNameSchema = z.string().trim().min(2).max(80);
export const headNameSchema = z.string().trim().min(2).max(80).regex(HEAD_NAME_RE, 'name_latin_only');
export const optionalBangla = z
  .string()
  .trim()
  .max(100)
  .optional()
  .transform((v) => (v ? v : undefined));

export const shortCodeSchema = z
  .string()
  .transform((v, ctx) => {
    const n = normaliseShortCode(v);
    if (!n || !isValidShortCode(n)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid_short_code' });
      return z.NEVER;
    }
    return n;
  });

export const gpsSchema = z.object({
  lat: z.number().min(20).max(27), // Bangladesh bounding box, with margin
  lng: z.number().min(87).max(93),
});
export type Gps = z.infer<typeof gpsSchema>;

// ---------- accounts & organisations ----------
export const ORG_TYPES = ['ngo', 'volunteer_group', 'community', 'other'] as const;

export const registerAccountSchema = z
  .object({
    fullName: personNameSchema,
    mobile: phoneSchema,
    password: passwordSchema,
    kind: z.enum(['member', 'operation_admin']),
    organisationId: uuidSchema.optional(),
  })
  .refine((v) => v.kind !== 'member' || !!v.organisationId, {
    path: ['organisationId'],
    message: 'organisation_required',
  });
export type RegisterAccountInput = z.input<typeof registerAccountSchema>;

export const registerOrganisationSchema = z.object({
  organisation: z.object({
    name: z.string().trim().min(2).max(100),
    nameBn: optionalBangla,
    orgType: z.enum(ORG_TYPES),
    contactName: personNameSchema,
    contactPhone: phoneSchema,
    contactEmail: z.string().trim().email().max(120).optional().or(z.literal('').transform(() => undefined)),
  }),
  coordinator: z.object({
    fullName: personNameSchema,
    mobile: phoneSchema,
    password: passwordSchema,
  }),
});
export type RegisterOrganisationInput = z.input<typeof registerOrganisationSchema>;

export const loginSchema = z.object({
  mobile: phoneSchema,
  password: z.string().min(1).max(128),
  device: z.object({ id: uuidSchema, label: z.string().trim().min(1).max(40) }),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});

export const approveMemberSchema = z.object({ role: z.enum(ORG_MEMBER_ROLES) });
export const assignRoleSchema = approveMemberSchema;
export const reasonSchema = z.object({ reason: z.string().trim().min(3).max(200) });

export const acceptInviteSchema = z.object({
  token: z.string().min(20).max(200),
  fullName: personNameSchema,
  mobile: phoneSchema,
  password: passwordSchema,
});

// ---------- operations ----------
export const disasterTypeSchema = z.object({
  nameEn: z.string().trim().min(2).max(40),
  nameBn: z.string().trim().min(1).max(60),
  active: z.boolean().default(true),
});

export const createOperationSchema = z.object({
  name: z.string().trim().min(3).max(100),
  disasterTypeId: uuidSchema,
  startDate: isoDate,
});

export const closeOperationSchema = z.object({ confirm: z.literal(true) });

export const areaSchema = z.object({
  upazila: z.string().trim().min(2).max(50),
  unionName: z.string().trim().min(2).max(50),
  ward: z.string().trim().min(1).max(20),
  upazilaBn: optionalBangla,
  unionBn: optionalBangla,
});
export type AreaInput = z.input<typeof areaSchema>;

export const areaCsvSchema = z.object({ csv: z.string().min(1).max(2_000_000) });

export const reliefItemSchema = z.object({
  itemName: z.string().trim().min(2).max(50),
  itemNameBn: optionalBangla,
  unit: z.string().trim().min(1).max(15),
});
export const reliefItemPatchSchema = z.object({
  itemNameBn: optionalBangla,
  unit: z.string().trim().min(1).max(15).optional(),
  active: z.boolean().optional(),
});

export const addOperationAdminSchema = z.object({ mobile: phoneSchema });

// ---------- sync protocol (FR13-FR15) ----------
const householdFieldsShape = {
  headName: headNameSchema,
  mobile: phoneSchema.nullable(),
  memberCount: z.number().int().min(1).max(50),
  areaId: uuidSchema,
  gps: gpsSchema.nullable(),
};

export const householdCreatePayload = z.object({
  operationId: uuidSchema,
  areaId: uuidSchema,
  shortCode: shortCodeSchema,
  headName: householdFieldsShape.headName,
  mobile: householdFieldsShape.mobile,
  memberCount: householdFieldsShape.memberCount,
  consentGiven: z.literal(true),
  consentAt: isoDateTime,
  gps: householdFieldsShape.gps,
});
export type HouseholdCreatePayload = z.infer<typeof householdCreatePayload>;

export const householdUpdatePayload = z.object({
  changes: z
    .object({
      headName: householdFieldsShape.headName.optional(),
      mobile: householdFieldsShape.mobile.optional(),
      memberCount: householdFieldsShape.memberCount.optional(),
      areaId: householdFieldsShape.areaId.optional(),
      gps: householdFieldsShape.gps.optional(),
    })
    .refine((c) => Object.values(c).some((v) => v !== undefined), 'no_changes'),
});
export type HouseholdUpdatePayload = z.infer<typeof householdUpdatePayload>;
export type HouseholdChanges = HouseholdUpdatePayload['changes'];

export const distributionItemSchema = z.object({
  itemId: uuidSchema,
  quantity: z.number().int().min(1, 'quantity_positive').max(10_000),
});

export const distributionCreatePayload = z
  .object({
    operationId: uuidSchema,
    areaId: uuidSchema,
    householdId: uuidSchema.nullable(),
    isAnonymous: z.boolean(),
    items: z.array(distributionItemSchema).min(1).max(30),
    distributedAt: isoDateTime,
    receivedElsewhereToday: z.boolean(),
  })
  .refine((d) => d.isAnonymous === (d.householdId === null), {
    message: 'anonymous_iff_no_household',
    path: ['householdId'],
  })
  .refine((d) => new Set(d.items.map((i) => i.itemId)).size === d.items.length, {
    message: 'duplicate_item',
    path: ['items'],
  });
export type DistributionCreatePayload = z.infer<typeof distributionCreatePayload>;

export const distributionVoidPayload = z.object({ reason: z.string().trim().min(3).max(100) });

const eventBase = {
  eventId: uuidSchema,
  /** Per-device monotonic counter, used to order a device's own edits (merge.ts). */
  deviceSeq: z.number().int().min(1),
  entityId: uuidSchema,
  baseVersion: z.number().int().min(0),
  clientTime: isoDateTime,
};

export const syncEventSchema = z.discriminatedUnion('type', [
  z.object({ ...eventBase, type: z.literal('household.create'), payload: householdCreatePayload }),
  z.object({ ...eventBase, type: z.literal('household.update'), payload: householdUpdatePayload }),
  z.object({ ...eventBase, type: z.literal('distribution.create'), payload: distributionCreatePayload }),
  z.object({ ...eventBase, type: z.literal('distribution.void'), payload: distributionVoidPayload }),
]);
export type SyncEvent = z.infer<typeof syncEventSchema>;
export type SyncEventInput = z.input<typeof syncEventSchema>;
export type SyncEventType = SyncEvent['type'];

export const pushRequestSchema = z.object({
  sentAt: isoDateTime,
  events: z.array(z.unknown()).min(1).max(SYNC_BATCH_MAX_EVENTS),
});

export const ACK_STATUSES = ['applied', 'duplicate', 'conflict', 'deferred', 'rejected'] as const;
export type AckStatus = (typeof ACK_STATUSES)[number];
export interface PushAck {
  eventId: string;
  status: AckStatus;
  reason?: string;
  /** Set when the server reissued a clashing short code (C6). */
  shortCode?: string;
}
export interface PushResponse {
  acks: PushAck[];
  serverTime: string;
  clockOffsetMs: number;
}

export const pullRequestSchema = z.object({
  operationId: uuidSchema,
  areas: z.array(z.object({ areaId: uuidSchema, cursor: z.string().regex(/^\d+$/) })).max(200),
  globalCursor: z.string().regex(/^\d+$/),
  limit: z.number().int().min(50).max(2000).default(1000),
});
export type PullRequest = z.input<typeof pullRequestSchema>;

export interface HouseholdDTO {
  id: string;
  operationId: string;
  areaId: string;
  shortCode: string;
  headName: string | null;
  /** Raw number: only for the registering organisation. */
  mobile: string | null;
  mobileMasked: string | null;
  mobileHmac: string | null;
  memberCount: number;
  gps: Gps | null;
  version: number;
  organisationId: string;
  organisationName: string;
  linkedHouseholdIds: string[];
  createdAt: string;
  redacted: boolean;
  serverSeq: string;
}

export interface DistributionDTO {
  id: string;
  operationId: string;
  areaId: string;
  householdId: string | null;
  isAnonymous: boolean;
  items: { itemId: string; quantity: number }[];
  distributedAt: string;
  status: 'recorded' | 'voided';
  cancelReason: string | null;
  organisationId: string;
  organisationName: string;
  recordedBy: string;
  receivedElsewhereToday: boolean;
  serverSeq: string;
}

export interface AreaDTO {
  id: string;
  operationId: string;
  upazila: string;
  unionName: string;
  ward: string;
  upazilaBn: string | null;
  unionBn: string | null;
}

export interface ReliefItemDTO {
  id: string;
  operationId: string;
  itemName: string;
  itemNameBn: string | null;
  unit: string;
  active: boolean;
}

export interface UnservedReleaseDTO {
  id: string;
  operationId: string;
  areaId: string;
  householdIds: string[];
  releasedAt: string;
  releasedByName: string;
}

export interface NotificationDTO {
  id: string;
  type: string;
  params: Record<string, string | number>;
  link: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface PullResponse {
  households: HouseholdDTO[];
  distributions: DistributionDTO[];
  areaCursors: Record<string, string>;
  globalCursor: string;
  items: ReliefItemDTO[];
  areas: AreaDTO[];
  releases: UnservedReleaseDTO[];
  operationStatus: 'active' | 'closed';
  hasMore: boolean;
  serverTime: string;
}

// ---------- review workflows ----------
export const resolveConflictSchema = z.object({ value: z.unknown() });
export const flagReviewSchema = z.object({
  decision: z.enum(['justified', 'repeat']),
  note: z.string().trim().min(3).max(300),
});

// ---------- reporting ----------
export const reportQuerySchema = z.object({
  operationId: uuidSchema,
  from: isoDate.optional(),
  to: isoDate.optional(),
  format: z.enum(['pdf', 'csv']),
});

export const auditQuerySchema = z.object({
  operationId: uuidSchema.optional(),
  userId: uuidSchema.optional(),
  organisationId: uuidSchema.optional(),
  deviceId: uuidSchema.optional(),
  action: z.string().max(60).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  before: z.string().regex(/^\d+$/).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
