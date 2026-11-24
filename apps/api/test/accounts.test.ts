import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { uuidv7 } from '@relief/shared';
import { readConfig } from '../src/config.js';
import { query } from '../src/db/client.js';
import { PASSWORD, buildWorld, createTestEnv, insertUser, type Session, type TestEnv, type World } from './helpers.js';

let env: TestEnv;
let w: World;
beforeAll(async () => {
  env = await createTestEnv();
  w = await buildWorld(env);
});
afterAll(async () => env?.close());

describe('UC01 / FR01 register account', () => {
  it('rejects invalid input with field-level issues', async () => {
    const r = await w.client.call<{ code: string; issues: { path: string }[] }>('POST', '/api/auth/register', {
      body: { fullName: 'X', mobile: '123', password: 'short', kind: 'member' },
    });
    expect(r.status).toBe(400);
    expect(r.body.issues.map((i) => i.path)).toEqual(expect.arrayContaining(['fullName', 'mobile', 'password']));
  });
  it('rejects an already registered mobile number (UC01 2.a)', async () => {
    const r = await w.client.call('POST', '/api/auth/register', {
      body: { fullName: 'Someone', mobile: '01733333333', password: PASSWORD, kind: 'member', organisationId: w.orgA.id },
    });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('mobile_registered');
  });
  it('keeps the account pending and denies log-in with the status shown (UC02 3.a)', async () => {
    await w.client.call('POST', '/api/auth/register', {
      body: { fullName: 'Pending Person', mobile: '01766666666', password: PASSWORD, kind: 'member', organisationId: w.orgA.id },
    });
    const r = await w.client.call('POST', '/api/auth/login', {
      body: { mobile: '01766666666', password: PASSWORD, device: { id: uuidv7(), label: 'x' } },
    });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('account_pending');
  });
  it('stores passwords as argon2id hashes', async () => {
    const [row] = await query<{ password_hash: string }>(env.runtime.ctx.db, sql`select password_hash from app_user where mobile_number = '01766666666'`);
    expect(row?.password_hash.startsWith('$argon2id$')).toBe(true);
  });
});

describe('UC03/UC04 organisation registration and approval', () => {
  it('rejects a duplicate organisation name and shows the existing one (UC03 4.a)', async () => {
    const r = await w.client.call<{ code: string; details: { name: string } }>('POST', '/api/auth/register-organisation', {
      body: {
        organisation: { name: 'shapla  relief team', orgType: 'ngo', contactName: 'Some One', contactPhone: '01799999999' },
        coordinator: { fullName: 'Coord', mobile: '01799999999', password: PASSWORD },
      },
    });
    expect(r.status).toBe(409);
    expect(r.body.details.name).toBe('Shapla Relief Team');
  });
  it('rejection records a reason and rejects the coordinator account', async () => {
    await w.client.call('POST', '/api/auth/register-organisation', {
      body: {
        organisation: { name: 'Ghost Org', orgType: 'other', contactName: 'Ghost Person', contactPhone: '01798888888' },
        coordinator: { fullName: 'Ghost Lead', mobile: '01798888888', password: PASSWORD },
      },
    });
    const orgs = await w.client.call<{ organisations: { id: string; name: string }[] }>('GET', '/api/admin/organisations?status=pending', { session: w.sysadmin });
    const id = orgs.body.organisations.find((o) => o.name === 'Ghost Org')?.id;
    expect((await w.client.call('POST', `/api/admin/organisations/${id}/reject`, { session: w.sysadmin, body: { reason: 'Could not verify' } })).status).toBe(200);
    const login = await w.client.call('POST', '/api/auth/login', { body: { mobile: '01798888888', password: PASSWORD, device: { id: uuidv7(), label: 'x' } } });
    expect(login.body.code).toBe('account_rejected');
    expect((await w.client.call('POST', `/api/admin/organisations/${id}/approve`, { session: w.opAdmin })).status).toBe(403);
  });
});

