/**
 * Serverless entry for the API on Vercel, called by api/index.ts at the repository root.
 *
 * Vercel runs a request handler, not a long-lived server, so this builds the same Fastify app as
 * server.ts once per instance and hands each request to it, without listen(). It leaves out what a
 * function cannot do: hourly timers, pg_dump backups and signal handling.
 *
 * Configuration comes from the Vercel project's environment variables. If they are incomplete, the
 * handler answers 503 and logs which variables are wrong (names only, never values), instead of
 * crashing the function.
 *
 * Background jobs (duplicate scoring, distribution flags, retention) live in the Postgres `job`
 * table. The worker runs them while an instance is warm; the cron routes below drain the queue on a
 * schedule so nothing waits for the next request.
 */
import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { buildApp } from './app.js';
import { createRuntime } from './bootstrap.js';
import { readConfig } from './config.js';
import { enqueue } from './services/jobs.js';

/** Production defaults for Vercel. A variable set on the project always wins. */
export function vercelEnv(input: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  // A variable saved empty in the dashboard counts as unset.
  const env = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== '' && v !== undefined));
  // Same-origin POSTs still send an Origin header, so the deployment's own URLs must be allowed.
  const own = [env.VERCEL_PROJECT_PRODUCTION_URL, env.VERCEL_BRANCH_URL, env.VERCEL_URL]
    .filter((h): h is string => Boolean(h))
    .map((h) => `https://${h}`);
  const origins = [env.CORS_ORIGINS, ...own].filter(Boolean).join(',');
  return {
    NODE_ENV: 'production',
    COOKIE_SECURE: 'true',
    TRUST_PROXY: 'true',
    BACKUP_DAILY: 'false',
    ...env,
    JWT_SECRET: env.JWT_SECRET ?? env.AUTH_JWT_SECRET,
    CORS_ORIGINS: origins || undefined,
  };
}

/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Without the secret the routes do not exist. */
function cronAllowed(request: FastifyRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.authorization ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function createApp(): Promise<FastifyInstance> {
  const config = readConfig(vercelEnv(process.env));
  // Slow poll: a sync kicks the queue at once; the poll is only a fallback while the instance is warm.
  const runtime = await createRuntime(config, { pollMs: 60_000 });
  const app = await buildApp(runtime.ctx);

  // Drains every queued job (duplicate scoring, distribution flags).
  app.get('/api/cron/jobs', async (request, reply) => {
    if (!cronAllowed(request)) return reply.status(404).send({ code: 'not_found' });
    return { ran: await runtime.worker.drain() };
  });

  // Daily duty: retention (NFR07), then drain. Backups need pg_dump, so on Vercel they are the database provider's job.
  app.get('/api/cron/daily', async (request, reply) => {
    if (!cronAllowed(request)) return reply.status(404).send({ code: 'not_found' });
    await enqueue(runtime.ctx.db, 'retention.run', {});
    return { ran: await runtime.worker.drain() };
  });

  await app.ready();
  runtime.worker.start();
  return app;
}

let appPromise: Promise<FastifyInstance> | null = null;

/** One app per warm instance. A failed start is not cached, so the next request tries again. */
export function getApp(): Promise<FastifyInstance> {
  appPromise ??= createApp().catch((err: unknown) => {
    appPromise = null;
    throw err;
  });
  return appPromise;
}

/** Node request handler: resolves once the response has been sent. */
export async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let app: FastifyInstance;
  try {
    app = await getApp();
  } catch (err) {
    console.error('API failed to start:', err instanceof Error ? err.message : String(err));
    res.statusCode = 503;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify({ code: 'service_unavailable' }));
    return;
  }
  await new Promise<void>((resolve) => {
    res.once('close', resolve);
    app.server.emit('request', req, res);
  });
}
