# RUNBOOK — q·records storemanager on qrsm.store

Server: `root@46.224.105.254` · Deploy dir: `/opt/storemanager` · Domain: `qrsm.store`
Spec: `docs/superpowers/specs/2026-07-08-qrecords-v2-production-deploy-qrsm-store-design.md`

## One-time bootstrap (ordered)

### 1. DNS (IONOS DNS console)
`qrsm.store` DNS is managed at **IONOS** (registrar + nameservers `ui-dns.*`), NOT Hetzner. The
zone uses a **wildcard `A` record**, so every subdomain already resolves to the host — DNS needs
**no** per-tenant change:

```
A     qrsm.store      46.224.105.254     # apex
A     *.qrsm.store    46.224.105.254     # wildcard — any <slug>.qrsm.store resolves
```

The enumeration is **not** at the DNS layer. It is at Traefik routing + TLS: TLS is per-host
TLS-ALPN-01 (**no** wildcard cert), so only hosts named in a `Host()` router rule get routed and
get a cert (docker-compose.prod.yml lines 10-13, 98). A subdomain resolving in DNS does **not**
mean it is served — it must also be enumerated in the router.

Verify:

```bash
dig +short demo.qrsm.store          # → 46.224.105.254
dig +short anything.qrsm.store      # → 46.224.105.254 (wildcard resolves everything)
```

> **Adding a tenant is a single edit** at the routing layer: add `Host(`<slug>.qrsm.store`)` to
> the `qrsm-web` router rule and redeploy. DNS already resolves via the wildcard; the per-host
> TLS-ALPN-01 cert issues automatically on the first HTTPS request.

### 2. Mail records (as-built: send FROM nyxcore.cloud)
qrsm.store mail (MX / SPF / DKIM / DMARC) is **IONOS-managed**. Outbound app mail is **not**
sent as `@qrsm.store`: sending as `@qrsm.store` through the internal relay (egress
`46.224.105.254`) FAILS SPF+DKIM and lands in spam. The as-built decision is therefore to
send **FROM `noreply@nyxcore.cloud`** — an address already aligned with the relay's SPF/DKIM
(`.env.prod.example` lines 31-39, `MAIL_FROM=noreply@nyxcore.cloud`).

Consequences for this bootstrap:

- There is **no** qrsm.store DKIM-on-the-relay step. Do not mint a `qrsm.store` DKIM key on
  the internal mailserver — outbound mail carries nyxcore.cloud DKIM/SPF, not qrsm.store's.
- Any qrsm.store MX/SPF/DKIM/DMARC records you want (for *inbound* qrsm.store mail or future
  branded sending) are published in the **IONOS** zone, not Hetzner.
- To send qrsm.store-branded mail later, switch to IONOS SMTP with auth — that needs an
  SMTP-auth mail driver which is **not yet built** (see `.env.prod.example` line 35).

### 3. Traefik prerequisites (verify on server)
TLS is **TLS-ALPN-01** (`tlsChallenge`) with **enumerated `Host()`** routers
(docker-compose.prod.yml lines 10-13, 98). There is **no DNS-01 resolver**, **no Hetzner DNS
API token**, and **no HostRegexp** rule involved — so the old "v2 vs v3 HostRegexp form" and
"Hetzner token scope" checks do not apply and there is no such config to chase.

- Confirm the shared Traefik exposes a `websecure` entrypoint and a `letsencrypt` certresolver
  configured for the **TLS-ALPN-01** challenge (per-host certs). No DNS provider credentials
  are needed for qrsm.store certs.
- Confirm `security-headers@file` and `gzip-compress@file` middlewares exist.
- Each enumerated `Host()` (admin / demo / qrsm.store / www) gets its **own** per-host cert;
  there is no `tls.domains`/`sans` wildcard order.

