import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

/**
 * Config for tuning probes (`npm run balance`).
 *
 * Probes live in `*.probe.ts` files and are excluded from the normal suite by
 * its `*.test.ts` include glob — they assert nothing and only print numbers, so
 * running them in CI would be noise. This config opts them back in.
 *
 * Written standalone rather than with `mergeConfig`, which concatenates array
 * options: merging would have appended the probe glob to the suite's include
 * list and run the entire test suite alongside the probe.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.probe.ts'],
  },
});
