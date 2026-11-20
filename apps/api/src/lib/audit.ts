import { auditLog, notification } from '../db/schema.js';
import type { DbOrTx } from '../db/client.js';
import { uuidv7 } from '@relief/shared';
import type { NotificationType } from '@relief/shared';
import type { ServerCrypto } from './crypto.js';

export interface Actor {
  userId: string | null;
  organisationId: string | null;
  deviceId: string | null;
}

export const SYSTEM_ACTOR: Actor = { userId: null, organisationId: null, deviceId: null };

export interface AuditEntry {
  action: string;
  entityType?: string;
  entityId?: string | null;
  operationId?: string | null;
  /** Field names only; values are hashed (C8). */
  changes?: Record<string, unknown>;
  /** Non-personal context (statuses, counts, reasons typed by staff). */
  details?: Record<string, unknown>;
}

/** Appends one immutable audit entry (FR24). Never stores raw personal data. */
export async function audit(db: DbOrTx, crypto: ServerCrypto, actor: Actor, entry: AuditEntry): Promise<void> {
  const changedFields = entry.changes ? Object.keys(entry.changes) : null;
  const valueHashes = entry.changes
    ? Object.fromEntries(Object.entries(entry.changes).map(([k, v]) => [k, crypto.auditHash(v)]))
    : null;
  await db.insert(auditLog).values({
    userId: actor.userId,
    organisationId: actor.organisationId,
    deviceId: actor.deviceId,
    operationId: entry.operationId ?? null,
    action: entry.action,
    entityType: entry.entityType ?? null,
    entityId: entry.entityId ?? null,
    changedFields,
    valueHashes,
    details: entry.details ?? null,
  });
}

/** In-app notification (FR23). Params are ids and counts only, rendered client-side in bn/en. */
export async function notify(
  db: DbOrTx,
  userIds: Iterable<string>,
  type: NotificationType,
  params: Record<string, string | number>,
  link: string | null,
): Promise<void> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return;
  await db.insert(notification).values(
    unique.map((userId) => ({ id: uuidv7(), userId, type, params, link, isRead: false })),
  );
}
