import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 180_000,
    // One file at a time keeps memory low on the laptop and avoids PGlite instances competing.
    fileParallelism: false,
    pool: 'forks',
  },
});
