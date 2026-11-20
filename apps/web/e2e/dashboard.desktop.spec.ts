import { expect, test } from '@playwright/test';
import { ACCOUNTS, PASSWORD, english, expectAccessible, fieldReady, login, shot } from './helpers';

/** PDF 2.1 Scenarios 4-6 and the administration screens at 1440 px. */
test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ context }) => {
  await english(context);
});

test('Scenario 4: review a possible duplicate household, link it and undo the link', async ({ page }) => {
  await login(page, ACCOUNTS.coordA);
  await expect(page.getByRole('heading', { name: 'Area coverage' })).toBeVisible();
  await page.getByRole('link', { name: /^Notifications/ }).first().click();
  await expect(page.getByText(/possible duplicate household/).first()).toBeVisible();
  await shot(page, 'notifications');
  await page.getByRole('link', { name: 'Duplicates' }).click();
  await expect(page.getByRole('heading', { name: 'Possible duplicate households' })).toBeVisible();
  await shot(page, 'duplicates-list');
  await page.locator('tbody tr').first().getByRole('link').first().click();
  await expect(page.getByRole('heading', { name: 'Matching signals' })).toBeVisible();
  await expect(page.getByText('Mobile number').first()).toBeVisible();
  await expectAccessible(page);
  await shot(page, 'duplicate-detail');
  await page.getByRole('button', { name: 'Same household: link them' }).click();
  await expect(page.getByText('Duplicate review completed.')).toBeVisible();
  await page.getByRole('button', { name: 'Undo link' }).click();
  await expect(page.getByText('Link undone; the records are separate again.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Same household: link them' })).toBeVisible();
});

