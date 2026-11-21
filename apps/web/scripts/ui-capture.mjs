/* global window, document, PopStateEvent */
// UI audit capture: every route, for every role, at every audit width, in English and Bangla.
// Writes screenshots, axe results, console/network problems and (optionally) the Impeccable
// detector findings to <out>. Runs against a running `pnpm dev` (or preview) server.
//
//   node apps/web/scripts/ui-capture.mjs --out docs/ui-audit/before [--base http://localhost:5173]
//        [--roles fv,gc,oa,sa,ob,public] [--langs en,bn] [--widths 360,390,768,1024,1440]
//        [--detect] [--theme light|dark]
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? (process.argv[i + 1] ?? true) : def;
};
const flag = (name) => process.argv.includes(`--${name}`);

const BASE = arg('base', 'http://localhost:5173');
const OUT = resolve(arg('out', 'docs/ui-audit/capture'));
const LANGS = String(arg('langs', 'en,bn')).split(',');
const WIDTHS = String(arg('widths', '360,390,768,1024,1440')).split(',').map(Number);
const ROLES = String(arg('roles', 'public,fv,gc,oa,sa,ob')).split(',');
const THEME = arg('theme', 'light');
const DETECT = flag('detect');
const CDP_PORT = 9333;
const PASSWORD = 'Relief2026demo';
const PIN = '2468';

const ACCOUNTS = { fv: '01733000002', gc: '01722000001', oa: '01711000001', sa: '01700000000', ob: '01766000001' };

/** A route is a path, or a list page plus the link that opens its first detail. */
const ROUTES = {
  public: ['/login', '/register', '/register-organisation', '/invite/not-a-real-token'],
  fv: [
    '/field',
    '/field/areas',
    '/field/search',
    { name: 'field-search-results', path: '/field/search', type: { selector: 'input[type=search]', text: 'Ra' } },
    { name: 'field-household', path: '/field/search', type: { selector: 'input[type=search]', text: 'Ra' }, click: 'main a.list-row, main li a' },
    { name: 'field-distribute', path: '/field/search', type: { selector: 'input[type=search]', text: 'Ra' }, click: 'main a.list-row, main li a', then: 'a[href$="/distribute"]' },
    '/field/households/new',
    { name: 'field-households-new-form', path: '/field/households/new', clickFirstButtonIn: 'main' },
    '/field/anonymous',
    '/field/sync',
    '/field/unserved',
    '/field/notifications',
    '/field/settings',
  ],
  gc: [
    '/app/coverage',
    { name: 'app-coverage-unserved', path: '/app/coverage', click: 'a[href*="/unserved"]' },
    '/app/households',
    { name: 'app-household-detail', path: '/app/households', click: 'tbody tr a' },
    '/app/conflicts',
    { name: 'app-conflict-detail', path: '/app/conflicts', click: 'tbody tr a' },
    '/app/duplicates',
    { name: 'app-duplicate-detail', path: '/app/duplicates', click: 'tbody tr a' },
    '/app/flags',
    { name: 'app-flag-detail', path: '/app/flags', click: 'tbody tr a' },
    '/app/members',
    '/app/join',
    '/app/reports',
    '/app/notifications',
    '/app/account',
  ],
  oa: [
    '/app/operations',
    { name: 'app-operation-detail', path: '/app/operations', click: 'main a[href^="/app/operations/"]' },
    '/app/coverage',
    '/app/flags',
    '/app/audit',
    '/app/reports',
    '/app/account',
  ],
  sa: ['/app/admin/organisations', '/app/admin/users', '/app/admin/disaster-types', '/app/admin/system', '/app/audit', '/app/coverage'],
  ob: ['/app/coverage', '/app/reports', '/app/notifications', '/app/account'],
};

const slug = (p) => p.replace(/^\//, '').replace(/[/:]+/g, '-') || 'root';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** In-app navigation: a full reload would relock the field vault. */
async function go(page, path) {
  const cur = new URL(page.url());
  if (cur.origin !== BASE) await page.goto(BASE + path);
  else if (cur.pathname + cur.search !== path) {
    await page.evaluate((p) => {
      window.history.pushState({ idx: (window.history.state?.idx ?? 0) + 1 }, '', p);
      window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
    }, path);
  }
  await settle(page);
}

async function settle(page) {
  await sleep(250);
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, { timeout: 15_000 }).catch(() => undefined);
  await page.evaluate(() => document.fonts?.ready).catch(() => undefined);
  await sleep(250);
}