describe('refresh token rotation', () => {
  it('rotates and detects reuse of an old token', async () => {
    const s = await w.client.login('01733333334', PASSWORD);
    const h = { cookie: s.cookie, 'x-relief-client': '1' };
    const first = await env.app.inject({ method: 'POST', url: '/api/auth/refresh', headers: h });
    expect(first.statusCode).toBe(200);
    const reuse = await env.app.inject({ method: 'POST', url: '/api/auth/refresh', headers: h });
    expect(reuse.statusCode).toBe(401);
    expect(reuse.json().code).toBe('refresh_reused');
    const newCookie = String(first.headers['set-cookie']).split(';')[0] as string;
    const afterReuse = await env.app.inject({ method: 'POST', url: '/api/auth/refresh', headers: { cookie: newCookie, 'x-relief-client': '1' } });
    expect(afterReuse.statusCode).toBe(401); // the whole family is revoked
  });
  it('requires the client header (CSRF guard)', async () => {
    const s = await w.client.login('01733333334', PASSWORD);
    const r = await env.app.inject({ method: 'POST', url: '/api/auth/refresh', headers: { cookie: s.cookie } });
    expect(r.statusCode).toBe(403);
  });
});

describe('UC05 / FR03 members and devices', () => {
  it('denies acting on a member of another organisation (UC05 3.d)', async () => {
    const r = await w.client.call('POST', `/api/members/${w.orgB.volunteer.userId}/deactivate`, { session: w.orgA.coordinator });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('other_organisation');
  });
  it('lists members with role, status and devices, own organisation only', async () => {
    const r = await w.client.call<{ members: { organisationId: string; devices: unknown[] }[] }>('GET', '/api/members', { session: w.orgA.coordinator });
    expect(r.body.members.every((m) => m.organisationId === w.orgA.id)).toBe(true);
    expect(r.body.members.some((m) => m.devices.length > 0)).toBe(true);
  });
  it('protects the last coordinator', async () => {
    const r = await w.client.call('POST', `/api/members/${w.orgB.coordinator.userId}/role`, { session: w.orgB.coordinator, body: { role: 'FIELD_VOLUNTEER' } });
    expect(r.body.code).toBe('last_coordinator');
  });
  it('deactivation blocks the member at once (UC05 3.a)', async () => {
    const id = await insertUser(env, 'FIELD_VOLUNTEER', '01714141414', w.orgA.id);
    const s = await w.client.login('01714141414', PASSWORD);
    expect((await w.client.call('POST', `/api/members/${id}/deactivate`, { session: w.orgA.coordinator })).status).toBe(200);
    expect((await w.client.call('GET', '/api/auth/me', { session: s })).status).toBe(401);
  });
  it('device revocation blocks sync and log-in from that device (UC05 3.b)', async () => {
    const s = await w.client.login('01733333334', PASSWORD);
    expect((await w.client.call('POST', `/api/devices/${s.deviceId}/revoke`, { session: w.orgA.coordinator })).status).toBe(200);
    const push = await w.client.call('POST', '/api/sync/push', { session: s, body: { sentAt: new Date().toISOString(), events: [{}] } });
    expect(push.status).toBe(403);
    expect(push.body.code).toBe('device_revoked');
    const relogin = await w.client.call('POST', '/api/auth/login', { body: { mobile: '01733333334', password: PASSWORD, device: { id: s.deviceId, label: 'x' } } });
    expect(relogin.body.code).toBe('device_revoked');
  });
});

