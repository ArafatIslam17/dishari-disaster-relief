import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { defineConfig } from 'tsup';

/** The PDF fonts (services/pdf.ts) are read from disk, so they ship beside the bundle in dist/vercel/fonts. */
function copyFonts(): void {
  const require = createRequire(import.meta.url);
  const from = join(dirname(require.resolve('@fontsource/noto-sans-bengali/package.json')), 'files');
  const to = 'dist/vercel/fonts';
  mkdirSync(to, { recursive: true });
  for (const f of readdirSync(from)) {
    if (/^noto-sans-bengali-(bengali|latin)-(400|700)-normal\.woff$/.test(f)) copyFileSync(join(from, f), join(to, f));
  }
}

/**
 * `pnpm build:vercel`: bundles the serverless entry (src/vercel.ts) into dist/vercel/vercel.js for
 * api/index.ts. Vercel compiles only the function's own TypeScript, so @relief/shared (published as
 * TypeScript source) must be bundled in. npm dependencies stay external and are traced by Vercel.
 * vercel.json runs this in its installCommand, before any function is built.
 */
export default defineConfig({
  entry: { vercel: 'src/vercel.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist/vercel',
  clean: true,
  sourcemap: true,
  noExternal: ['@relief/shared'],
  onSuccess: async () => copyFonts(),
});