test('Scenario 5: resolve a conflicting household edit', async ({ page }) => {
  await login(page, ACCOUNTS.coordA);
  await page.getByRole('link', { name: 'Conflicts' }).click();
  await expect(page.getByRole('heading', { name: 'Conflicting edits' })).toBeVisible();
  await shot(page, 'conflicts-list');
  await page.locator('tbody tr').first().getByRole('link').first().click();
  await expect(page.getByRole('heading', { name: 'Value on the server' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Value from the field' })).toBeVisible();
  await shot(page, 'conflict-detail');
  await page.getByRole('button', { name: 'Use this value' }).last().click();
  await expect(page.getByText('Conflict resolved.')).toBeVisible();
  await expect(page.getByText('No open conflicts.')).toBeVisible();
  // The decision is part of the household's history (UC17 step 6, UC23).
  await page.getByRole('button', { name: 'Show resolved' }).click();
  await page.locator('tbody tr').first().getByRole('link').first().click();
  await expect(page.getByText(/^Resolved:/)).toBeVisible();
});

test('Scenario 6: check area coverage and send an unserved list to a field device', async ({ page, browser }) => {
  await login(page, ACCOUNTS.coordB);
  await expect(page.getByRole('heading', { name: 'Area coverage' })).toBeVisible();
  await expect(page.locator('.chip-no_records').first()).toBeVisible(); // an empty area never looks served
  await expect(page.locator('.chip-partly_served').first()).toBeVisible();
  await expectAccessible(page);
  await shot(page, 'coverage');
  await page.getByLabel('Upazila').selectOption('Feni Sadar');
  await expect(page).toHaveURL(/upazila=Feni/);
  await page.getByRole('link', { name: 'Unserved households' }).first().click();
  await expect(page.getByRole('heading', { name: 'Unserved households' })).toBeVisible();
  await shot(page, 'unserved-dashboard');
  await page.getByRole('button', { name: 'Send this list to field devices' }).click();
  await expect(page.getByText('Unserved list ready.')).toBeVisible();

  // The volunteer receives it at the next sync and reads it offline (UC21 steps 5-6).
  const phone = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  await english(phone);
  const field = await phone.newPage();
  await fieldReady(field, ACCOUNTS.volB1, ['Feni Sadar, Dharmapur, ward 1', 'Feni Sadar, Dharmapur, ward 2', 'Feni Sadar, Dharmapur, ward 3', 'Feni Sadar, Lemua, ward 1', 'Feni Sadar, Lemua, ward 2', 'Feni Sadar, Lemua, ward 3']);
  await phone.setOffline(true);
  await field.getByRole('link', { name: 'Home' }).click();
  await field.getByRole('link', { name: 'Unserved lists' }).click();
  await expect(field.getByText(/Sent .* by Farhana Rahman/)).toBeVisible();
  await shot(field, 'unserved-field');
  await phone.close();
});

test('Observer sees area-level figures and gets a report without personal data', async ({ page }) => {
  await login(page, ACCOUNTS.observer);
  await expect(page.getByText('Area-level figures only.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Households' })).toHaveCount(0);
  await shot(page, 'coverage-observer');
  await page.getByRole('link', { name: 'Reports' }).click();
  await page.getByLabel('CSV').check();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Generate report' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^operation-summary-.*\.csv$/);
  await expect(page.getByText('Report ready to download.')).toBeVisible();
});

test('Operation administrator: setup, join requests, audit trail and reports', async ({ page }) => {
  await login(page, ACCOUNTS.opadmin);
  await expect(page.getByRole('heading', { name: 'Operations' })).toBeVisible();
  await shot(page, 'operations');
  await page.getByRole('link', { name: /Feni Flash Flood 2024/ }).click();
  await expect(page.getByRole('heading', { name: 'Join requests' })).toBeVisible();
  await page.getByLabel('Item name', { exact: true }).fill('Blanket');
  await page.getByLabel('Unit').fill('piece');
  await page.getByRole('button', { name: 'Add', exact: true }).first().click();
  await expect(page.getByText('Operation setup saved.')).toBeVisible();
  await shot(page, 'operation-detail');
  await page.getByRole('link', { name: 'Audit trail' }).click();
  await expect(page.getByRole('heading', { name: 'Audit trail' })).toBeVisible();
  await page.getByLabel('Action').fill('household.');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.locator('tbody tr').first()).toBeVisible();
  await shot(page, 'audit');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  expect((await download).suggestedFilename()).toMatch(/^audit-.*\.csv$/);
  await page.getByRole('link', { name: 'Reports' }).click();
  const pdf = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Generate report' }).click();
  expect((await pdf).suggestedFilename()).toMatch(/\.pdf$/);
  await shot(page, 'reports');
});

test('Coordinator approves a new volunteer; System Administrator approves an organisation', async ({ page }) => {
  await login(page, ACCOUNTS.coordA);
  await page.getByRole('link', { name: 'Members' }).click();
  await page.getByRole('tab', { name: 'Waiting for approval' }).click();
  await expect(page.getByText('Nayeem Islam')).toBeVisible();
  await shot(page, 'members');
  await page.getByRole('row', { name: /Nayeem Islam/ }).getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('Member and device details updated.')).toBeVisible();
  await page.getByRole('button', { name: 'Log out' }).click();

  await login(page, ACCOUNTS.admin);
  await expect(page.getByRole('heading', { name: 'Organisations' })).toBeVisible();
  await expect(page.getByText('Meghna Flood Response')).toBeVisible();
  await shot(page, 'admin-organisations');
  await page.getByRole('button', { name: 'Approve' }).first().click();
  await expect(page.getByText('Organisation approved.')).toBeVisible();
  await page.getByRole('link', { name: 'Backup and retention' }).click();
  await expect(page.getByRole('heading', { name: 'Retention', exact: true })).toBeVisible();
  await shot(page, 'admin-system');
});

test('Bangla interface: coverage labels and the field home in Bangla (NFR18)', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.getByRole('button', { name: 'বাংলা' }).click();
  await page.getByLabel('মোবাইল নম্বর').fill(ACCOUNTS.coordA);
  await page.getByLabel('পাসওয়ার্ড').fill(PASSWORD);
  await page.getByRole('button', { name: 'লগইন করুন' }).click();
  await expect(page.getByRole('heading', { name: 'এলাকাভিত্তিক ত্রাণ পরিস্থিতি' })).toBeVisible();
  await expect(page.getByText('কোনো রেকর্ড নেই').first()).toBeVisible();
  await shot(page, 'coverage-bangla');
  await ctx.close();
});
