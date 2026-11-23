/**
 * Vercel entrypoint for the `api` service (see vercel.json). It serves the same Fastify app as
 * server.ts, minus what a serverless function cannot do: no hourly timers, no pg_dump backups and no
 * signal handling. Configuration comes from Vercel environment variables, not a .env file.
 *
 * Background jobs (duplicate scoring, distribution flags, retention) live in the Postgres `job`
 * table. The in-process worker runs them while an instance is warm; the cron routes below drain
 * the queue on a schedule so nothing waits for the next request.
 */
import { timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { buildApp } from './app.js';
import { createRuntime } from './bootstrap.js';
import { readConfig } from './config.js';
import { enqueue } from './services/jobs.js';

const config = readConfig();
// Slow poll: kicks after a sync run the queue at once; the poll is only a fallback while warm.
const runtime = await createRuntime(config, { pollMs: 60_000 });
const app = await buildApp(runtime.ctx);
runtime.worker.start();

/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Without the secret the routes do not exist. */
function cronAllowed(request: FastifyRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.authorization ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

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

await app.listen({ port: Number(process.env.PORT) || 3000 });
