// Regression tests for defects found by the UI audit (docs/ui-audit/FINDINGS.md).
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bn } from '../src/i18n/bn';
import { en } from '../src/i18n/en';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}

function has(messages: unknown, key: string): boolean {
  const lookup = (k: string) => k.split('.').reduce<unknown>((o, part) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[part] : undefined), messages);
  return typeof lookup(key) === 'string' || typeof lookup(`${key}_one`) === 'string' || typeof lookup(`${key}_other`) === 'string';
}

describe('translations', () => {
  // F45: `households.registered` was used but never defined, so the table header showed the raw key.
  it('every literal key used in the source exists in English and Bangla', () => {
    const used = new Set<string>();
    for (const f of files(join(root, 'src'))) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/\bt\(\s*'([a-zA-Z][\w]*(?:\.[\w]+)+)'/g)) used.add(m[1] as string);
    }
    expect(used.size).toBeGreaterThan(300);
    expect([...used].filter((k) => !has(en, k))).toEqual([]);
    expect([...used].filter((k) => !has(bn, k))).toEqual([]);
  });
});

describe('design tokens', () => {
  it('every text and control colour pair meets WCAG 2.2 AA in light and dark', () => {
    const r = spawnSync(process.execPath, [join(root, 'scripts', 'contrast.mjs')], { encoding: 'utf8' });
    expect(r.stdout).toContain('All pairs meet WCAG 2.2 AA');
    expect(r.status).toBe(0);
  });
});

describe('session start-up (F01)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  function memoryStorage() {
    const data = new Map<string, string>();
    return {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    };
  }

  it('makes no refresh request when this browser was never signed in', async () => {
    vi.stubGlobal('localStorage', memoryStorage());
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { refreshSession } = await import('../src/api/client');
    expect(await refreshSession()).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refreshes after a sign-in, and forgets the hint when the server says the session is over', async () => {
    const storage = memoryStorage();
    vi.stubGlobal('localStorage', storage);
    const fetchSpy = vi.fn().mockResolvedValue(new Response('{}', { status: 401 }));
    vi.stubGlobal('fetch', fetchSpy);
    const { refreshSession, setAccessToken } = await import('../src/api/client');
    setAccessToken('token');
    expect(storage.getItem('relief.signedIn')).toBe('1');
    expect(await refreshSession()).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(storage.getItem('relief.signedIn')).toBeNull();
  });
});