describe('operations, areas, items and joining (UC06-UC09)', () => {
  it('imports valid CSV rows and lists rejected rows (UC07 2.a, 4.a)', async () => {
    const csv = 'upazila,union,ward\nFeni Sadar,Dharmapur,1\nSonagazi,Char Darbesh,4\n,,\nSonagazi,Char Darbesh,4\n';
    const r = await w.client.call<{ imported: number; rejected: { line: number; reason: string }[] }>('POST', `/api/operations/${w.operationId}/areas/import`, { session: w.opAdmin, body: { csv } });
    expect(r.body.imported).toBe(1);
    expect(r.body.rejected.map((x) => x.reason)).toEqual(['duplicate', expect.stringMatching(/^invalid/), 'duplicate']);
  });
  it('rejects a repeated area and item', async () => {
    expect((await w.client.call('POST', `/api/operations/${w.operationId}/areas`, { session: w.opAdmin, body: { upazila: 'feni sadar', unionName: 'DHARMAPUR', ward: '1' } })).status).toBe(409);
    expect((await w.client.call('POST', `/api/operations/${w.operationId}/items`, { session: w.opAdmin, body: { itemName: 'rice', unit: 'kg' } })).status).toBe(409);
  });
  it('blocks a second join request (UC08 3.a) and joining by a volunteer', async () => {
    const r = await w.client.call<{ code: string; details: { status: string } }>('POST', `/api/operations/${w.operationId}/join`, { session: w.orgA.coordinator });
    expect(r.status).toBe(409);
    expect(r.body.details.status).toBe('approved');
    expect((await w.client.call('POST', `/api/operations/${w.operationId}/join`, { session: w.orgA.volunteer })).status).toBe(403);
  });
  it('only the operation team may set up an operation', async () => {
    await insertUser(env, 'OPERATION_ADMINISTRATOR', '01715151515');
    const other = await w.client.login('01715151515', PASSWORD);
    const r = await w.client.call('POST', `/api/operations/${w.operationId}/items`, { session: other, body: { itemName: 'Blankets', unit: 'piece' } });
    expect(r.status).toBe(403);
  });
  it('observer invite: one-time link, area-level access only (C3)', async () => {
    const inv = await w.client.call<{ path: string }>('POST', `/api/operations/${w.operationId}/invites`, { session: w.opAdmin, body: { organisationName: 'Partner NGO' } });
    const token = inv.body.path.split('/').pop() as string;
    expect((await w.client.call('GET', `/api/invites/${token}`)).status).toBe(200);
    const accept = await w.client.call('POST', '/api/invites/accept', { body: { token, fullName: 'Observer One', mobile: '01716161616', password: PASSWORD } });
    expect(accept.status).toBe(201);
    expect((await w.client.call('POST', '/api/invites/accept', { body: { token, fullName: 'Observer Two', mobile: '01716161617', password: PASSWORD } })).status).toBe(410);
    const obs = await w.client.login('01716161616', PASSWORD);
    expect((await w.client.call('GET', `/api/operations/${w.operationId}/coverage`, { session: obs })).status).toBe(200);
    expect((await w.client.call('GET', `/api/operations/${w.operationId}/households`, { session: obs })).status).toBe(403);
  });
});

describe('NFR01 role-based access on every protected route', () => {
  const routes: [string, string][] = [
    ['GET', '/api/members'],
    ['GET', '/api/admin/organisations'],
    ['GET', '/api/admin/backups'],
    ['POST', '/api/sync/push'],
    ['POST', '/api/sync/pull'],
    ['GET', '/api/audit'],
    ['GET', '/api/notifications'],
    ['GET', '/api/operations'],
  ];
  it.each(routes)('%s %s refuses anonymous callers', async (method, url) => {
    const r = await w.client.call(method as 'GET', url, { body: method === 'POST' ? {} : undefined });
    expect(r.status).toBe(401);
  });
  it('enforces roles on the server', async () => {
    expect((await w.client.call('GET', '/api/admin/organisations', { session: w.orgA.coordinator })).status).toBe(403);
    expect((await w.client.call('GET', '/api/audit', { session: w.orgA.volunteer })).status).toBe(403);
    expect((await w.client.call('GET', '/api/members', { session: w.orgA.volunteer })).status).toBe(403);
    expect((await w.client.call('POST', '/api/operations', { session: w.orgA.coordinator, body: {} })).status).toBe(403);
    expect((await w.client.call('GET', `/api/audit?operationId=${w.operationId}`, { session: w.opAdmin })).status).toBe(200);
  });
  it('sets security headers and strict CORS', async () => {
    const ok = await env.app.inject({ method: 'GET', url: '/api/health', headers: { origin: 'http://localhost:5173' } });
    expect(ok.headers['content-security-policy']).toContain("default-src 'self'");
    expect(ok.headers['x-content-type-options']).toBe('nosniff');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const bad = await env.app.inject({ method: 'GET', url: '/api/health', headers: { origin: 'https://evil.example' } });
    expect(bad.statusCode).toBe(403);
  });
  it('accepts a Cloudflare quick tunnel origin outside production, and only that exact shape', async () => {
    const tunnel = 'https://calm-river-1234.trycloudflare.com';
    const ok = await env.app.inject({ method: 'POST', url: '/api/auth/login', headers: { origin: tunnel }, payload: {} });
    expect(ok.statusCode).toBe(400); // reached validation: CORS let it through
    expect(ok.headers['access-control-allow-origin']).toBe(tunnel);
    for (const origin of ['http://calm-river-1234.trycloudflare.com', 'https://trycloudflare.com.evil.example', 'https://eviltrycloudflare.com']) {
      expect((await env.app.inject({ method: 'GET', url: '/api/health', headers: { origin } })).statusCode).toBe(403);
    }
  });
  it('turns tunnel origins off by default in production', () => {
    const base = { DATABASE_URL: 'postgres://x/y', JWT_SECRET: 'a'.repeat(44), PHONE_PEPPER: 'b'.repeat(44), DATA_MASTER_KEY: 'c'.repeat(44) };
    expect(readConfig({ ...base, NODE_ENV: 'development' }).CORS_ALLOW_TUNNELS).toBe(true);
    expect(readConfig({ ...base, NODE_ENV: 'production', COOKIE_SECURE: 'true' }).CORS_ALLOW_TUNNELS).toBe(false);
    expect(readConfig({ ...base, NODE_ENV: 'production', COOKIE_SECURE: 'true', CORS_ALLOW_TUNNELS: 'true' }).CORS_ALLOW_TUNNELS).toBe(true);
  });
});

