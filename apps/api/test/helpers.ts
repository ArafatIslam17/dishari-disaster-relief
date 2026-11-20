import { randomBytes } from 'node:crypto';
import type { FastifyInstance, InjectOptions } from 'fastify';
import pg from 'pg';
import { uuidv7, type Role } from '@relief/shared';
import { buildApp } from '../src/app.js';
import { createRuntime, type Runtime } from '../src/bootstrap.js';
import { loadEnvFile, readConfig } from '../src/config.js';
import { hashPassword } from '../src/auth/tokens.js';
import { appUser, disasterType } from '../src/db/schema.js';
import { dropDatabase, ensureDatabase, runMigrations } from '../src/db/migrate.js';

/**
 * Test database: a fresh relief_test_<random> on the local PostgreSQL when credentials
 * work, otherwise in-memory PGlite (docs/BLOCKERS.md B1). Both run the real migrations.
 */
async function pickDatabase(): Promise<{ url: string; cleanup: () => Promise<void>; engine: string }> {
  loadEnvFile();
  const base = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  if (base && !base.startsWith('pglite:') && process.env.RELIEF_TEST_ENGINE !== 'pglite') {
    try {
      const probe = new pg.Client({ connectionString: base, connectionTimeoutMillis: 1500 });
      await probe.connect();
      await probe.end();
      const u = new URL(base);
      u.pathname = `/relief_test_${randomBytes(4).toString('hex')}`;
      const url = u.toString();
      await ensureDatabase(url);
      return { url, cleanup: () => dropDatabase(url), engine: 'postgres' };
    } catch {
      /* fall through to PGlite */
    }
  }
  return { url: 'pglite:memory', cleanup: async () => undefined, engine: 'pglite' };
}

export interface TestEnv {
  app: FastifyInstance;
  runtime: Runtime;
  clock: { t: number };
  engine: string;
  /** Moves the injectable clock forward. */
  advance(ms: number): void;
  close(): Promise<void>;
}

export async function createTestEnv(): Promise<TestEnv> {
  const db = await pickDatabase();
  const key = () => randomBytes(32).toString('base64');
  const config = readConfig({
    NODE_ENV: 'test',
    DATABASE_URL: db.url,
    JWT_SECRET: key(),
    PHONE_PEPPER: key(),
    DATA_MASTER_KEY: key(),
    CORS_ORIGINS: 'http://localhost:5173',
    BACKUP_DIR: './tmp/test-backups',
    BACKUP_DAILY: 'false',
  });
  const clock = { t: Date.parse('2026-08-24T06:00:00Z') };
  const runtime = await createRuntime(config, { now: () => new Date(clock.t) });
  await runMigrations(runtime.ctx.handle);
  const app = await buildApp(runtime.ctx);
  await app.ready();
  return {
    app,
    runtime,
    clock,
    engine: db.engine,
    advance: (ms) => {
      clock.t += ms;
    },
    close: async () => {
      await app.close();
      await runtime.close();
      await db.cleanup();
    },
  };
}

export interface Session {
  token: string;
  cookie: string;
  userId: string;
  deviceId: string;
  devicePrefix: string;
  organisationId: string | null;
}

export class Client {
  constructor(private readonly env: TestEnv) {}

  async call<T = Record<string, unknown>>(
    method: InjectOptions['method'],
    url: string,
    opts: { session?: Session; body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<{ status: number; body: T; headers: Record<string, unknown>; raw: string }> {
    const res = await this.env.app.inject({
      method,
      url,
      payload: opts.body as InjectOptions['payload'],
      headers: {
        ...(opts.session ? { authorization: `Bearer ${opts.session.token}` } : {}),
        ...opts.headers,
      },
    });
    let body: unknown = res.body;
    try {
      body = res.json();
    } catch {
      /* non-JSON (CSV, PDF) */
    }
    return { status: res.statusCode, body: body as T, headers: res.headers, raw: res.body };
  }

  async login(mobile: string, password: string, deviceId: string = uuidv7()): Promise<Session> {
    const res = await this.env.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { mobile, password, device: { id: deviceId, label: 'Test phone' } },
    });
    if (res.statusCode !== 200) throw new Error(`login ${mobile} failed: ${res.statusCode} ${res.body}`);
    const body = res.json() as {
      accessToken: string;
      user: { id: string; organisationId: string | null };
      device: { id: string; prefix: string };
    };
    const cookie = String(res.headers['set-cookie'] ?? '').split(';')[0] ?? '';
    return {
      token: body.accessToken,
      cookie,
      userId: body.user.id,
      deviceId: body.device.id,
      devicePrefix: body.device.prefix,
      organisationId: body.user.organisationId,
    };
  }
}

export const PASSWORD = 'Relief2026pass';

export async function insertUser(env: TestEnv, role: Role, mobile: string, organisationId: string | null = null, fullName = 'Test User') {
  const id = uuidv7();
  await env.runtime.ctx.db.insert(appUser).values({
    id,
    fullName,
    mobileNumber: mobile,
    passwordHash: await hashPassword(PASSWORD),
    role,
    status: 'active',
    organisationId,
  });
  return id;
}

export interface World {
  client: Client;
  sysadmin: Session;
  opAdmin: Session;
  operationId: string;
  disasterTypeId: string;
  areas: { id: string; upazila: string; unionName: string; ward: string }[];
  items: { id: string; itemName: string }[];
  orgA: { id: string; coordinator: Session; volunteer: Session; volunteer2: Session };
  orgB: { id: string; coordinator: Session; volunteer: Session };
  /** Moves the clock and logs every session in again on the same device (access tokens last 15 minutes). */
  advance(ms: number): Promise<void>;
}

