import { defineConfig } from 'tsup';

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
});
