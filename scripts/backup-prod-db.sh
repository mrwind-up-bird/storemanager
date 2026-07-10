#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# backup-prod-db.sh — production Postgres backup for the qrsm.store deployment
# -----------------------------------------------------------------------------
# PURPOSE
#   Take a compressed, self-contained pg_dump (custom format, -Fc) of the
#   application database that the qrsm.store web app uses, store it under a
#   retained backup directory, and prune old dumps. Designed to be run
#   unattended from cron on the deploy host (/opt/storemanager).
#
#   The target DB, user, and password are NOT hardcoded here. They are read
#   from the postgres container's OWN environment (POSTGRES_DB / POSTGRES_USER /
#   POSTGRES_PASSWORD, as defined in docker-compose.prod.yml). The password is
#   never passed on the command line — it is exported as PGPASSWORD strictly
#   inside the `docker exec` shell.
#
# CRONTAB (daily at 03:15, host time)
#   15 3 * * * /opt/storemanager/scripts/backup-prod-db.sh >> /var/log/qrsm-backup.log 2>&1
#
# RESTORE (into the running pg container; DESTRUCTIVE — drops/recreates objects)
#   Copy or stream the dump into the container, then pg_restore with --clean
#   --if-exists so a re-run against an existing DB is idempotent:
#
#     docker exec -i qrsm-db sh -c \
#       'PGPASSWORD="$POSTGRES_PASSWORD" pg_restore --clean --if-exists \
#          -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
#       < /opt/storemanager/backups/qrsm-YYYYMMDD-HHMMSS.dump
#
# =============================================================================

# --- Configuration (overridable via environment) ----------------------------
PG_CONTAINER="${PG_CONTAINER:-qrsm-db}"
BACKUP_DIR="${BACKUP_DIR:-/opt/storemanager/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
DUMP_FILE="${BACKUP_DIR}/qrsm-${TIMESTAMP}.dump"

# --- Preconditions -----------------------------------------------------------
if ! docker inspect -f '{{.State.Running}}' "${PG_CONTAINER}" 2>/dev/null | grep -q true; then
  echo "ERROR: postgres container '${PG_CONTAINER}' is not running" >&2
  exit 1
fi

mkdir -p "${BACKUP_DIR}"

# --- Dump --------------------------------------------------------------------
# Credentials come from the container's own env; PGPASSWORD is exported only
# inside the exec'd shell, so the secret never appears in this host's argv,
# process list, or output. Custom format (-Fc) is compressed and restorable
# with pg_restore. Stream stdout to a temp file, then atomically rename on
# success so a partial dump is never mistaken for a good backup.
TMP_FILE="${DUMP_FILE}.part"

# shellcheck disable=SC2016  # $POSTGRES_* must expand inside the container, not here.
if docker exec "${PG_CONTAINER}" sh -c \
      'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
      > "${TMP_FILE}"; then
  mv -f "${TMP_FILE}" "${DUMP_FILE}"
else
  rc=$?
  rm -f "${TMP_FILE}"
  echo "ERROR: pg_dump failed (exit ${rc})" >&2
  exit "${rc}"
fi

# --- Prune old dumps ---------------------------------------------------------
# Only touch our own timestamped dumps, older than the retention window.
find "${BACKUP_DIR}" -maxdepth 1 -type f -name 'qrsm-*.dump' \
  -mtime "+${RETENTION_DAYS}" -delete

# --- Report ------------------------------------------------------------------
SIZE="$(du -h "${DUMP_FILE}" | cut -f1)"
echo "OK: backup written to ${DUMP_FILE} (${SIZE})"
