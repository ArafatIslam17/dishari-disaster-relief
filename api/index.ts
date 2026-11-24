/**
 * Vercel Function for every /api/* request (vercel.json rewrites them here). The Fastify app lives
 * in apps/api; see apps/api/src/vercel.ts for how it runs without a long-lived server.
 *
 * It imports the bundle of apps/api/src/vercel.ts that `pnpm --filter @relief/api build:vercel`
 * writes (vercel.json's installCommand runs it), because Vercel does not compile the TypeScript
 * source of the workspace package @relief/shared.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { handle as Handle } from '../apps/api/src/vercel.js';
// @ts-expect-error -- untyped build output (apps/api/dist/vercel); typed by the import above.
import { handle as bundledHandle } from '../apps/api/dist/vercel/vercel.js';

const handle = bundledHandle as typeof Handle;

export default function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  return handle(req, res);
}
