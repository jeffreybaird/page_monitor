import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: { alias: { '#platform': resolve('src/platform/chrome.ts') } },
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'jsdom' },
});
