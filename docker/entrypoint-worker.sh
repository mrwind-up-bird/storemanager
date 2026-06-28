#!/bin/sh
# Worker entrypoint. compose depends_on guarantees the DB is healthy and migrations have
# completed before this runs. worker.cjs is a self-contained esbuild CJS bundle whose own
# `import.meta`-based "run if main" guard is inert under the cjs format, so we invoke the
# exported startWorker() explicitly.
set -e

echo "[worker] Starting pg-boss worker process..."
exec node -e "require('/app/worker.cjs').startWorker().catch((e) => { console.error('[worker] fatal:', e); process.exit(1); })"
