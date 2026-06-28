import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    // Exclude Playwright e2e specs — they use @playwright/test, not vitest.
    exclude: ['e2e/**', 'node_modules/**'],
    // Component tests (*.tsx and tests/ui/**) need a DOM; everything else stays in the fast node env.
    environmentMatchGlobs: [
      ['tests/ui/**', 'jsdom'],
      ['tests/**/*.tsx', 'jsdom'],
      ['**/*.tsx', 'jsdom'],
    ],
    // jest-dom matchers extend vitest's `expect`; RTL tests call cleanup() in their own afterEach.
    // jsdom-webstorage: fixes Node.js 22 compat — see tests/__setup__/jsdom-webstorage.ts
    setupFiles: ['@testing-library/jest-dom/vitest', './tests/__setup__/jsdom-webstorage.ts'],
    // jsdom needs a URL so Web Storage (localStorage/sessionStorage) is enabled.
    // Without this, Node.js 22's experimental localStorage shadows jsdom's implementation.
    environmentOptions: {
      jsdom: {
        url: 'http://localhost/',
      },
    },
    // Don't set globals:true — tests import from 'vitest' explicitly (strict TS friendly)
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Neutralise the 'server-only' guard in test context — it is a compile-time concern only.
      'server-only': path.resolve(__dirname, './tests/__mocks__/server-only.ts'),
    },
  },
  // Enable React's automatic JSX transform so component tests don't need `import React`
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
});
