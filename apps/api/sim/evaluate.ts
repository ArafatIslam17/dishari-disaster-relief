/**
 * `pnpm evaluate`: measured evidence for docs/EVALUATION.md. Starts the real API in-process on the
 * local PostgreSQL (a throwaway relief_eval_* database) or, without credentials, on PGlite.
 * EVAL_SCALE=quick shrinks the large experiments for a fast check.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { DUPLICATE_WEIGHTS, scoreHouseholds, uuidv7, type ScoringHousehold } from '@relief/shared';
import { buildApp } from '../src/app.js';
import { createRuntime } from '../src/bootstrap.js';
import { REPO_ROOT, loadEnvFile, readConfig } from '../src/config.js';
import { query } from '../src/db/client.js';
import { dropDatabase, ensureDatabase, runMigrations } from '../src/db/migrate.js';
import { area, operation, operationAdmin, operationKey, operationMembership, reliefItem } from '../src/db/schema.js';
import { areaKeys } from '../src/routes/operations.js';
import { seedDemo } from '../src/seed.js';
import { mistypePhone, mobile, personName, rng, varyName } from '../src/synthetic.js';
import { HttpTransport, SimDevice, percentile, simLogin, type SimSession } from './lib.js';

const QUICK = process.env.EVAL_SCALE === 'quick';
/** EVAL_ONLY=E1,E3 re-runs selected experiments and merges them into the existing results file. */
const ONLY = new Set((process.env.EVAL_ONLY ?? '').split(',').map((x) => x.trim()).filter(Boolean));
const run = (id: string) => ONLY.size === 0 || ONLY.has(id);
type Weights = Record<keyof typeof DUPLICATE_WEIGHTS, number>;
const PASSWORD = 'Relief2026demo';
const r = rng(4_940_000);
const log = (...a: unknown[]) => console.info('[eval]', ...a);
const ms = (t: number) => Math.round(performance.now() - t);

// ---------- engine ----------
async function pickDatabase() {
  loadEnvFile();
  const base = process.env.DATABASE_URL;
  if (base && !base.startsWith('pglite:')) {
    try {
      const c = new pg.Client({ connectionString: base, connectionTimeoutMillis: 1500 });
      await c.connect();
      const v = await c.query<{ v: string }>('show server_version');
      await c.end();
      const u = new URL(base);
      u.pathname = `/relief_eval_${randomBytes(3).toString('hex')}`;
      await ensureDatabase(u.toString());
      return { url: u.toString(), engine: `PostgreSQL ${v.rows[0]?.v}`, cleanup: () => dropDatabase(u.toString()) };
    } catch {
      /* fall through */
    }
  }
  return { url: 'pglite:memory', engine: 'PGlite (PostgreSQL in WebAssembly, single connection) - see docs/BLOCKERS.md B1', cleanup: async () => undefined };
}

const dbInfo = await pickDatabase();
const key = () => randomBytes(32).toString('base64');
const config = readConfig({
  NODE_ENV: 'test',
  DATABASE_URL: dbInfo.url,
  JWT_SECRET: key(),
  PHONE_PEPPER: key(),
  DATA_MASTER_KEY: key(),
  BACKUP_DAILY: 'false',
  RATE_LIMIT_MAX: '1000000',
});
const runtime = await createRuntime(config);
await runMigrations(runtime.ctx.handle);
const ctx = runtime.ctx;
await seedDemo(ctx, { demoPassword: PASSWORD });
await runtime.worker.drain();
const app = await buildApp(ctx);
await app.listen({ host: '127.0.0.1', port: 0 });
const addr = app.server.address();
const baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
log('engine', dbInfo.engine, baseUrl);