describe('UC06 4.a closing an operation', () => {
  it('stops accepting new records once closed', async () => {
    const op = await w.client.call<{ id: string }>('POST', '/api/operations', { session: w.opAdmin, body: { name: 'Short Op', disasterTypeId: w.disasterTypeId, startDate: '2026-08-22' } });
    expect((await w.client.call('POST', `/api/operations/${op.body.id}/close`, { session: w.opAdmin, body: {} })).status).toBe(400);
    expect((await w.client.call('POST', `/api/operations/${op.body.id}/close`, { session: w.opAdmin, body: { confirm: true } })).status).toBe(200);
    const r = await w.client.call('POST', `/api/operations/${op.body.id}/items`, { session: w.opAdmin, body: { itemName: 'Water', unit: 'litre' } });
    expect(r.body.code).toBe('operation_closed');
  });
});

// Runs last: it moves the injected clock forward, which expires earlier access tokens.
describe('UC02 / NFR02 / C2 lockout', () => {
  it('locks after 5 failures, auto-unlocks after 15 minutes', async () => {
    await insertUser(env, 'FIELD_VOLUNTEER', '01712121212', w.orgA.id);
    const attempt = (password: string) =>
      w.client.call('POST', '/api/auth/login', { body: { mobile: '01712121212', password, device: { id: uuidv7(), label: 'x' } } });
    for (let i = 0; i < 4; i++) expect((await attempt('wrong-pass-1')).status).toBe(401);
    expect((await attempt('wrong-pass-1')).status).toBe(423);
    expect((await attempt(PASSWORD)).status).toBe(423); // locked even with the right password
    env.advance(15 * 60_000 + 1000);
    expect((await attempt(PASSWORD)).status).toBe(200);
    const audit = await query<{ action: string }>(env.runtime.ctx.db, sql`select action from audit_log where action like 'account.%locked'`);
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['account.locked', 'account.auto_unlocked']));
  });
  it('a temporary password unlocks immediately and forces a password change (NFR03)', async () => {
    w.orgA.coordinator = await w.client.login('01722222222', PASSWORD); // earlier tokens expired with the clock
    const id = await insertUser(env, 'FIELD_VOLUNTEER', '01713131313', w.orgA.id);
    for (let i = 0; i < 5; i++) {
      await w.client.call('POST', '/api/auth/login', { body: { mobile: '01713131313', password: 'bad-pass-99', device: { id: uuidv7(), label: 'x' } } });
    }
    const temp = await w.client.call<{ temporaryPassword: string }>('POST', `/api/members/${id}/temporary-password`, { session: w.orgA.coordinator });
    expect(temp.status).toBe(200);
    const s = await w.client.login('01713131313', temp.body.temporaryPassword);
    expect((await w.client.call('GET', '/api/notifications', { session: s })).body.code).toBe('password_change_required');
    expect((await w.client.call('POST', '/api/auth/change-password', { session: s, body: { currentPassword: temp.body.temporaryPassword, newPassword: 'NewPass2026x' } })).status).toBe(200);
    expect((await w.client.call('GET', '/api/notifications', { session: s })).status).toBe(200);
  });
});

