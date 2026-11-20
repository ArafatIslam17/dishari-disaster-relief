import { and, eq, sql } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Role } from '@relief/shared';
import type { AppContext, AuthInfo } from '../context.js';
import { queryOne } from '../db/client.js';
import { operation, operationAdmin, operationMembership, operationObserver } from '../db/schema.js';
import { forbidden, notFound, unauthorized } from '../lib/errors.js';
import { verifyAccessToken } from './tokens.js';

/** Routes a user who must change a temporary password may still call. */
const PASSWORD_CHANGE_ALLOWED = new Set(['/api/auth/change-password', '/api/auth/me', '/api/auth/logout']);

/**
 * Authenticates every request against the database, not just the token: a deactivated
 * user or a revoked device loses access immediately (UC05 3.a/3.b, UC16 3.b).
 */
export async function authenticate(ctx: AppContext, request: FastifyRequest): Promise<AuthInfo> {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw unauthorized();
  const claims = await verifyAccessToken(ctx, header.slice(7));
  const row = await queryOne<{
    status: string;
    role: Role;
    organisation_id: string | null;
    full_name: string;
    must_change_password: boolean;
    device_status: string | null;
  }>(
    ctx.db,
    sql`select u.status, u.role, u.organisation_id, u.full_name, u.must_change_password,
               d.status as device_status
          from app_user u
          left join device d on d.device_id = ${claims.dev} and d.user_id = u.user_id
         where u.user_id = ${claims.sub}`,
  );
  if (!row) throw unauthorized();
  if (row.status !== 'active' && row.status !== 'locked') throw unauthorized(`account_${row.status}`);
  if (claims.dev && row.device_status !== 'active') throw forbidden('device_revoked');
  const auth: AuthInfo = {
    userId: claims.sub,
    role: row.role,
    organisationId: row.organisation_id,
    deviceId: claims.dev,
    fullName: row.full_name,
    mustChangePassword: row.must_change_password,
  };
  const path = request.url.split('?')[0] ?? '';
  if (auth.mustChangePassword && !PASSWORD_CHANGE_ALLOWED.has(path)) throw forbidden('password_change_required');
  return auth;
}

/** preHandler factory: authenticated, optionally restricted to roles. */
export function requireAuth(ctx: AppContext, ...roles: Role[]) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const auth = await authenticate(ctx, request);
    if (roles.length > 0 && !roles.includes(auth.role)) throw forbidden('role_not_allowed');
    request.auth = auth;
  };
}

export function authOf(request: FastifyRequest): AuthInfo {
  if (!request.auth) throw unauthorized();
  return request.auth;
}

export interface OperationAccess {
  operationId: string;
  status: 'active' | 'closed';
  /** How the caller relates to the operation. */
  relation: 'admin' | 'member' | 'observer' | 'system';
}

/**
 * Who may see an operation (NFR01): its administrator team, approved member organisations,
 * invited observers, and System Administrators.
 */
export async function operationAccess(ctx: AppContext, auth: AuthInfo, operationId: string): Promise<OperationAccess> {
  const [op] = await ctx.db
    .select({ id: operation.id, status: operation.status })
    .from(operation)
    .where(eq(operation.id, operationId));
  if (!op) throw notFound('operation_not_found');
  const status = op.status as 'active' | 'closed';
  if (auth.role === 'SYSTEM_ADMINISTRATOR') return { operationId, status, relation: 'system' };
  if (auth.role === 'OPERATION_ADMINISTRATOR') {
    const [a] = await ctx.db
      .select({ u: operationAdmin.userId })
      .from(operationAdmin)
      .where(and(eq(operationAdmin.operationId, operationId), eq(operationAdmin.userId, auth.userId)));
    if (a) return { operationId, status, relation: 'admin' };
    throw forbidden('not_operation_admin');
  }
  if (auth.role === 'OBSERVER') {
    const [o] = await ctx.db
      .select({ u: operationObserver.userId })
      .from(operationObserver)
      .where(and(eq(operationObserver.operationId, operationId), eq(operationObserver.userId, auth.userId)));
    if (o) return { operationId, status, relation: 'observer' };
    throw forbidden('not_invited');
  }
  if (!auth.organisationId) throw forbidden();
  const [m] = await ctx.db
    .select({ s: operationMembership.status })
    .from(operationMembership)
    .where(
      and(
        eq(operationMembership.operationId, operationId),
        eq(operationMembership.organisationId, auth.organisationId),
        eq(operationMembership.status, 'approved'),
      ),
    );
  if (m) return { operationId, status, relation: 'member' };
  throw forbidden('organisation_not_member');
}

export async function requireOperationAdmin(ctx: AppContext, auth: AuthInfo, operationId: string): Promise<OperationAccess> {
  if (auth.role !== 'OPERATION_ADMINISTRATOR') throw forbidden('role_not_allowed');
  return operationAccess(ctx, auth, operationId);
}

export function assertActive(access: OperationAccess): void {
  if (access.status !== 'active') throw forbidden('operation_closed');
}