### 4. Registry + deploy access
GHCR pull auth is **ephemeral** and driven by the deploy workflow — there is **no persistent
server-side PAT** and **no `GHCR_PULL_TOKEN` secret**. At deploy time the CI job logs into GHCR
with the workflow's own `GITHUB_TOKEN` (`packages: read`), pulls, then logs out again
(`ci.yml`: `GHCR_TOKEN=${{ secrets.GITHUB_TOKEN }}`, `docker login … && … pull && docker logout`).
Nothing about GHCR credentials needs to be provisioned by hand on the host.

Add the CI deploy public key to `~/.ssh/authorized_keys`; set repo secrets `DEPLOY_SSH_KEY`,
`DEPLOY_HOST=46.224.105.254` (+ optional `DEPLOY_USER`/`DEPLOY_PORT`). Those SSH secrets are the
**only** deploy secrets required — no registry PAT.

### 5. Server dir + secrets
```bash
mkdir -p /opt/storemanager
cd /opt/storemanager
# copy .env.prod.example content into .env and fill every value:
#   openssl rand -base64 32   # AUTH_SECRET
#   openssl rand -base64 32   # ENCRYPTION_KEY (must decode to 32 bytes)
# real Stripe(test)/OpenAI/Discogs keys + a strong PLATFORM_ADMIN_PASSWORD (>=12 chars).
chmod 600 .env
```

**Billing.** Production currently runs `BILLING_DRIVER=fake` (no real charges). To enable real
Stripe (test mode):

