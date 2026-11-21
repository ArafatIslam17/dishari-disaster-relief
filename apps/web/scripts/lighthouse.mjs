// Lighthouse scores for the production build, plus the PWA checks Lighthouse 12 no longer runs.
//   node apps/web/scripts/lighthouse.mjs [--base http://127.0.0.1:4173] [--out docs/ui-audit/lighthouse.json]
// Serve the build first: `node scripts/workspace.mjs api e2e:server` (seeded PGlite + PWA on 4173).
// A persistent Chromium profile is logged in through Playwright, so Lighthouse audits real
// signed-in pages with storage kept between runs (disableStorageReset).
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import lighthouse from 'lighthouse';
import desktopConfig from 'lighthouse/core/config/desktop-config.js';

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : def;
};
const BASE = arg('base', 'http://127.0.0.1:4173');
const OUT = resolve(arg('out', 'docs/ui-audit/lighthouse.json'));
const PORT = 9444;
const PASSWORD = 'Relief2026demo';

const runs = [
  { name: 'login (public)', path: '/login', form: 'mobile', account: null },
  { name: 'field cold start (opens on PIN unlock)', path: '/field', form: 'mobile', account: 'field' },
  { name: 'dashboard coverage', path: '/app/coverage', form: 'desktop', account: '01722000001' },
  { name: 'dashboard duplicates', path: '/app/duplicates', form: 'desktop', account: '01722000001' },
  { name: 'dashboard operation setup', path: '/app/operations', form: 'desktop', account: '01711000001' },
];

async function login(page, mobile) {
  await page.goto(`${BASE}/login`);
  await page.evaluate(() => localStorage.setItem('relief.lang', 'en'));
  await page.reload();
  await page.locator('input[type=tel]').first().fill(mobile);
  await page.locator('input[type=password]').first().fill(PASSWORD);
  await page.locator('form button[type=submit]').first().click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });
}

async function fieldSetup(page) {
  await login(page, '01855000001');
  if (page.url().includes('/set-pin')) {
    const pins = page.locator('input[type=password]');
    await pins.nth(0).fill('2468');
    await pins.nth(1).fill('2468');
    await page.locator('form button[type=submit]').first().click();
    await page.waitForURL((u) => u.pathname === '/field');
  }
}

const results = { base: BASE, measuredAt: new Date().toISOString(), lighthouse: [], pwa: {} };
const profile = mkdtempSync(join(tmpdir(), 'relief-lh-'));
let context = null;
let current = null;

for (const run of runs) {
  if (current !== run.account) {
    await context?.close();
    context = await chromium.launchPersistentContext(profile + (run.account ?? 'anon'), { args: [`--remote-debugging-port=${PORT}`], headless: true });
    const page = context.pages()[0] ?? (await context.newPage());
    if (run.account === 'field') await fieldSetup(page);
    else if (run.account) await login(page, run.account);
    current = run.account;
  }
  const flags = { port: PORT, output: 'json', logLevel: 'error', disableStorageReset: true, onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'] };
  const r = await lighthouse(`${BASE}${run.path}`, flags, run.form === 'desktop' ? desktopConfig : undefined);
  const lhr = r.lhr;
  const score = (c) => Math.round((lhr.categories[c]?.score ?? 0) * 100);
  const entry = {
    name: run.name,
    url: run.path,
    finalUrl: lhr.finalDisplayedUrl.replace(BASE, ''),
    formFactor: run.form,
    performance: score('performance'),
    accessibility: score('accessibility'),
    bestPractices: score('best-practices'),
    seo: score('seo'),
    fcp: lhr.audits['first-contentful-paint']?.displayValue,
    lcp: lhr.audits['largest-contentful-paint']?.displayValue,
    tbt: lhr.audits['total-blocking-time']?.displayValue,
    cls: lhr.audits['cumulative-layout-shift']?.displayValue,
    failing: Object.values(lhr.audits)
      .filter((a) => a.score !== null && a.score < 0.9 && a.scoreDisplayMode === 'binary')
      .map((a) => a.id),
  };
  results.lighthouse.push(entry);
  console.info(`${entry.name}: perf ${entry.performance}, a11y ${entry.accessibility}, bp ${entry.bestPractices}, seo ${entry.seo} (${entry.finalUrl}) LCP ${entry.lcp} CLS ${entry.cls}${entry.failing.length ? ` failing: ${entry.failing.join(', ')}` : ''}`);
}
await context?.close();

// ---------- PWA: installability and offline start ----------
const browser = await chromium.launch();
const ctx = await browser.newContext({ serviceWorkers: 'allow' });
const page = await ctx.newPage();
await page.goto(`${BASE}/login`);
const manifest = await (await page.request.get(`${BASE}/manifest.webmanifest`)).json();
await page.evaluate(async () => {
  await navigator.serviceWorker.ready;
});
await page.reload();
const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
await ctx.setOffline(true);
await page.reload();
const offlineHeading = await page.locator('h1').first().textContent({ timeout: 15_000 }).catch(() => null);
await ctx.setOffline(false);
const sizes = manifest.icons.map((i) => `${i.sizes}${i.purpose ? ` ${i.purpose}` : ''}`);
results.pwa = {
  name: manifest.name,
  shortName: manifest.short_name,
  display: manifest.display,
  startUrl: manifest.start_url,
  themeColor: manifest.theme_color,
  backgroundColor: manifest.background_color,
  icons: sizes,
  has192: sizes.some((s) => s.startsWith('192x192')),
  has512: sizes.some((s) => s.startsWith('512x512')),
  hasMaskable: sizes.some((s) => s.includes('maskable')),
  serviceWorkerControls: controlled,
  offlineReloadRenders: offlineHeading,
};
results.pwa.pass = results.pwa.display === 'standalone' && results.pwa.has192 && results.pwa.has512 && results.pwa.hasMaskable && controlled && !!offlineHeading;
console.info(`PWA: ${JSON.stringify(results.pwa)}`);
await browser.close();
writeFileSync(OUT, JSON.stringify(results, null, 2));
console.info(`written ${OUT}`);
