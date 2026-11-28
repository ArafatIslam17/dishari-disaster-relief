import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, type BrowserContext, type Page } from '@playwright/test';

export const PASSWORD = 'Relief2026demo';
export const PIN = '2468';
export const ACCOUNTS = {
  admin: '01700000000',
  opadmin: '01711000001',
  coordA: '01722000001',
  volA1: '01733000001',
  volA2: '01733000002',
  coordB: '01844000001',
  volB1: '01855000001',
  observer: '01766000001',
} as const;

const shotsRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs', 'screenshots');

/** Full-page screenshot into docs/screenshots/<width>/<name>.png (evidence for the report). */
export async function shot(page: Page, name: string): Promise<void> {
  const width = page.viewportSize()?.width ?? 0;
  const dir = join(shotsRoot, String(width));
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
}

export async function english(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    try {
      if (!localStorage.getItem('relief.lang')) localStorage.setItem('relief.lang', 'en');
    } catch {
      /* about:blank has no storage */
    }
  });
}

export async function login(page: Page, mobile: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Mobile number').fill(mobile);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
}

/** Volunteer onboarding on a fresh phone: log in, set the PIN, pick the operation, download areas. */
export async function fieldReady(page: Page, mobile: string, areaLabels: string[]): Promise<void> {
  await login(page, mobile);
  await expect(page.getByRole('heading', { name: 'Set an app PIN' })).toBeVisible();
  await page.getByLabel('PIN', { exact: true }).fill(PIN);
  await page.getByLabel('Repeat PIN').fill(PIN);
  await page.getByRole('button', { name: 'Save PIN' }).click();
  await page.getByRole('button', { name: 'Feni Flash Flood 2024 (demo)' }).click();
  await page.getByRole('link', { name: 'Download areas' }).click();
  for (const label of areaLabels) await page.getByLabel(label).check();
  await page.getByRole('button', { name: 'Download selected' }).click();
  await expect(page.getByText('Area download complete.').first()).toBeVisible({ timeout: 60_000 });
}

/** Makes the service worker control the page so an offline reload still opens the app. */
export async function swControlled(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) {
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  }
}

export async function unlock(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Unlock' })).toBeVisible();
  await page.getByLabel('PIN').fill(PIN);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Field work' })).toBeVisible();
}

/** WCAG 2.2 AA automated checks: no serious or critical violations. */
/**
 * Waits for finite entrance/transition animations to finish (infinite live signals excluded), so
 * axe measures the resting UI rather than a tile caught mid-fade (styles/motion.css).
 */
export async function settleMotion(page: Page): Promise<void> {
  await page.waitForFunction(
    () => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity),
    undefined,
    { timeout: 5_000 },
  );
}

export async function expectAccessible(page: Page): Promise<void> {
  await settleMotion(page);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

export async function throttle400kbps(page: Page): Promise<() => Promise<void>> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  const bytesPerSecond = (400 * 1000) / 8;
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 300,
    downloadThroughput: bytesPerSecond,
    uploadThroughput: bytesPerSecond,
  });
  return async () => {
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  };
}
