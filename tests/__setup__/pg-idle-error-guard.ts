/**
 * Global pg idle-connection error guard (vitest setupFiles).
 *
 * Testcontainers stop their Postgres with a fast shutdown, sending every still-open connection a
 * FATAL 57P01 ("terminating connection due to administrator command"). node-postgres surfaces
 * that as an `'error'` event on the owning Pool/Client — and with NO listener, an EventEmitter
 * `'error'` throws, escalating to an uncaughtException that fails the WHOLE vitest run even when
 * every test passed (the `ELIFECYCLE` / 57P01 CI flake).
 *
 * The ~20 integration suites each create their own `new Pool(db.ownerUrl)` and can't all be
 * trusted to register a listener (and future suites would reintroduce the gap), so guarding at
 * the source — the shared pg prototypes — is the only robust, single-point fix. Every pool/client
 * lazily gets a no-op `'error'` listener the moment it opens a connection.
 *
 * This is SAFE: pg emits the pool/client `'error'` event only for *idle* connection drops.
 * In-flight query errors still reject through their own promises, so genuine failures still
 * surface as normal test failures. This runs only under vitest — production code is untouched.
 */
import pg from 'pg';

type ErrorEmitter = {
  listenerCount(event: string): number;
  on(event: 'error', listener: (err: unknown) => void): unknown;
};

function ensureErrorListener(emitter: ErrorEmitter): void {
  // Add exactly one guard listener per emitter — `Pool.connect` runs on every checkout, so the
  // count check prevents both listener accumulation and a MaxListenersExceeded warning.
  if (emitter.listenerCount('error') === 0) {
    emitter.on('error', () => {
      /* idle connection dropped (e.g. testcontainer teardown → 57P01); swallow so it can't
         escalate to an uncaughtException. Real query errors reject through their promises. */
    });
  }
}

// Patch the prototype (not the class) so the guard applies to EVERY instance regardless of how
// each module imported `pg` — including pg-boss's internal pool, which shares these prototypes.
for (const proto of [pg.Pool.prototype, pg.Client.prototype] as Array<{ connect: unknown }>) {
  const originalConnect = proto.connect as (...args: unknown[]) => unknown;
  proto.connect = function patchedConnect(this: ErrorEmitter, ...args: unknown[]) {
    ensureErrorListener(this);
    return originalConnect.apply(this, args);
  };
}
