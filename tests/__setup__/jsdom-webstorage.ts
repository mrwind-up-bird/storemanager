/**
 * Node.js 22 Web Storage compatibility fix for jsdom + vitest.
 *
 * Root cause: vitest (forks pool) runs jsdom in the same Node.js process. It
 * creates a JSDOM instance and copies its window properties into globalThis via
 * `populateGlobal`. However, `getWindowKeys` skips any property that is already
 * present in globalThis UNLESS it appears in vitest's hard-coded KEYS allowlist.
 * In Node.js 22, `localStorage` and `sessionStorage` are experimental globals
 * already in globalThis (they return `undefined` without `--localstorage-file`),
 * so vitest's helper skips them and jsdom's fully-functional Storage objects
 * never reach the test scope.
 *
 * The fix: vitest exposes the raw JSDOM instance as `globalThis.jsdom`. We read
 * localStorage/sessionStorage directly from jsdom's own window and re-define
 * those properties on globalThis so that bare identifiers in tests resolve to
 * jsdom's Storage, not Node.js's stub.
 *
 * This runs as a setupFile so it executes once per test file, after the jsdom
 * environment is already active. The `typeof globalThis.jsdom` guard limits the
 * effect to jsdom environment files only.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any;

if (typeof g.jsdom !== 'undefined' && g.jsdom.window) {
  const jsdomWin: Window = g.jsdom.window;
  for (const key of ['localStorage', 'sessionStorage'] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(jsdomWin, key);
    if (descriptor) {
      Object.defineProperty(globalThis, key, {
        ...descriptor,
        configurable: true,
        enumerable: false,
      });
    }
  }
}