async function login(page, mobile) {
  await page.goto(`${BASE}/login`);
  await page.locator('input[type=tel]').first().fill(mobile);
  await page.locator('input[type=password]').first().fill(PASSWORD);
  await page.locator('form button[type=submit]').first().click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20_000 });
  await settle(page);
}

async function fieldOnboard(page) {
  await page.waitForURL((u) => u.pathname.startsWith('/set-pin') || u.pathname.startsWith('/field'), { timeout: 20_000 });
  if (page.url().includes('/set-pin')) {
    await captureHere(page, 'set-pin');
    const pins = page.locator('input[type=password]');
    await pins.nth(0).fill(PIN);
    await pins.nth(1).fill(PIN);
    await page.locator('form button[type=submit]').first().click();
    await page.waitForURL((u) => u.pathname === '/field', { timeout: 20_000 });
    await settle(page);
  }
  const choose = page.getByRole('button', { name: /Feni Flash Flood/ });
  if (await choose.count()) {
    await captureHere(page, 'field-choose-operation');
    await choose.first().click();
    await settle(page);
    await captureHere(page, 'field-home-no-areas');
  }
  await go(page, '/field/areas');
  // Dharmapur wards hold seeded households (Pathannagar is deliberately empty).
  const boxes = page.locator('main label', { hasText: /Dharmapur|ধর্মপুর/ }).locator('input[type=checkbox]');
  await boxes.first().waitFor({ timeout: 20_000 });
  const n = Math.min(2, await boxes.count());
  for (let i = 0; i < n; i++) await boxes.nth(i).check();
  await page.locator('main button[type=button]').last().click();
  await page.waitForFunction(() => ![...document.querySelectorAll('main input[type=checkbox]')].some((c) => c.checked), null, { timeout: 90_000 });
  await settle(page);
}

// ---------- capture bookkeeping ----------
const report = { base: BASE, theme: THEME, startedAt: new Date().toISOString(), routes: [] };
// Console and network problems since the previous capture belong to the next capture.
let buffer = { console: [], network: [] };
let ctxRole = '';
let ctxLang = '';

async function captureHere(page, name, opts = {}) {
  const entry = { role: ctxRole, lang: ctxLang, name, url: page.url().replace(BASE, ''), console: buffer.console, network: buffer.network, axe: null, overflow: {}, detect: null };
  buffer = { console: [], network: [] };
  report.routes.push(entry);
  const isDash = entry.url.startsWith('/app');
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: w <= 420 ? 800 : 900 });
    await sleep(200);
    // Horizontal overflow is a defect at any width.
    entry.overflow[w] = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));
    const dir = join(OUT, ctxRole, ctxLang, String(w));
    mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: join(dir, `${name}.jpg`), fullPage: true, type: 'jpeg', quality: 62 });
  }
  const axeWidth = isDash ? 1440 : 390;
  await page.setViewportSize({ width: axeWidth, height: 900 });
  await sleep(150);
  try {
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']).analyze();
    entry.axe = r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 6).map((n) => n.target.join(' ')), count: v.nodes.length }));
  } catch (err) {
    entry.axe = [{ id: 'axe-error', help: String(err) }];
  }
  if (DETECT && ctxLang === 'en' && !opts.skipDetect) entry.detect = runDetect(page.url());
  console.info(`  ${ctxRole}/${ctxLang} ${name}: axe ${entry.axe.length}, console ${entry.console.length}, net ${entry.network.length}`);
}

function runDetect(url) {
  const launcher = join(homedir(), '.claude', 'skills', 'impeccable', 'scripts', 'impeccable');
  const env = { ...process.env, IMPECCABLE_BIN: process.env.IMPECCABLE_BIN ?? join(homedir(), '.impeccable', 'bin', '0.1.27', process.platform === 'win32' ? 'impeccable.exe' : 'impeccable') };
  const r = spawnSync('sh', [launcher, 'detect', '--cdp', String(CDP_PORT), '--target', url, '--json'], { encoding: 'utf8', timeout: 120_000, env });
  try {
    return JSON.parse(r.stdout);
  } catch {
    return { error: (r.stderr || r.stdout || '').slice(0, 2000) };
  }
}

