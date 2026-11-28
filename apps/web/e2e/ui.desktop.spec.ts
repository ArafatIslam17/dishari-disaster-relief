import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { ACCOUNTS, english, login, settleMotion } from './helpers';

/** Regression tests for the UI audit (docs/ui-audit/FINDINGS.md), at 1440 px unless stated. */
test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ context }) => {
  await english(context);
});

/** Zero axe violations of any impact (the stricter bar set by the redesign brief). */
async function expectNoViolations(page: Page): Promise<void> {
  await settleMotion(page);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

test('F01: public pages make no failing request and log no console error', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text());
  });
  page.on('response', (r) => {
    if (r.status() >= 400) problems.push(`${r.status()} ${r.url()}`);
  });
  for (const path of ['/login', '/register', '/register-organisation']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  }
  expect(problems).toEqual([]);
});

test('F03, F04: dashboard pages have one h1 and no axe violations', async ({ page }) => {
  await login(page, ACCOUNTS.coordA);
  await expect(page.getByRole('heading', { name: 'Area coverage' })).toBeVisible();
  await expectNoViolations(page);
  await page.getByRole('link', { name: 'Households', exact: true }).click();
  await page.locator('tbody tr').first().getByRole('link').first().click();
  await expect(page.getByRole('heading', { name: 'Household history' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expectNoViolations(page);
  await page.getByRole('link', { name: 'Duplicates' }).click();
  await page.locator('tbody tr').first().getByRole('link').first().click();
  await expect(page.getByRole('heading', { name: 'Matching signals' })).toBeVisible();
  await expectNoViolations(page);
});

test('F12: at 390 px the coverage table stacks into labelled rows and nothing scrolls sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, ACCOUNTS.coordA);
  await expect(page.getByRole('heading', { name: 'Area coverage' })).toBeVisible();
  await expect(page.locator('.chip-no_records').first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const display = await page.locator('tbody tr').first().evaluate((el) => getComputedStyle(el).display);
  expect(display).toBe('block');
  // The menu opens as a drawer, closes with Escape and gives focus back to its button.
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.getByRole('link', { name: 'Duplicates' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Menu' })).toBeFocused();
});

test('F43: removing an area asks for confirmation first', async ({ page }) => {
  await login(page, ACCOUNTS.opadmin);
  await page.getByRole('link', { name: /Feni Flash Flood 2024/ }).click();
  await expect(page.getByRole('heading', { name: 'Areas', exact: true })).toBeVisible();
  const rows = page.getByRole('region', { name: 'Areas table' }).locator('tbody tr');
  // The heading is static and the table arrives with its own request: wait for it before counting.
  await expect(rows.first()).toBeVisible();
  const before = await rows.count();
  expect(before).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Remove' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Only an area with no records can be removed');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(rows).toHaveCount(before);
});

test('F17: the theme follows the system and the manual choice persists', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/login');
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const systemDark = await bg();
  await page.getByRole('button', { name: /^Theme: system/ }).click(); // system -> light
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await bg()).not.toBe(systemDark);
  await page.getByRole('button', { name: /^Theme: light/ }).click(); // light -> dark
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expectNoViolations(page);
});