// ---------- evaluation operation ----------
const [orgA] = await query<{ id: string }>(ctx.db, sql`select organisation_id as id from organisation where name_key = 'shapla relief team'`);
const [orgB] = await query<{ id: string }>(ctx.db, sql`select organisation_id as id from organisation where name_key = 'padma youth volunteers'`);
const [opAdmin] = await query<{ id: string }>(ctx.db, sql`select user_id as id from app_user where mobile_number = '01711000001'`);
async function createOperation(name: string, unions: { upazila: string; union: string; wards: number }[]) {
  const id = uuidv7();
  await ctx.db.insert(operation).values({ id, name, disasterTypeId: (await query<{ id: string }>(ctx.db, sql`select id from disaster_type limit 1`))[0]!.id, startDate: '2026-08-21', status: 'active', createdBy: opAdmin!.id });
  await ctx.db.insert(operationAdmin).values({ operationId: id, userId: opAdmin!.id, addedBy: opAdmin!.id });
  await ctx.db.insert(operationKey).values({ operationId: id, wrappedKey: ctx.crypto.wrap(randomBytes(32)) });
  for (const o of [orgA!.id, orgB!.id]) await ctx.db.insert(operationMembership).values({ operationId: id, organisationId: o, status: 'approved', requestedBy: opAdmin!.id });
  const areas: { id: string; unionKey: string; ward: string }[] = [];
  for (const u of unions) {
    for (let w = 1; w <= u.wards; w++) {
      const input = { upazila: u.upazila, unionName: u.union, ward: String(w) };
      const aid = uuidv7();
      const keys = areaKeys(input);
      await ctx.db.insert(area).values({ id: aid, operationId: id, ...input, ...keys });
      areas.push({ id: aid, unionKey: keys.unionKey, ward: input.ward });
    }
  }
  const itemId = uuidv7();
  await ctx.db.insert(reliefItem).values({ id: itemId, operationId: id, itemName: 'Rice', nameKey: 'rice', unit: 'kg' });
  return { id, areas, itemId };
}
const login = (mobileNo: string): Promise<SimSession> => simLogin(baseUrl, mobileNo, PASSWORD);
const results: Record<string, unknown> = {};

