/**
 * Next.js instrumentation hook — `register()` is invoked exactly once per server
 * process start (`next dev`, `next start`, `node server.js`, …), so the TypeScript
 * boot guards become LIVE enforcement regardless of how the process is launched,
 * not only via docker/entrypoint-web.sh (which stays in place as earlier,
 * defense-in-depth enforcement).
 *
 * The guards run ONLY on the Node.js runtime. The node-only dynamic `import()`s
 * live INSIDE the `=== 'nodejs'` block so that, for the Edge compiler,
 * `process.env.NEXT_RUNTIME` is statically replaced with `'edge'`, the block
 * constant-folds away, and webpack never pulls node-only modules (`pg`,
 * `server-only`, the env Zod parse) into the edge/middleware bundle. Failures are
 * fail-closed: the assertion throw propagates out of `register()`, aborting startup.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // 1. ENCRYPTION_KEY must base64-decode to exactly 32 bytes (AES-256).
    const { assertEncryptionKey } = await import('@/lib/crypto');
    assertEncryptionKey();

    // 2. Database must be in a safe, RLS-enforcing state for the runtime role.
    const { assertDatabaseSafety } = await import('@/db/assertions');
    await assertDatabaseSafety();
  }
}
