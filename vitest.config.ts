import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    // Component tests (*.tsx and tests/ui/**) need a DOM; everything else stays in the fast node env.
    environmentMatchGlobs: [
      ['tests/ui/**', 'jsdom'],
      ['**/*.tsx', 'jsdom'],
    ],
    // jest-dom matchers extend vitest's `expect`; RTL tests call cleanup() in their own afterEach.
    setupFiles: ['@testing-library/jest-dom/vitest'],
    // Don't set globals:true — tests import from 'vitest' explicitly (strict TS friendly)
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Neutralise the 'server-only' guard in test context — it is a compile-time concern only.
      'server-only': path.resolve(__dirname, './tests/__mocks__/server-only.ts'),
    },
  },
});
