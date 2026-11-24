/**
 * Vercel Function for every /api/* request (vercel.json rewrites them here). The Fastify app lives
 * in apps/api; see apps/api/src/vercel.ts for how it runs without a long-lived server.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handle } from '../apps/api/src/vercel.js';

export default function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  return handle(req, res);
}
