// Renders the PWA PNG icons from the SVG sources in public/ with headless Chromium.
//   node apps/web/scripts/make-icons.mjs
// icon.svg -> icon-192.png, icon-512.png, apple-touch-icon.png (180)
// icon-maskable.svg (full-bleed, mark inside the 80 % safe zone) -> icon-maskable-512.png
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const pub = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const jobs = [
  ['icon.svg', 'icon-192.png', 192],
  ['icon.svg', 'icon-512.png', 512],
  ['icon.svg', 'apple-touch-icon.png', 180],
  ['icon-maskable.svg', 'icon-maskable-512.png', 512],
];

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const [src, out, size] of jobs) {
  const svg = readFileSync(join(pub, src), 'utf8');
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent"><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" width="${size}" height="${size}" style="display:block"></body></html>`);
  await page.screenshot({ path: join(pub, out), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  console.info(`${out} ${size}x${size}`);
}
await browser.close();