describe('Account approval hierarchy', () => {
  const register = (fullName: string, mobile: string, kind: 'member' | 'operation_admin', organisationId?: string) =>
    w.client.call('POST', '/api/auth/register', { body: { fullName, mobile, password: PASSWORD, kind, organisationId } });
  // Earlier tests advance the clock past the access-token lifetime, so log in afresh.
  const s = {} as Record<'sys' | 'oa' | 'coordA' | 'coordB', Session>;
  beforeAll(async () => {
    s.sys = await w.client.login('01700000000', PASSWORD);
    s.oa = await w.client.login('01711111111', PASSWORD);
    s.coordA = await w.client.login('01722222222', PASSWORD);
    s.coordB = await w.client.login('01844444444', PASSWORD);
  });
  type Pending = { members: { id: string; mobile: string; canApprove: boolean }[] };
  const queue = async (session: Session) =>
    (await w.client.call<Pending>('GET', '/api/members?status=pending', { session })).body.members;

  it('tells a pending account who approves it', async () => {
    await register('Waiting Volunteer', '01790000001', 'member', w.orgA.id);
    await register('Waiting Admin', '01790000002', 'operation_admin');
    const login = (mobile: string) =>
      w.client.call<{ code: string; details: { approver: string } }>('POST', '/api/auth/login', { body: { mobile, password: PASSWORD, device: { id: uuidv7(), label: 'x' } } });
    expect((await login('01790000001')).body.details.approver).toBe('coordinator');
    expect((await login('01790000002')).body.details.approver).toBe('sysadmin');
  });
  it('shows each approver only the registrations they may approve', async () => {
    const coord = (await queue(s.coordA)).map((m) => m.mobile);
    expect(coord).toContain('01790000001');
    expect(coord).not.toContain('01790000002');
    const sys = (await queue(s.sys)).map((m) => m.mobile);
    expect(sys).toContain('01790000002');
    expect(sys).not.toContain('01790000001');
    const oa = await queue(s.oa);
    expect(oa.map((m) => m.mobile)).toContain('01790000001');
    expect(oa.map((m) => m.mobile)).not.toContain('01790000002');
    expect(oa.every((m) => m.canApprove)).toBe(true);
    // The other organisation's coordinator never sees it.
    expect((await queue(s.coordB)).map((m) => m.mobile)).not.toContain('01790000001');
  });
  it('lets only the System Administrator approve an operation administrator', async () => {
    const id = (await queue(s.sys)).find((m) => m.mobile === '01790000002')!.id;
    expect((await w.client.call('POST', `/api/members/${id}/approve`, { session: s.oa, body: {} })).status).toBe(403);
    expect((await w.client.call('POST', `/api/members/${id}/approve`, { session: s.coordA, body: {} })).status).toBe(403);
    expect((await w.client.call('POST', `/api/members/${id}/approve`, { session: s.sys, body: {} })).status).toBe(200);
  });
  it('lets the coordinator or an operation administrator approve a volunteer, but not the System Administrator', async () => {
    const id = (await queue(s.coordA)).find((m) => m.mobile === '01790000001')!.id;
    expect((await w.client.call('POST', `/api/members/${id}/approve`, { session: s.sys, body: { role: 'FIELD_VOLUNTEER' } })).status).toBe(403);
    expect((await w.client.call('POST', `/api/members/${id}/approve`, { session: s.coordB, body: { role: 'FIELD_VOLUNTEER' } })).status).toBe(403);
    expect((await w.client.call('POST', `/api/members/${id}/approve`, { session: s.oa, body: { role: 'GROUP_COORDINATOR' } })).status).toBe(403);
    expect((await w.client.call('POST', `/api/members/${id}/approve`, { session: s.oa, body: { role: 'FIELD_VOLUNTEER' } })).status).toBe(200);
  });
});
