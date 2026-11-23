import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import compress from '@fastify/compress';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { sql } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import type { AppContext } from './context.js';
import { AppError } from './lib/errors.js';
import { adminRoutes } from './routes/admin.js';
import { auditRoutes } from './routes/audit.js';
import { authRoutes } from './routes/auth.js';
import { coverageRoutes } from './routes/coverage.js';
import { donationRoutes } from './routes/donations.js';
import { publicRoutes } from './routes/public.js';
import { householdRoutes } from './routes/households.js';
import { memberRoutes } from './routes/members.js';
import { notificationRoutes } from './routes/notifications.js';
import { operationRoutes } from './routes/operations.js';
import { reportRoutes } from './routes/reports.js';
import { reviewRoutes } from './routes/reviews.js';
import { syncRoutes } from './routes/sync.js';

export async function buildApp(ctx: AppContext, options: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    trustProxy: ctx.config.TRUST_PROXY,
    bodyLimit: 1024 * 1024,
    logger: options.logger
      ? {
          level: 'info',
          // No PII in logs: only method, path (no query string) and status are logged.
          serializers: {
            req: (req) => ({ method: req.method, path: req.url.split('?')[0] }),
            res: (res) => ({ statusCode: res.statusCode }),
          },
          redact: ['req.headers.authorization', 'req.headers.cookie'],
        }
      : false,
  });

  app.decorate('ctx', ctx);
  app.decorateRequest('auth', null);

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        // Map tiles for the live operation map (OpenStreetMap, no API key).
        imgSrc: ["'self'", 'data:', 'blob:', 'https://tile.openstreetmap.org'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        workerSrc: ["'self'"],
        manifestSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: ctx.config.COOKIE_SECURE ? [] : null,
      },
    },
    hsts: ctx.config.COOKIE_SECURE ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    referrerPolicy: { policy: 'no-referrer' },
    crossOriginEmbedderPolicy: false,
  });
  await app.register(cors, {
    origin: (origin, cb) => {
      // Same-origin requests and non-browser clients send no Origin header.
      if (!origin || ctx.config.CORS_ORIGINS.includes(origin)) cb(null, true);
      else cb(new AppError(403, 'cors_origin_denied'), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Relief-Client'],
    maxAge: 600,
  });
  await app.register(cookie);
  await app.register(compress, { global: true, threshold: 1024 });
  await app.register(rateLimit, {
    global: true,
    max: ctx.config.RATE_LIMIT_MAX,
    timeWindow: '1 minute',
    allowList: ctx.config.NODE_ENV === 'test' ? () => true : undefined,
  });

  app.setErrorHandler((rawError, request, reply) => {
    const error = rawError as Error & { statusCode?: number; code?: string };
    if (error instanceof ZodError) {
      return reply.status(400).send({
        code: 'validation_failed',
        issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({ code: error.code, details: error.details });
    }
    const status = error.statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.status(status).send({ code: error.code ?? 'bad_request' });
    }
    request.log.error({ err: { message: error.message, stack: error.stack } }, 'unhandled error');
    return reply.status(500).send({ code: 'internal_error' });
  });

  app.get('/api/health', async () => {
    await ctx.db.execute(sql`select 1`);
    return { ok: true, time: ctx.now().toISOString() };
  });

  await app.register(authRoutes);
  await app.register(memberRoutes);
  await app.register(adminRoutes);
  await app.register(operationRoutes);
  await app.register(syncRoutes);
  await app.register(householdRoutes);
  await app.register(reviewRoutes);
  await app.register(notificationRoutes);
  await app.register(coverageRoutes);
  await app.register(auditRoutes);
  await app.register(reportRoutes);
  await app.register(donationRoutes);
  await app.register(publicRoutes);

  // Production: serve the built PWA from the same origin (strict CORS, one HTTPS endpoint).
  const webDist = ctx.config.WEB_DIST ? resolve(ctx.config.WEB_DIST) : null;
  if (webDist && existsSync(resolve(webDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false, index: ['index.html'] });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) return reply.status(404).send({ code: 'not_found' });
      return reply.sendFile('index.html');
    });
  } else {
    app.setNotFoundHandler((_request, reply) => reply.status(404).send({ code: 'not_found' }));
  }

  return app;
}