function expectOk<T extends { status: number; body: unknown }>(r: T, ...ok: number[]): T {
  if (!ok.includes(r.status)) throw new Error(`unexpected ${r.status}: ${JSON.stringify(r.body)}`);
  return r;
}

/** A complete operation with two approved organisations, built through the public API. */
export async function buildWorld(env: TestEnv): Promise<World> {
  const client = new Client(env);
  await insertUser(env, 'SYSTEM_ADMINISTRATOR', '01700000000', null, 'Sys Admin');
  const sysadmin = await client.login('01700000000', PASSWORD);
  const disasterTypeId = uuidv7();
  await env.runtime.ctx.db.insert(disasterType).values({ id: disasterTypeId, nameEn: 'Flood', nameBn: 'বন্যা' });

  // Operation administrator registers and is approved by the System Administrator (C3).
  expectOk(
    await client.call('POST', '/api/auth/register', {
      body: { fullName: 'Op Admin', mobile: '01711111111', password: PASSWORD, kind: 'operation_admin' },
    }),
    201,
  );
  const members = await client.call<{ members: { id: string; mobile: string }[] }>('GET', '/api/members?status=pending', { session: sysadmin });
  const oaId = members.body.members.find((m) => m.mobile === '01711111111')?.id as string;
  expectOk(await client.call('POST', `/api/members/${oaId}/approve`, { session: sysadmin, body: {} }), 200);
  const opAdmin = await client.login('01711111111', PASSWORD);

  const op = expectOk(
    await client.call<{ id: string }>('POST', '/api/operations', {
      session: opAdmin,
      body: { name: 'Feni Flood 2026', disasterTypeId, startDate: '2026-08-21' },
    }),
    201,
  );
  const operationId = op.body.id;
  const csv = 'upazila,union,ward\nFeni Sadar,Dharmapur,1\nFeni Sadar,Dharmapur,2\nFeni Sadar,Lemua,1\nParshuram,Mirzanagar,3\n';
  expectOk(await client.call('POST', `/api/operations/${operationId}/areas/import`, { session: opAdmin, body: { csv } }), 200);
  for (const [itemName, unit] of [
    ['Rice', 'kg'],
    ['Lentils', 'kg'],
    ['Oral saline', 'packet'],
  ]) {
    expectOk(await client.call('POST', `/api/operations/${operationId}/items`, { session: opAdmin, body: { itemName, unit } }), 201);
  }
  const areas = (await client.call<{ areas: World['areas'] }>('GET', `/api/operations/${operationId}/areas`, { session: opAdmin })).body.areas;
  const items = (await client.call<{ items: World['items'] }>('GET', `/api/operations/${operationId}/items`, { session: opAdmin })).body.items;

  async function makeOrg(name: string, coordMobile: string, volunteerMobiles: string[]) {
    expectOk(
      await client.call('POST', '/api/auth/register-organisation', {
        body: {
          organisation: { name, orgType: 'volunteer_group', contactName: 'Contact Person', contactPhone: coordMobile },
          coordinator: { fullName: `${name} Lead`, mobile: coordMobile, password: PASSWORD },
        },
      }),
      201,
    );
    const orgs = await client.call<{ organisations: { id: string; name: string }[] }>('GET', '/api/admin/organisations?status=pending', { session: sysadmin });
    const orgId = orgs.body.organisations.find((o) => o.name === name)?.id as string;
    expectOk(await client.call('POST', `/api/admin/organisations/${orgId}/approve`, { session: sysadmin }), 200);
    const coordinator = await client.login(coordMobile, PASSWORD);
    expectOk(await client.call('POST', `/api/operations/${operationId}/join`, { session: coordinator }), 201);
    expectOk(await client.call('POST', `/api/operations/${operationId}/memberships/${orgId}/approve`, { session: opAdmin }), 200);
    const vols: Session[] = [];
    for (const m of volunteerMobiles) {
      expectOk(
        await client.call('POST', '/api/auth/register', {
          body: { fullName: `Volunteer ${m.slice(-3)}`, mobile: m, password: PASSWORD, kind: 'member', organisationId: orgId },
        }),
        201,
      );
      const pending = await client.call<{ members: { id: string; mobile: string }[] }>('GET', '/api/members?status=pending', { session: coordinator });
      const vid = pending.body.members.find((x) => x.mobile === m)?.id as string;
      expectOk(await client.call('POST', `/api/members/${vid}/approve`, { session: coordinator, body: { role: 'FIELD_VOLUNTEER' } }), 200);
      vols.push(await client.login(m, PASSWORD));
    }
    return { id: orgId, coordinator, vols };
  }

  const a = await makeOrg('Shapla Relief Team', '01722222222', ['01733333333', '01733333334']);
  const b = await makeOrg('Padma Youth Volunteers', '01844444444', ['01855555555']);
  const sessions: [Session, string][] = [
    [sysadmin, '01700000000'],
    [opAdmin, '01711111111'],
    [a.coordinator, '01722222222'],
    [a.vols[0] as Session, '01733333333'],
    [a.vols[1] as Session, '01733333334'],
    [b.coordinator, '01844444444'],
    [b.vols[0] as Session, '01855555555'],
  ];
  const advance = async (ms: number) => {
    env.advance(ms);
    for (const [s, mobile] of sessions) {
      const fresh = await client.login(mobile, PASSWORD, s.deviceId).catch(() => null);
      if (fresh) s.token = fresh.token;
    }
  };
  return {
    advance,
    client,
    sysadmin,
    opAdmin,
    operationId,
    disasterTypeId,
    areas,
    items,
    orgA: { id: a.id, coordinator: a.coordinator, volunteer: a.vols[0] as Session, volunteer2: a.vols[1] as Session },
    orgB: { id: b.id, coordinator: b.coordinator, volunteer: b.vols[0] as Session },
  };
}
