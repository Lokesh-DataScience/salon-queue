// backend/vitest.config.mts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    fileParallelism: false, // tests share one database
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});