async function visit(page, route) {
  const spec = typeof route === 'string' ? { name: slug(route), path: route } : route;
  await go(page, spec.path);
  if (spec.type) {
    await page.locator(spec.type.selector).first().fill(spec.type.text);
    await sleep(600);
  }
  if (spec.clickFirstButtonIn) {
    await page.locator(`${spec.clickFirstButtonIn} .btn-signal, ${spec.clickFirstButtonIn} button`).first().click();
    await settle(page);
  }
  for (const sel of [spec.click, spec.then].filter(Boolean)) {
    const link = page.locator(sel).first();
    if (!(await link.count())) {
      console.info(`  skip ${spec.name}: nothing matches ${sel}`);
      return;
    }
    await link.click();
    await settle(page);
  }
  await captureHere(page, spec.name);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: DETECT ? [`--remote-debugging-port=${CDP_PORT}`] : [] });
  for (const role of ROLES) {
    for (const lang of LANGS) {
      ctxRole = role;
      ctxLang = lang;
      console.info(`${role} / ${lang}`);
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: lang === 'bn' ? 'bn-BD' : 'en-GB', colorScheme: THEME === 'dark' ? 'dark' : 'light' });
      await context.addInitScript(
        ([l, theme]) => {
          try {
            localStorage.setItem('relief.lang', l);
            localStorage.setItem('relief.theme', theme);
          } catch {
            /* about:blank */
          }
        },
        [lang, THEME],
      );
      const page = await context.newPage();
      page.on('console', (m) => {
        if (m.type() === 'error' || m.type() === 'warning') buffer.console.push(`${m.type()}: ${m.text().slice(0, 300)}`);
      });
      page.on('pageerror', (e) => buffer.console.push(`pageerror: ${String(e).slice(0, 300)}`));
      // ERR_ABORTED is the app cancelling a superseded fetch (AbortController), not a failure.
      page.on('requestfailed', (r) => {
        if (!/ERR_ABORTED/.test(r.failure()?.errorText ?? '')) buffer.network.push(`failed ${r.method()} ${r.url().replace(BASE, '')} ${r.failure()?.errorText ?? ''}`);
      });
      page.on('response', (r) => {
        if (r.status() >= 400) buffer.network.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, '')}`);
      });
      try {
        if (role === 'public') {
          for (const r of ROUTES.public) {
            await page.goto(BASE + r);
            await settle(page);
            await captureHere(page, slug(r));
          }
        } else {
          await login(page, ACCOUNTS[role]);
          if (role === 'fv') await fieldOnboard(page);
          for (const r of ROUTES[role]) {
            try {
              await visit(page, r);
            } catch (err) {
              console.info(`  failed ${typeof r === 'string' ? r : r.name}: ${String(err).split('\n')[0]}`);
              report.routes.push({ role, lang, name: typeof r === 'string' ? slug(r) : r.name, error: String(err).split('\n')[0] });
            }
          }
          if (role === 'fv') {
            // Offline state, then the locked phone after a reload.
            await go(page, '/field');
            await context.setOffline(true);
            await settle(page);
            await captureHere(page, 'field-offline', { skipDetect: true });
            await go(page, '/field/sync');
            await captureHere(page, 'field-sync-offline', { skipDetect: true });
            await context.setOffline(false);
            await page.goto(`${BASE}/field`);
            await settle(page);
            await captureHere(page, 'unlock');
          }
        }
      } catch (err) {
        console.error(`  ${role}/${lang} aborted: ${String(err).split('\n')[0]}`);
        report.routes.push({ role, lang, name: 'ABORTED', error: String(err).split('\n')[0] });
      }
      await context.close();
    }
  }
  await browser.close();
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(OUT, 'capture.json'), JSON.stringify(report, null, 1));
  const done = report.routes.filter((r) => r.axe);
  console.info(
    `\n${done.length} captures; axe violations on ${done.filter((r) => r.axe.length).length}; console problems on ${done.filter((r) => r.console.length).length}; network problems on ${done.filter((r) => r.network.length).length}; overflow on ${done.filter((r) => Object.values(r.overflow).some((v) => v > 0)).length}`,
  );
}

await main();
