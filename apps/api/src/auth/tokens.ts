import { hash, verify } from '@node-rs/argon2';
import { and, eq, isNull } from 'drizzle-orm';
import { SignJWT, jwtVerify } from 'jose';
import { uuidv7, type Role } from '@relief/shared';
import type { AppContext } from '../context.js';
import { refreshToken } from '../db/schema.js';
import { randomToken, sha256Hex } from '../lib/crypto.js';
import { unauthorized } from '../lib/errors.js';

/** argon2id, OWASP baseline parameters (DECISIONS §1). */
const ARGON = { memoryCost: 19_456, timeCost: 2, parallelism: 1, outputLen: 32 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/** A real argon2id hash of a random secret; verified against when the user does not exist (constant work). */
let dummyHash: Promise<string> | null = null;
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword(randomToken(16));
  return dummyHash;
}

export const ACCESS_TTL_SECONDS = 15 * 60;
export const REFRESH_TTL_DAYS = 30;
export const REFRESH_COOKIE = 'relief_rt';

export interface AccessClaims {
  sub: string;
  role: Role;
  org: string | null;
  dev: string | null;
}

function secret(ctx: AppContext): Uint8Array {
  return new Uint8Array(Buffer.from(ctx.config.JWT_SECRET, 'base64'));
}

export async function signAccessToken(ctx: AppContext, claims: AccessClaims): Promise<string> {
  const now = Math.floor(ctx.now().getTime() / 1000);
  return new SignJWT({ role: claims.role, org: claims.org, dev: claims.dev })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.sub)
    .setIssuedAt(now)
    .setExpirationTime(now + ACCESS_TTL_SECONDS)
    .setIssuer('relief-api')
    .setAudience('relief')
    .sign(secret(ctx));
}

export async function verifyAccessToken(ctx: AppContext, token: string): Promise<AccessClaims> {
  try {
    const { payload } = await jwtVerify(token, secret(ctx), {
      issuer: 'relief-api',
      audience: 'relief',
      algorithms: ['HS256'],
      currentDate: ctx.now(),
    });
    return {
      sub: String(payload.sub),
      role: payload.role as Role,
      org: (payload.org as string | null) ?? null,
      dev: (payload.dev as string | null) ?? null,
    };
  } catch {
    throw unauthorized('token_invalid');
  }
}

/** Creates a refresh token in a new or existing family. Returns the raw token (cookie value). */
export async function issueRefreshToken(
  ctx: AppContext,
  userId: string,
  deviceId: string | null,
  familyId: string = uuidv7(),
): Promise<{ token: string; id: string }> {
  const token = randomToken(32);
  const id = uuidv7();
  await ctx.db.insert(refreshToken).values({
    id,
    userId,
    deviceId,
    tokenHash: sha256Hex(token),
    familyId,
    expiresAt: new Date(ctx.now().getTime() + REFRESH_TTL_DAYS * 86_400_000),
  });
  return { token, id };
}

/**
 * Rotates a refresh token. Presenting an already-rotated token revokes the whole family
 * (stolen-token detection) and fails.
 */
export async function rotateRefreshToken(
  ctx: AppContext,
  presented: string,
): Promise<{ userId: string; deviceId: string | null; token: string }> {
  const now = ctx.now();
  const outcome = await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(refreshToken)
      .where(eq(refreshToken.tokenHash, sha256Hex(presented)))
      .for('update');
    if (!row) return { error: 'refresh_invalid' as const };
    if (row.revokedAt) {
      await tx
        .update(refreshToken)
        .set({ revokedAt: now })
        .where(and(eq(refreshToken.familyId, row.familyId), isNull(refreshToken.revokedAt)));
      return { error: 'refresh_reused' as const };
    }
    if (row.expiresAt <= now) return { error: 'refresh_expired' as const };
    const token = randomToken(32);
    const id = uuidv7();
    await tx.insert(refreshToken).values({
      id,
      userId: row.userId,
      deviceId: row.deviceId,
      tokenHash: sha256Hex(token),
      familyId: row.familyId,
      expiresAt: new Date(now.getTime() + REFRESH_TTL_DAYS * 86_400_000),
    });
    await tx.update(refreshToken).set({ revokedAt: now, replacedBy: id }).where(eq(refreshToken.id, row.id));
    return { userId: row.userId, deviceId: row.deviceId, token };
  });
  // Errors are returned (not thrown) inside the transaction so the family revocation commits.
  if ('error' in outcome) throw unauthorized(outcome.error);
  return outcome;
}

export async function revokeRefreshToken(ctx: AppContext, presented: string): Promise<void> {
  await ctx.db
    .update(refreshToken)
    .set({ revokedAt: ctx.now() })
    .where(and(eq(refreshToken.tokenHash, sha256Hex(presented)), isNull(refreshToken.revokedAt)));
}

export async function revokeAllForUser(ctx: AppContext, userId: string): Promise<void> {
  await ctx.db
    .update(refreshToken)
    .set({ revokedAt: ctx.now() })
    .where(and(eq(refreshToken.userId, userId), isNull(refreshToken.revokedAt)));
}

export async function revokeAllForDevice(ctx: AppContext, deviceId: string): Promise<void> {
  await ctx.db
    .update(refreshToken)
    .set({ revokedAt: ctx.now() })
    .where(and(eq(refreshToken.deviceId, deviceId), isNull(refreshToken.revokedAt)));
}
