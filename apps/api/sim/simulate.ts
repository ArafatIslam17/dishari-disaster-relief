/**
 * `pnpm simulate [--devices 6] [--events 50] [--drop 0.2] [--kbps 400] [--url http://localhost:4000]`
 * Runs simulated field devices with injected network failures against a running API (or an in-process
 * PGlite server when --url is omitted) and prints the exactly-once and convergence checks.
 */
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { buildApp } from '../src/app.js';
import { createRuntime } from '../src/bootstrap.js';
import { readConfig } from '../src/config.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedDemo } from '../src/seed.js';
import { mobile, personName, rng } from '../src/synthetic.js';
import { HttpTransport, SimDevice, simLogin } from './lib.js';

const { values } = parseArgs({
  options: {
    devices: { type: 'string', default: '6' },
    events: { type: 'string', default: '50' },
    drop: { type: 'string', default: '0.2' },
    kbps: { type: 'string', default: '0' },
    url: { type: 'string' },
    password: { type: 'string', default: process.env.SEED_DEMO_PASSWORD || 'Relief2026demo' },
  },
});
const r = rng(Date.now() % 100_000);
let baseUrl = values.url ?? '';
let stop: () => Promise<void> = async () => undefined;
if (!baseUrl) {
  const key = () => randomBytes(32).toString('base64');
  const runtime = await createRuntime(readConfig({ NODE_ENV: 'test', DATABASE_URL: 'pglite:memory', JWT_SECRET: key(), PHONE_PEPPER: key(), DATA_MASTER_KEY: key(), BACKUP_DAILY: 'false', RATE_LIMIT_MAX: '1000000' }));
  await runMigrations(runtime.ctx.handle);
  await seedDemo(runtime.ctx, { demoPassword: values.password });
  const app = await buildApp(runtime.ctx);
  await app.listen({ host: '127.0.0.1', port: 0 });
  const addr = app.server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  stop = async () => {
    await app.close();
    await runtime.close();
  };
}

const volunteers = ['01733000001', '01733000002', '01855000001'];
const first = await simLogin(baseUrl, volunteers[0] as string, values.password);
const ops = (await (await fetch(`${baseUrl}/api/operations`, { headers: { authorization: `Bearer ${first.token}` } })).json()) as { operations: { id: string; name: string }[] };
const op = ops.operations.find((o) => o.name.includes('demo')) ?? ops.operations[0];
if (!op) throw new Error('no operation available to the demo volunteers');
const boot = (await (await fetch(`${baseUrl}/api/sync/bootstrap?operationId=${op.id}`, { headers: { authorization: `Bearer ${first.token}` } })).json()) as { areas: { id: string }[]; items: { id: string }[] };
const areaIds = boot.areas.slice(0, 6).map((a) => a.id);
const itemId = boot.items[0]?.id as string;

const deviceCount = Number(values.devices);
const perDevice = Number(values.events);
const drop = Number(values.drop);
const devices: SimDevice[] = [];
for (let i = 0; i < deviceCount; i++) devices.push(new SimDevice(await simLogin(baseUrl, volunteers[i % 3] as string, values.password), op.id, areaIds));
for (const dev of devices) {
  const mine: string[] = [];
  for (let i = 0; i < perDevice; i++) {
    const areaId = areaIds[i % areaIds.length] as string;
    if (mine.length === 0 || i % 3 === 0) mine.push(dev.household(areaId, { headName: personName(r), mobile: mobile(r), memberCount: 1 + (i % 8) }));
    else dev.distribution(areaId, mine[i % mine.length] as string, itemId, 1 + (i % 10));
  }
}
const started = performance.now();
const net = { dropBefore: drop / 2, dropAfter: drop / 2, repeat: drop / 2, bandwidthBps: Number(values.kbps) * 1000, latencyMs: Number(values.kbps) ? 300 : 0 };
const runs = await Promise.all(devices.map((d) => d.syncUntilDone(new HttpTransport(baseUrl, d.session, net), { maxEvents: 25 })));
for (const d of devices) await d.syncUntilDone(new HttpTransport(baseUrl, d.session));
const prints = new Set(devices.map((d) => d.fingerprint()));
console.info(
  JSON.stringify(
    {
      server: baseUrl,
      devices: deviceCount,
      eventsGenerated: devices.reduce((s, d) => s + d.generated.length, 0),
      eventsAcknowledged: devices.reduce((s, d) => s + d.acks.length, 0),
      failedAttempts: runs.reduce((s, run) => s + run.results.filter((x) => !x.ok).length, 0),
      allQueuesEmpty: devices.every((d) => d.outbox.size === 0),
      converged: prints.size === 1,
      seconds: Math.round((performance.now() - started) / 100) / 10,
    },
    null,
    2,
  ),
);
await stop();
