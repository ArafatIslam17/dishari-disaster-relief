import type { AppConfig } from './config.js';
import type { Db, DbHandle } from './db/client.js';
import type { ServerCrypto } from './lib/crypto.js';

import type { Role } from '@relief/shared';

export interface AppContext {
  db: Db;
  handle: DbHandle;
  config: AppConfig;
  crypto: ServerCrypto;
  /** Injectable clock (tests move time forward for lockout, retention and the 24-hour rules). */
  now(): Date;
  /** Wakes the job worker after work is queued (duplicate scoring within 2 minutes, UC18 QR2). */
  kickJobs(): void;
}

export interface AuthInfo {
  userId: string;
  role: Role;
  organisationId: string | null;
  deviceId: string | null;
  fullName: string;
  mustChangePassword: boolean;
}

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext;
  }
  interface FastifyRequest {
    auth: AuthInfo | null;
  }
}