1. In the Stripe dashboard (test mode) create a webhook endpoint → `https://admin.qrsm.store/api/billing/webhook`.
2. In `/opt/storemanager/.env` set `STRIPE_SECRET_KEY=sk_test_…` and `STRIPE_WEBHOOK_SECRET=whsec_…`
   (the endpoint's signing secret), then flip `BILLING_DRIVER=stripe`.
3. `docker compose -f docker-compose.prod.yml up -d web worker`.

`parseEnv` fail-closes on boot: `BILLING_DRIVER=stripe` with either Stripe key missing aborts
startup (`src/env.ts`), so the driver never runs half-configured.

### 6. First deploy
Merge the branch to `main` (pipeline runs) or trigger `workflow_dispatch` from `main`. It rsyncs the bundle, pulls the image, `up -d`, and health-checks `qrsm-web`. Confirm Traefik issued a **per-host** TLS-ALPN-01 cert for **each** enumerated `Host()` — `admin.qrsm.store`, `demo.qrsm.store`, `qrsm.store`, `www.qrsm.store` (watch Traefik logs). There is **no** `*.qrsm.store` wildcard order — a wildcard will never appear in the logs.

### 7. Create the superadmin (one-time)
```bash
cd /opt/storemanager
docker compose -f docker-compose.prod.yml --profile bootstrap run --rm bootstrap
# → "[bootstrap] Platform superadmin ... created. Login at https://admin.qrsm.store"
```

### 8. Verify (acceptance)
```bash
curl -sI https://demo.qrsm.store | head -1         # 200/302, valid per-host demo.qrsm.store cert
curl -sI https://qrsm.store | head -1              # → splash (200)
docker logs qrsm-web | grep "database safety"      # "All database safety assertions passed"
```
The cert served on each host is a **per-host TLS-ALPN-01** cert (CN = that host), **not** a
`*.qrsm.store` wildcard — verify the SAN matches the host you hit.

Log into `https://admin.qrsm.store`, create the first real tenant, and confirm
`https://<slug>.qrsm.store` serves (after you enumerate its `Host()` + A record — see §1/§3).
The credential mail arrives **from `noreply@nyxcore.cloud`** (as-built `MAIL_FROM`,
`.env.prod.example` line 39), so acceptance checks **nyxcore.cloud** alignment: a
`noreply@nyxcore.cloud` `From:` with `spf=pass` / `dkim=pass` for **nyxcore.cloud**. You will
**not** see `qrsm.store` spf/dkim=pass — the relay sends as nyxcore.cloud, not qrsm.store. If
credential mail throws with a TLS/cert error, set `MAIL_SMTP_INSECURE=1` in `.env` and
`docker compose -f docker-compose.prod.yml up -d web worker`.

## Redeploy
Push to `main` → the pipeline pulls the new `:${sha}` and `up -d` (migrations re-run idempotently).

## Rollback
```bash
cd /opt/storemanager
IMAGE_TAG=<previous-good-sha> docker compose -f docker-compose.prod.yml up -d web worker
```

## Backups

Production DB backups are handled by `scripts/backup-prod-db.sh` (version-controlled in this
repo). **It is authored but NOT yet installed on the host** — installing the crontab entry is a
separate, explicit operator step (below). Until then, no automatic backups are running.

**What the script does.** It runs `pg_dump -Fc` (custom, compressed, `pg_restore`-able format)
against the running `qrsm-db` Postgres container and writes a timestamped dump into
`/opt/storemanager/backups/` (`qrsm-<YYYYMMDD-HHMMSS>.dump`). DB name / user / password are read
from the container's own `POSTGRES_*` env (never passed in the host argv). It writes to a
`.part` temp file and atomically renames on success, then prunes its own `qrsm-*.dump` files
older than **14 days** (retention, overridable via `RETENTION_DAYS`).

**Install (one-time, on the host).** The script ships in the deploy bundle at
`/opt/storemanager/scripts/backup-prod-db.sh`. Ensure it is executable, then add the crontab
entry — nightly at 03:15:

```bash
chmod +x /opt/storemanager/scripts/backup-prod-db.sh
crontab -e
# add:
15 3 * * *  cd /opt/storemanager && ./scripts/backup-prod-db.sh >> /var/log/qrsm-backup.log 2>&1
```

**Restore** (into the running pg container; **DESTRUCTIVE** — `--clean --if-exists` drops and
recreates objects):

```bash
docker exec -i qrsm-db sh -c \
  'PGPASSWORD="$POSTGRES_PASSWORD" pg_restore --clean --if-exists \
     -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < /opt/storemanager/backups/qrsm-YYYYMMDD-HHMMSS.dump
```

> **Restoring into a fresh / rebuilt DB (volume loss / new host).** The `-Fc` dump is a
> single-database, object-level dump — it does **not** carry global roles. `qr_owner` / `qr_app`
> are created by the `db` service's init scripts (`docker/postgres/init/*.sql`), which run **only**
> on the first init of an empty volume. Recovery order is therefore: bring up the `db` service
> first (let the init SQL recreate the roles), confirm `docker logs qrsm-web | grep "database
> safety"` can pass, **then** run the `pg_restore` above. Restoring into a hand-created empty DB
> without those roles fails on `ALTER … OWNER TO qr_owner` / `GRANT`.
>
> Before any destructive restore, confirm you are hitting the intended DB:
> `docker exec qrsm-db printenv POSTGRES_DB POSTGRES_USER   # → qrecords / postgres`

## Credential rotation

Rotate the third-party keys and the superadmin password periodically, and **immediately** if a
value may have been exposed (logs, transcripts, screen-shares). All live values are in
`/opt/storemanager/.env` (mode 600); rotation is always: reissue at the provider → update `.env`
→ restart the affected containers.

- **Discogs** (`DISCOGS_CONSUMER_KEY` / `DISCOGS_CONSUMER_SECRET`) — reissue at
  <https://www.discogs.com/settings/developers>, update `.env`, `up -d web worker`.
- **OpenAI / embeddings** (`EMBEDDINGS_API_KEY`) — revoke + reissue in the OpenAI dashboard,
  update `.env`, `up -d web worker`.
- **Superadmin** (`PLATFORM_ADMIN_PASSWORD`) — set a new value in `.env` and re-run the bootstrap
  profile (§7); it upserts the superadmin. 
- **Internal secrets** (`AUTH_SECRET`, `ENCRYPTION_KEY`) — do **not** rotate `ENCRYPTION_KEY`
  casually: stored credentials are encrypted under it and would need re-encryption (see
  `ENCRYPTION_KEY_ID`).