// ---------- E1: duplicate detection accuracy (FR18, NFR17) and the 2-minute target ----------
if (run('E1')) {
  const op = await createOperation('Evaluation: duplicates', [
    { upazila: 'Parshuram', union: 'Mirzanagar', wards: 3 },
    { upazila: 'Fulgazi', union: 'Amzadhat', wards: 3 },
  ]);
  const devA = new SimDevice(await login('01733000001'), op.id, op.areas.map((a) => a.id));
  const devB = new SimDevice(await login('01855000001'), op.id, op.areas.map((a) => a.id));
  type Rec = ScoringHousehold & { id: string };
  const records: Rec[] = [];
  const add = (dev: SimDevice, a: (typeof op.areas)[number], f: { headName: string; mobile: string | null; memberCount: number }) => {
    const id = dev.household(a.id, f);
    records.push({ id, headName: f.headName, phone: f.mobile, memberCount: f.memberCount, unionKey: a.unionKey, wardKey: a.ward });
    return id;
  };
  const baseN = QUICK ? 150 : 500;
  const dupN = QUICK ? 45 : 150;
  const negN = QUICK ? 90 : 300;
  const bases: { id: string; f: { headName: string; mobile: string | null; memberCount: number }; a: (typeof op.areas)[number] }[] = [];
  for (let i = 0; i < baseN; i++) {
    const a = op.areas[Math.floor(r() * op.areas.length)]!;
    const f = { headName: personName(r), mobile: r() < 0.85 ? mobile(r) : null, memberCount: 1 + Math.floor(r() * 9) };
    bases.push({ id: add(devA, a, f), f, a });
  }
  const truth = new Set<string>();
  const pairKey = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);
  const shuffled = [...bases].sort(() => r() - 0.5).slice(0, dupN);
  for (const b of shuffled) {
    const sameUnion = op.areas.filter((x) => x.unionKey === b.a.unionKey);
    const a = r() < 0.75 ? b.a : sameUnion[Math.floor(r() * sameUnion.length)]!;
    const p = r();
    const phone = b.f.mobile === null ? (r() < 0.5 ? mobile(r) : null) : p < 0.65 ? b.f.mobile : p < 0.8 ? mistypePhone(r, b.f.mobile) : null;
    const members = r() < 0.7 ? b.f.memberCount : Math.max(1, b.f.memberCount + (r() < 0.5 ? -1 : 1));
    const id = add(devB, a, { headName: r() < 0.6 ? varyName(r, b.f.headName) : b.f.headName, mobile: phone, memberCount: members });
    truth.add(pairKey(b.id, id));
  }
  for (let i = 0; i < negN; i++) {
    const a = op.areas[Math.floor(r() * op.areas.length)]!;
    add(devB, a, { headName: personName(r), mobile: r() < 0.85 ? mobile(r) : null, memberCount: 1 + Math.floor(r() * 9) });
  }
  await devA.syncUntilDone(new HttpTransport(baseUrl, devA.session));
  await devB.syncUntilDone(new HttpTransport(baseUrl, devB.session));
  const t = performance.now();
  await runtime.worker.drain();
  const detectionMs = ms(t);
  const flagged = await query<{ a: string; b: string; label: string }>(ctx.db, sql`select household_a_id as a, household_b_id as b, label from duplicate_pair where operation_id = ${op.id}`);
  const tp = flagged.filter((f) => truth.has(pairKey(f.a, f.b))).length;
  const precision = flagged.length ? tp / flagged.length : 0;
  const recall = tp / truth.size;
  const byLabel = (label: string) => {
    const set = flagged.filter((f) => f.label === label);
    return { flagged: set.length, truePositives: set.filter((f) => truth.has(pairKey(f.a, f.b))).length };
  };

  // Offline tuning over every same-union pair with the same scorer (raw phones, as on the server).
  const byUnion = new Map<string, Rec[]>();
  for (const rec of records) byUnion.set(rec.unionKey, [...(byUnion.get(rec.unionKey) ?? []), rec]);
  const allPairs: { truth: boolean; score: (w: Weights) => number }[] = [];
  for (const list of byUnion.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const x = list[i]!;
        const y = list[j]!;
        allPairs.push({ truth: truth.has(pairKey(x.id, y.id)), score: (w) => scoreHouseholds(x, y, w).score });
      }
    }
  }
  const grid: { weights: Weights; threshold: number; precision: number; recall: number }[] = [];
  const weightSets: Weights[] = [
    DUPLICATE_WEIGHTS,
    { phone: 0.5, name: 0.3, location: 0.05, familySize: 0.15 },
    { phone: 0.35, name: 0.4, location: 0.1, familySize: 0.15 },
    { phone: 0.3, name: 0.4, location: 0.15, familySize: 0.15 },
    { phone: 0.45, name: 0.35, location: 0.1, familySize: 0.1 },
  ];
  for (const w of weightSets) {
    const scored = allPairs.map((p) => ({ truth: p.truth, s: p.score(w) }));
    for (const threshold of [0.6, 0.65, 0.7, 0.75, 0.8]) {
      const pos = scored.filter((p) => p.s >= threshold);
      const tpp = pos.filter((p) => p.truth).length;
      grid.push({ weights: w, threshold, precision: pos.length ? tpp / pos.length : 0, recall: tpp / truth.size });
    }
  }
  results.duplicates = {
    households: records.length,
    injectedDuplicates: truth.size,
    flaggedPairs: flagged.length,
    truePositives: tp,
    precision,
    recall,
    likely: byLabel('likely'),
    possible: byLabel('possible'),
    detectionMs,
    pairsScoredOffline: allPairs.length,
    grid,
  };
  log('E1 duplicates', { precision: precision.toFixed(3), recall: recall.toFixed(3), detectionMs });
}

