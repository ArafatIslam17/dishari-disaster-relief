import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { ACCOUNTS, english, expectAccessible, fieldReady, shot, swControlled, throttle400kbps, unlock } from './helpers';

/** PDF 2.1 Scenarios 1-3 on a 375 px phone, run in order on one device. */
test.describe.configure({ mode: 'serial' });

let context: BrowserContext;
let page: Page;
let shortCode = '';

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
    serviceWorkers: 'allow',
  });
  await english(context);
  page = await context.newPage();
});
test.afterAll(async () => context.close());

test('login and onboarding are accessible', async () => {
  await page.goto('/login');
  await expectAccessible(page);
  await shot(page, 'login');
  await fieldReady(page, ACCOUNTS.volA2, ['Feni Sadar, Dharmapur, ward 1', 'Feni Sadar, Dharmapur, ward 2']);
  await swControlled(page);
  await page.goto('/field'); // a full reload restarts the app locked: PIN unlock (UC02 1.a)
  await unlock(page);
  await expectAccessible(page);
  await shot(page, 'field-home');
});

test('Scenario 1: register a household offline, with consent and a short code', async () => {
  await context.setOffline(true);
  await expect(page.getByText('Offline', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'New household' }).click();
  await expect(page.getByText('আমরা ত্রাণ বিতরণ সমন্বয়ের জন্য')).toBeVisible(); // consent read aloud in Bangla
  await shot(page, 'consent');
  await page.getByRole('button', { name: 'The household agrees to be registered' }).click();
  await page.getByLabel('Head of household (English letters)').fill('Kulsum Begum');
  await page.getByLabel('Mobile number').fill('01911223344');
  await page.getByLabel('Family members', { exact: true }).fill('5');
  await page.getByLabel('Ward').selectOption({ label: 'Feni Sadar, Dharmapur, ward 1' });
  await expectAccessible(page);
  await shot(page, 'new-household-form');
  await page.getByRole('button', { name: 'Save household' }).click();
  const similar = page.getByRole('heading', { name: 'Similar households on this phone' });
  if (await similar.isVisible().catch(() => false)) await page.getByRole('button', { name: 'It is a new household: save it' }).click();
  await expect(page.getByRole('heading', { name: 'Household registered; sync pending.' })).toBeVisible();
  shortCode = ((await page.locator('.short-code').textContent()) ?? '').replace(/\s/g, '');
  expect(shortCode).toMatch(/^[0-9A-Z]{9}$/);
  await expect(page.getByText('1 waiting to sync')).toBeVisible();
  await shot(page, 'short-code-card');

  // UC12: registering the same family again shows the local similarity warning (FR09).
  await page.getByRole('link', { name: 'New household' }).click();
  await page.getByRole('button', { name: 'The household agrees to be registered' }).click();
  await page.getByLabel('Head of household (English letters)').fill('Kulsum Begam');
  await page.getByLabel('Mobile number').fill('01911223344');
  await page.getByLabel('Ward').selectOption({ label: 'Feni Sadar, Dharmapur, ward 1' });
  await page.getByRole('button', { name: 'Save household' }).click();
  await expect(page.getByRole('heading', { name: 'Similar households on this phone' })).toBeVisible();
  await shot(page, 'similar-warning');
  await page.getByRole('link', { name: 'Open this household' }).first().click(); // UC11 5.a: no new household saved
  await expect(page.getByText('Kulsum Begum')).toBeVisible();
  await expect(page.getByText('1 waiting to sync')).toBeVisible();
});

test('NFR08: records survive an app restart while offline', async () => {
  await page.reload(); // still offline: the service worker serves the app shell
  await unlock(page);
  await page.getByRole('link', { name: 'Search' }).click();
  await page.getByLabel('Short code, name or mobile number').fill(shortCode.toLowerCase());
  await expect(page.getByText('1 household found')).toBeVisible();
  await shot(page, 'search');
});

test('Scenario 2: record a relief distribution and an anonymous distribution offline', async () => {
  await page.getByRole('link', { name: /Kulsum Begum/ }).click();
  await page.getByRole('link', { name: 'Record distribution' }).click();
  await page.getByRole('textbox', { name: 'Quantity: Rice' }).fill('10');
  await page.getByRole('textbox', { name: 'Quantity: Oral saline' }).fill('4');
  await page.getByLabel('The family already received relief from another group today').check();
  await shot(page, 'distribution-form');
  await page.getByRole('button', { name: 'Save distribution' }).click();
  await expect(page.getByText('Past distributions')).toBeVisible();
  await expect(page.getByText(/Rice 10 kg/)).toBeVisible();
  await shot(page, 'household-detail');
  // A family that declines registration: anonymous distribution for the area (UC13 1.a).
  await page.getByRole('link', { name: 'Home' }).click();
  await page.getByRole('link', { name: 'Anonymous distribution' }).click();
  await page.getByLabel('Area').selectOption({ label: 'Feni Sadar, Dharmapur, ward 2' });
  await page.getByRole('textbox', { name: 'Quantity: Dry food pack' }).fill('1');
  await page.getByRole('button', { name: 'Save distribution' }).click();
  await expect(page.getByRole('heading', { name: 'Field work' })).toBeVisible();
  await expect(page.getByText('3 waiting to sync')).toBeVisible();
});

test('Scenario 3: synchronise after an interrupted upload, at 400 kbps', async () => {
  await context.setOffline(false);
  // The first upload fails part-way (connection drop); nothing is lost.
  await page.route('**/api/sync/push', (route) => route.abort('connectionreset'));
  await page.getByRole('navigation').getByRole('link', { name: /^Sync/ }).click();
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByText('Sync interrupted; retry later.').first()).toBeVisible();
  await expect(page.getByText('3 waiting to sync')).toBeVisible();
  await shot(page, 'sync-interrupted');
  await page.unroute('**/api/sync/push');
  const restore = await throttle400kbps(page);
  const started = Date.now();
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByText('Synchronisation completed.').first()).toBeVisible({ timeout: 60_000 });
  const ms = Date.now() - started;
  await restore();
  console.info(JSON.stringify({ metric: 'e2e-sync-400kbps', records: 3, ms }));
  await expect(page.getByText('All synced')).toBeVisible();
  await expect(page.getByText('Nothing is waiting.', { exact: false })).toBeVisible();
  await shot(page, 'sync-complete');
  expect(ms).toBeLessThan(60_000);
});
