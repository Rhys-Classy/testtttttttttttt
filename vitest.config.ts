import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { TEST_ENV } from './tests/env';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/global-setup.ts'],
    env: TEST_ENV,
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