// ---------- E2: exactly-once storage and convergence under failure injection (NFR09, NFR10) ----------
if (run('E2')) {
  const op = await createOperation('Evaluation: sync failures', [{ upazila: 'Feni Sadar', union: 'Kazirbag', wards: 4 }]);
  const mobiles = ['01733000001', '01733000001', '01733000001', '01733000002', '01733000002', '01733000002', '01855000001', '01855000001'];
  const devices = await Promise.all(mobiles.map(async (m) => new SimDevice(await login(m), op.id, op.areas.map((a) => a.id))));
  const perDevice = QUICK ? 30 : 60;
  for (const dev of devices) {
    const mine: string[] = [];
    for (let i = 0; i < perDevice; i++) {
      const a = op.areas[i % op.areas.length]!;
      const kind = mine.length === 0 ? 0 : i % 5;
      if (kind <= 1) mine.push(dev.household(a.id, { headName: personName(r), mobile: mobile(r), memberCount: 2 + (i % 6) }));
      else if (kind <= 3) dev.distribution(a.id, mine[i % mine.length]!, op.itemId, 1 + (i % 9));
      else dev.update(mine[i % mine.length]!, 1, { memberCount: 1 + (i % 7) });
    }
  }
  const generated = devices.flatMap((d) => d.generated.map((e) => e.eventId));
  const t = performance.now();
  const runs = await Promise.all(
    devices.map((dev, i) =>
      dev.syncUntilDone(new HttpTransport(baseUrl, dev.session, { dropBefore: 0.15, dropAfter: 0.15, repeat: 0.1, random: rng(100 + i) }), { maxEvents: 5 + Math.floor(r() * 25) }),
    ),
  );
  const wallMs = ms(t);
  const stored = await query<{ n: number; distinct_n: number; deferred: number }>(
    ctx.db,
    sql`select count(*)::int as n, count(distinct event_id)::int as distinct_n, count(*) filter (where status = 'deferred')::int as deferred
          from sync_event where event_id in (${sql.join(generated.map((g) => sql`${g}::uuid`), sql`, `)})`,
  );
  const duplicateAcks = devices.reduce((s, d) => s + d.acks.filter((a) => a.status === 'duplicate').length, 0);
  const failedAttempts = runs.reduce((s, run) => s + run.results.filter((x) => !x.ok).length, 0);
  // Convergence: a final sync on every device, then compare with a fresh device's view of the server.
  for (const dev of devices) await dev.syncUntilDone(new HttpTransport(baseUrl, dev.session));
  const fresh = new SimDevice(await login('01722000001'), op.id, op.areas.map((a) => a.id));
  await fresh.syncUntilDone(new HttpTransport(baseUrl, fresh.session));
  const truthPrint = fresh.fingerprint();
  const converged = devices.every((d) => d.fingerprint() === truthPrint);
  results.exactlyOnce = {
    devices: devices.length,
    eventsGenerated: generated.length,
    eventsStored: stored[0]?.n,
    distinctStored: stored[0]?.distinct_n,
    deferredLeft: stored[0]?.deferred,
    lostEvents: generated.length - (stored[0]?.distinct_n ?? 0),
    duplicateUploadsAbsorbed: duplicateAcks,
    failedSyncAttempts: failedAttempts,
    injection: { dropBeforeCommit: 0.15, lostResponseAfterCommit: 0.15, repeatedBatch: 0.1 },
    converged,
    wallMs,
  };
  log('E2 exactly-once', results.exactlyOnce);
}

// ---------- E3: conflict detection rate (FR16, NFR11, UC17 QR1) ----------
if (run('E3')) {
  const op = await createOperation('Evaluation: conflicts', [{ upazila: 'Feni Sadar', union: 'Sonapur', wards: 2 }]);
  const areaIds = op.areas.map((a) => a.id);
  const creator = new SimDevice(await login('01733000001'), op.id, areaIds);
  const n = QUICK ? 20 : 50;
  const same: string[] = [];
  const different: string[] = [];
  for (let i = 0; i < n; i++) same.push(creator.household(areaIds[i % 2]!, { headName: personName(r), mobile: mobile(r), memberCount: 4 }));
  for (let i = 0; i < n; i++) different.push(creator.household(areaIds[i % 2]!, { headName: personName(r), mobile: mobile(r), memberCount: 4 }));
  await creator.syncUntilDone(new HttpTransport(baseUrl, creator.session));
  const d1 = new SimDevice(await login('01733000002'), op.id, areaIds);
  const d2 = new SimDevice(await login('01855000001'), op.id, areaIds);
  for (const id of same) {
    d1.update(id, 1, { memberCount: 5 });
    d2.update(id, 1, { memberCount: 6 });
  }
  for (const id of different) {
    d1.update(id, 1, { headName: 'Corrected Name Mia' });
    d2.update(id, 1, { memberCount: 7 });
  }
  await d1.syncUntilDone(new HttpTransport(baseUrl, d1.session));
  await d2.syncUntilDone(new HttpTransport(baseUrl, d2.session));
  const conflicts = await query<{ household_id: string; field_name: string }>(ctx.db, sql`select household_id, field_name from conflict where operation_id = ${op.id}`);
  const detected = new Set(conflicts.filter((c) => same.includes(c.household_id)).map((c) => c.household_id)).size;
  const falseConflicts = conflicts.filter((c) => different.includes(c.household_id)).length;
  const merged = await query<{ n: number }>(
    ctx.db,
    sql`select count(*)::int as n from household where household_id in (${sql.join(different.map((d) => sql`${d}::uuid`), sql`, `)})
         and head_name = 'Corrected Name Mia' and member_count = 7`,
  );
  results.conflicts = { injectedSameField: n, detected, detectionRate: detected / n, differentFieldEdits: n, falseConflicts, autoMerged: merged[0]?.n };
  log('E3 conflicts', results.conflicts);
}

