import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/** Repository root (two levels above apps/api/src or apps/api/dist). */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export function loadEnvFile(): void {
  const file = resolve(REPO_ROOT, '.env');
  if (existsSync(file)) loadDotenv({ path: file, quiet: true });
}

const base64Key = z
  .string()
  .refine((v) => !v.startsWith('CHANGE_ME'), 'still a placeholder - generate a value (see .env.example)')
  .refine((v) => Buffer.from(v, 'base64').length >= 32, 'must be at least 32 random bytes, base64-encoded');

const flag = (def: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(def)
    .transform((v) => v === 'true');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  API_HOST: z.string().default('127.0.0.1'),
  API_PORT: z.coerce.number().int().default(4000),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  COOKIE_SECURE: flag('false'),
  TRUST_PROXY: flag('false'),
  JWT_SECRET: base64Key,
  PHONE_PEPPER: base64Key,
  DATA_MASTER_KEY: base64Key,
  RETENTION_DAYS: z.coerce.number().int().min(1).default(90),
  SYNC_STALE_HOURS: z.coerce.number().int().min(1).default(24),
  BACKUP_DIR: z.string().default('./backups'),
  BACKUP_DAILY: flag('true'),
  BACKUP_KEEP_DAYS: z.coerce.number().int().min(1).default(14),
  /** Serve the built PWA from the API (single origin in production). */
  WEB_DIST: z.string().optional(),
  RATE_LIMIT_MAX: z.coerce.number().int().min(10).default(600),
});

export type AppConfig = z.infer<typeof envSchema>;

export function readConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration (.env):\n${lines.join('\n')}`);
  }
  const cfg = parsed.data;
  if (cfg.NODE_ENV === 'production' && !cfg.COOKIE_SECURE) {
    throw new Error('COOKIE_SECURE must be true in production (the API must be served over HTTPS).');
  }
  return cfg;
}
