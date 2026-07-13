import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    // Include standard test files plus *.test-d.ts type-conformance tests.
    include: ['**/*.{test,spec}.?(c|m)[jt]s?(x)', '**/*.test-d.[jt]s'],
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
    // pg-idle-error-guard: patches pg prototypes so an idle-connection 57P01 at testcontainer
    // teardown can't escalate to an uncaughtException that fails the whole run — see the file.
    setupFiles: [
      '@testing-library/jest-dom/vitest',
      './tests/__setup__/jsdom-webstorage.ts',
      './tests/__setup__/pg-idle-error-guard.ts',
    ],
    // jsdom needs a URL so Web Storage (localStorage/sessionStorage) is enabled.
    // Without this, Node.js 22's experimental localStorage shadows jsdom's implementation.
    environmentOptions: {
      jsdom: {
        url: 'http://localhost/',
      },
    },
    // Don't set globals:true — tests import from 'vitest' explicitly (strict TS friendly)

    // Cap fork concurrency so the ~18 Testcontainers-based integration suites don't all spin up
    // Postgres containers simultaneously (Docker saturates and beforeAll hooks time out).
    // maxForks:4 keeps at most 4 containers running at once while still parallelising unit tests.
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks: 4,
        minForks: 1,
      },
    },
    // Raise timeouts for container start + migration under concurrent load.
    // 120 s covers the worst-case cold-pull; unit tests are unaffected (they finish in ms).
    hookTimeout: 120_000,
    testTimeout: 60_000,
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