// ---------- E4: 500 records at ~400 kbps (NFR15) ----------
if (run('E4')) {
  const op = await createOperation('Evaluation: slow link', [{ upazila: 'Sonagazi', union: 'Char Darbesh', wards: 2 }]);
  const dev = new SimDevice(await login('01733000002'), op.id, op.areas.map((a) => a.id));
  const hs: string[] = [];
  for (let i = 0; i < 250; i++) hs.push(dev.household(op.areas[i % 2]!.id, { headName: personName(r), mobile: mobile(r), memberCount: 1 + (i % 9) }));
  for (let i = 0; i < 250; i++) dev.distribution(op.areas[i % 2]!.id, hs[i]!, op.itemId, 1 + (i % 20));
  const transport = new HttpTransport(baseUrl, dev.session, { bandwidthBps: 400_000, latencyMs: 300 });
  const t = performance.now();
  const run = await dev.syncUntilDone(transport);
  const total = ms(t);
  results.slowLink = {
    records: 500,
    bandwidthKbps: 400,
    latencyMs: 300,
    totalMs: total,
    requests: transport.requests,
    bytesUp: transport.bytesSent,
    bytesDown: transport.bytesReceived,
    batches: run.results.reduce((s, x) => s + x.batches, 0),
    withinTarget: total < 60_000,
  };
  log('E4 NFR15', results.slowLink);
}

// ---------- E5: 50 devices syncing at once (NFR16) ----------
if (run('E5')) {
  const op = await createOperation('Evaluation: concurrency', [{ upazila: 'Daganbhuiyan', union: 'Rajapur', wards: 5 }]);
  const devCount = QUICK ? 20 : 50;
  const mobiles = ['01733000001', '01733000002', '01855000001'];
  const devices: SimDevice[] = [];
  for (let i = 0; i < devCount; i++) devices.push(new SimDevice(await login(mobiles[i % 3]!), op.id, op.areas.map((a) => a.id)));
  for (const dev of devices) {
    for (let i = 0; i < 40; i++) {
      if (i % 2 === 0) dev.household(op.areas[i % 5]!.id, { headName: personName(r), mobile: mobile(r), memberCount: 3 });
      else dev.distribution(op.areas[i % 5]!.id, null, op.itemId, 2);
    }
  }
  const transports = devices.map((d) => new HttpTransport(baseUrl, d.session));
  const t = performance.now();
  const outcomes = await Promise.allSettled(devices.map((d, i) => d.syncUntilDone(transports[i]!)));
  const wall = ms(t);
  const lat = transports.flatMap((x) => x.latencies);
  results.concurrency = {
    devices: devCount,
    eventsPerDevice: 40,
    succeeded: outcomes.filter((o) => o.status === 'fulfilled').length,
    wallMs: wall,
    requestP50Ms: Math.round(percentile(lat, 50)),
    requestP95Ms: Math.round(percentile(lat, 95)),
  };
  log('E5 NFR16 concurrency', results.concurrency);
}

