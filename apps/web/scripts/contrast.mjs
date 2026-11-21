// WCAG 2.2 contrast check of the design tokens, light and dark.
//   node apps/web/scripts/contrast.mjs   (exits 1 when a pair fails)
// Parses the OKLCH custom properties in src/styles/tokens.css, converts to sRGB and checks each
// pair the interface actually draws: text >= 4.5:1, large text and control boundaries >= 3:1.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'styles', 'tokens.css'), 'utf8');

function block(selector) {
  const i = css.indexOf(selector);
  if (i < 0) throw new Error(`missing ${selector}`);
  const start = css.indexOf('{', i);
  let depth = 0;
  for (let j = start; j < css.length; j++) {
    if (css[j] === '{') depth++;
    if (css[j] === '}' && --depth === 0) return css.slice(start + 1, j);
  }
  throw new Error('unbalanced');
}
function vars(text) {
  const out = {};
  for (const m of text.matchAll(/--([\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
const light = vars(block(':root {'));
const dark = { ...light, ...vars(block(":root[data-theme='dark']")) };

function resolve(theme, name) {
  let v = theme[name];
  for (let k = 0; k < 5 && v?.startsWith('var('); k++) v = theme[v.slice(6, -1)];
  return v;
}
function oklchToSrgb(str) {
  const m = str.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  if (!m) throw new Error(`not oklch: ${str}`);
  const [L, C, H] = m.slice(1).map(Number);
  const a = C * Math.cos((H * Math.PI) / 180);
  const b = C * Math.sin((H * Math.PI) / 180);
  const l_ = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
  return lin.map((x) => Math.min(1, Math.max(0, x))); // linear sRGB, gamut-clipped
}
const luminance = (lin) => 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
function ratio(theme, fg, bg) {
  const a = luminance(oklchToSrgb(resolve(theme, fg)));
  const b = luminance(oklchToSrgb(resolve(theme, bg)));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const TEXT = 4.5;
const UI = 3;
const pairs = [
  ['ink', 'paper', TEXT], ['ink', 'surface', TEXT], ['ink', 'surface-2', TEXT], ['ink', 'surface-3', TEXT],
  ['ink-2', 'paper', TEXT], ['ink-2', 'surface', TEXT], ['ink-2', 'surface-2', TEXT],
  ['ink-3', 'paper', TEXT], ['ink-3', 'surface', TEXT], ['ink-3', 'surface-2', TEXT],
  ['teal', 'paper', TEXT], ['teal', 'surface', TEXT], ['teal', 'teal-tint', TEXT], ['teal-strong', 'teal-tint', TEXT],
  ['on-teal', 'teal', TEXT], ['on-teal', 'teal-strong', TEXT],
  ['on-marigold', 'marigold', TEXT], ['on-marigold', 'marigold-strong', TEXT], ['ink', 'marigold-tint', TEXT],
  ['on-shell', 'shell', TEXT], ['on-shell-2', 'shell', TEXT], ['on-shell', 'shell-2', TEXT], ['on-shell-2', 'shell-2', TEXT],
  ['marigold', 'shell', UI],
  ['served', 'served-bg', TEXT], ['served', 'surface', TEXT],
  ['partly', 'partly-bg', TEXT], ['partly', 'surface', TEXT],
  ['unserved', 'unserved-bg', TEXT], ['unserved', 'surface', TEXT],
  ['norecords', 'norecords-bg', TEXT], ['norecords', 'surface', TEXT],
  ['pending', 'pending-bg', TEXT], ['pending', 'surface', TEXT],
  ['conflict', 'conflict-bg', TEXT], ['conflict', 'surface', TEXT],
  ['duplicate', 'duplicate-bg', TEXT], ['duplicate', 'surface', TEXT],
  ['line-strong', 'surface', UI], ['line-strong', 'surface-2', UI], ['line-strong', 'paper', UI],
  ['focus', 'paper', UI], ['focus', 'surface', UI], ['teal', 'surface-2', UI],
];

let failed = 0;
for (const [name, theme] of [['light', light], ['dark', dark]]) {
  console.info(`\n${name}`);
  for (const [fg, bg, min] of pairs) {
    const r = ratio(theme, fg, bg);
    const ok = r >= min;
    if (!ok) failed++;
    console.info(`  ${ok ? 'ok  ' : 'FAIL'} ${fg.padEnd(16)} on ${bg.padEnd(16)} ${r.toFixed(2).padStart(6)}:1  (min ${min})`);
  }
}
console.info(failed ? `\n${failed} pair(s) below WCAG 2.2 AA` : '\nAll pairs meet WCAG 2.2 AA');
process.exit(failed ? 1 : 0);