// ---------- E6: dashboard views with 20,000 households (NFR16, UC21 QR2, UC22 QR1) ----------
if (run('E6')) {
  const target = QUICK ? 4000 : 20_000;
  const unions = [
    { upazila: 'Feni Sadar', union: 'Fazilpur', wards: 9 },
    { upazila: 'Feni Sadar', union: 'Kalidah', wards: 9 },
    { upazila: 'Parshuram', union: 'Bokshmahmud', wards: 9 },
    { upazila: 'Fulgazi', union: 'Munshirhat', wards: 9 },
  ];
  const op = await createOperation('Evaluation: 20k households', unions);
  const loaders = await Promise.all(['01733000001', '01733000002', '01855000001', '01733000001'].map(async (m) => new SimDevice(await login(m), op.id, [])));
  const t = performance.now();
  let made = 0;
  while (made < target) {
    await Promise.all(
      loaders.map(async (dev) => {
        for (let i = 0; i < 250 && made < target; i++, made++) {
          const a = op.areas[made % op.areas.length]!;
          const h = dev.household(a.id, { headName: personName(r), mobile: r() < 0.85 ? mobile(r) : null, memberCount: 1 + (made % 9) });
          if (made % 2 === 0) dev.distribution(a.id, h, op.itemId, 5);
        }
        await dev.syncUntilDone(new HttpTransport(baseUrl, dev.session), { maxEvents: 100 });
      }),
    );
  }
  const loadMs = ms(t);
  const coord = await login('01722000001');
  const timed = async (path: string) => {
    const runs: number[] = [];
    let bytes = 0;
    for (let i = 0; i < 3; i++) {
      const s = performance.now();
      const res = await fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${coord.token}` } });
      bytes = (await res.arrayBuffer()).byteLength;
      if (!res.ok) throw new Error(`${path} ${res.status}`);
      runs.push(performance.now() - s);
    }
    return { medianMs: Math.round(percentile(runs, 50)), maxMs: Math.round(Math.max(...runs)), bytes };
  };
  const bigArea = op.areas[0]!.id;
  const opAdminSession = await login('01711000001');
  const timedAs = async (token: string, path: string) => {
    const s = performance.now();
    const res = await fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` } });
    await res.arrayBuffer();
    return { ms: Math.round(performance.now() - s), status: res.status };
  };
  const [count] = await query<{ n: number }>(ctx.db, sql`select count(*)::int as n from household where operation_id = ${op.id}`);
  results.dashboard = {
    households: count?.n,
    loadMs,
    coverage: await timed(`/api/operations/${op.id}/coverage`),
    unservedArea: await timed(`/api/operations/${op.id}/areas/${bigArea}/unserved`),
    householdSearch: await timed(`/api/operations/${op.id}/households?q=rahima`),
    duplicatesList: await timed(`/api/duplicates?operationId=${op.id}`),
    conflictsList: await timed(`/api/conflicts?operationId=${op.id}`),
    operationSummaryCsv: await timedAs(opAdminSession.token, `/api/reports/operation-summary?operationId=${op.id}&format=csv`),
    auditPage: await timedAs(opAdminSession.token, `/api/audit?operationId=${op.id}`),
  };
  log('E6 NFR16 dashboard', results.dashboard);
}

// ---------- report ----------
const meta = {
  generatedAt: new Date().toISOString(),
  engine: dbInfo.engine,
  scale: QUICK ? 'quick' : 'full',
  machine: `${cpus()[0]?.model ?? 'unknown CPU'} x${cpus().length}, ${(totalmem() / 2 ** 30).toFixed(1)} GiB RAM, Node ${process.version}`,
};
const resultsFile = resolve(REPO_ROOT, 'docs', 'evaluation-results.json');
const previous = ONLY.size > 0 && existsSync(resultsFile) ? (JSON.parse(readFileSync(resultsFile, 'utf8')) as Record<string, unknown>) : {};
writeFileSync(resultsFile, JSON.stringify({ ...previous, meta: { ...meta, rerun: [...ONLY] }, ...results }, null, 2));
log('wrote docs/evaluation-results.json');
await app.close();
await runtime.close();
await dbInfo.cleanup();
