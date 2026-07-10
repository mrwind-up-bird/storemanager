# q·records storemanager — Production deploy on `qrsm.store` (nyxcore.cloud host)

**Date:** 2026-07-08
**Status:** Design — approved for spec review
**Author:** Oli + Claude (Athena / Nemesis / Ipcha lenses)
**Scope:** Ship the v2 storemanager to the shared nyxCore host (`root@46.224.105.254`) behind Traefik, on the new domain `qrsm.store`, with its own Postgres, real integrations, and a git-pipeline deploy. **No changes to the app's tenancy / RLS / middleware logic.**

---

## 1. Context

Storemanager is a **dynamic multi-tenant** Next.js 15 SaaS:

- `<tenant>.qrsm.store` → a store; `admin.qrsm.store` → the platform (superadmin) zone; bare root + reserved subdomains (`www app api auth static _next cdn mail assets`) → 404 (`src/lib/subdomain.ts`, `src/middleware.ts`).
- Tenants are created **at runtime** through the platform zone (Slice 6 onboarding/superadmin/billing), so the subdomain set is open-ended → a **wildcard** domain/cert is required.
- Needs **pgvector** + two DB roles (`qr_owner` BYPASSRLS for migrations, `qr_app` NOBYPASSRLS bound by RLS) with a fail-closed boot guard (`docker/entrypoint-web.sh`) → cannot ride the shared platform Postgres; brings its **own** `db`.
- Ships as a **Next standalone image**; the Dockerfile's stated deploy model is *"CI builds & pushes this image; servers only `docker compose up`."* CI already pushes `ghcr.io/mrwind-up-bird/storemanager:{sha,latest}` on `main`.

The host already runs a shared stack under `/opt/nyxcore` (Traefik with **Let's Encrypt via Hetzner DNS-01**, `postgres`, `redis`, `docker-mailserver` as `mailserver`, Prometheus/Grafana/Loki), all on the external docker network `nyxcore_nyxcore-net`. The landingpage joins that network and is Traefik-routed by labels.

### Approved decisions

1. **DNS/TLS:** Wildcard — move `qrsm.store` DNS to Hetzner; `*.qrsm.store` cert via the existing `letsencrypt` (Hetzner DNS-01) resolver.
2. **Deploy:** GHCR image-pull — CI builds/pushes; a deploy job SSHes and `docker compose pull && up -d`.
3. **Integrations:** Real — Stripe (test mode), OpenAI embeddings (`http`), real Discogs (`http`).
4. **Root domain:** static coming-soon splash.
5. **Bootstrap:** platform superadmin **only** (first demo tenant created later via the admin UI).
6. **Mail from:** `noreply@qrsm.store` via the internal `mailserver` relay; SPF/DKIM/DMARC published in the new Hetzner zone.

## 2. Goals / Non-goals

**Goals**
- `https://<tenant>.qrsm.store`, `https://admin.qrsm.store`, and the coming-soon root serve over a valid wildcard TLS cert.
- Dedicated, isolated pgvector Postgres with the correct RLS roles + boot guard passing.
- Push-to-`main` → CI (lint/typecheck/test/build/e2e) → image push → auto-deploy → health-gated.
- Real Stripe/OpenAI/Discogs wired; credential + wishlist mail delivered from `noreply@qrsm.store`.
- One documented, ordered **one-time server bootstrap** runbook.

**Non-goals (this slice)**
- Automated tenant provisioning UI changes (already exists via Slice 6).
- DB backup automation, monitoring dashboards, staging environment (listed as follow-ups).
- Any change to tenant resolution, RLS, auth, billing, or embeddings **application** code. App-code additions are limited to: (a) a new production-bootstrap script reusing existing provisioning helpers, and (b) *possibly* a ≤5-line env-gated TLS option on the mail adapter for the internal relay (§7, §14).

## 3. Architecture

Dedicated compose stack in `/opt/q-records-storemanager/`, joined to `nyxcore_nyxcore-net` (external):

| Service | Image | Role | Ports | Traefik |
|---|---|---|---|---|
| `db` | `pgvector/pgvector:pg17` | own Postgres, named volume `qrsm_db_data`, init SQL mounted | internal only | no |
| `migrate` | `ghcr.io/mrwind-up-bird/storemanager:latest` | one-shot `migrate.cjs`, `restart:no` | — | no |
| `web` | same GHCR image | boot-guard → `node server.js` | internal `:3000` | **yes** (wildcard) |
| `worker` | same GHCR image | pg-boss worker, `restart:unless-stopped` | — | no |
| `splash` | `nginx:alpine` | static coming-soon on bare root + www | internal `:80` | **yes** (apex/www) |
| `bootstrap` | same GHCR image | one-shot superadmin creator, `profiles:[bootstrap]` | — | no |

No Redis (pg-boss runs on Postgres). No host port bindings in production — Traefik reaches `web`/`splash` over the docker network. Every service gets CPU/memory limits + `json-file` log rotation (good citizen on the shared host).

Service ordering (via `depends_on` conditions): `db` healthy → `migrate` completed → `web`/`worker` start. `bootstrap` is run **manually once**, never on redeploy.

## 4. DNS + TLS

### 4.1 Zone + records (Hetzner DNS console)
Create the `qrsm.store` zone, then:

```
A     qrsm.store        46.224.105.254
A     *.qrsm.store      46.224.105.254
```

At the registrar, set the nameservers to Hetzner's (the zone page lists them). Propagation is typically minutes–hours.

### 4.2 Wildcard certificate
Traefik's existing `letsencrypt` resolver uses the **Hetzner DNS-01** challenge, so it can mint a wildcard. On the `web` router we request a SAN cert covering the apex **and** all subdomains:

```
tls.certresolver = letsencrypt
tls.domains[0].main = qrsm.store
tls.domains[0].sans = *.qrsm.store
```

`*.qrsm.store` covers `demo.`, `admin.`, `www.`, every tenant; `main=qrsm.store` covers the apex (a wildcard does **not** match the bare apex).

> **Bootstrap verification (server-side, cannot be seen from the repo):**
> - The Traefik Hetzner API token must be authorized for `qrsm.store` (not scoped to `nyxcore.cloud` only). If scoped, extend it in Hetzner and restart Traefik. Verify by watching Traefik logs for a successful `*.qrsm.store` order.
> - Confirm the resolver name is literally `letsencrypt` (the landingpage uses that) and the file-provider middlewares `security-headers@file` + `gzip-compress@file` exist.

### 4.3 Mail deliverability records (so `noreply@qrsm.store` isn't spam-filed)
The relay is the shared `docker-mailserver`; mail egresses from `46.224.105.254`. Add to the `qrsm.store` Hetzner zone:

```
TXT   qrsm.store              v=spf1 ip4:46.224.105.254 -all
TXT   _dmarc.qrsm.store       v=DMARC1; p=none; rua=mailto:postmaster@qrsm.store; adkim=r; aspf=r
# optional, only needed to *receive* mail / strict alignment:
MX    qrsm.store   10  <mailserver FQDN, e.g. mail.nyxcore.cloud>
```

**DKIM is generated on the server** (you cannot author it — it's a keypair):

```bash
ssh root@46.224.105.254
docker exec -ti mailserver setup config dkim domain qrsm.store   # default selector: mail
# prints/writes the record to publish:
cat /tmp/docker-mailserver/opendkim/keys/qrsm.store/mail.txt
```

Publish that as `TXT  mail._domainkey.qrsm.store  "v=DKIM1; k=rsa; p=…"` (Hetzner's UI strips the quotes/joins the split strings for you). Start DMARC at `p=none` (monitor), tighten to `quarantine`/`reject` once SPF+DKIM pass. rDNS/PTR for the IP is already set for the existing mailserver, so HELO alignment is fine.

## 5. Traefik routing (labels)

Two routers on the storemanager stack, priority-ordered so apex/www hit the splash and everything else hits the app:

- **`qrsm-web`** — `rule = HostRegexp(...)` matching any single-label `*.qrsm.store`, `priority = 1`, `service` port 3000, middlewares `security-headers@file,gzip-compress@file`, wildcard TLS (§4.2). This carries `admin.` (→ middleware rewrites to `/platform`) and every tenant.
- **`qrsm-splash`** — `rule = Host(`qrsm.store`) || Host(`www.qrsm.store`)`, `priority = 100` (wins over the regexp for those two hosts), `service` port 80, same TLS cert.

**HostRegexp syntax is Traefik-version-specific** — resolve at bootstrap (`docker exec <traefik> traefik version`):
- **v3:** `HostRegexp(`^[a-z0-9-]+\.qrsm\.store$`)`
- **v2:** `HostRegexp(`{sub:[a-z0-9-]+}.qrsm.store`)`

Single-label only, matching the app (`parseTenantSlug` returns `none` for nested subdomains) and the single-level wildcard cert.

## 6. Production compose (`docker-compose.prod.yml`)

Key differences from the dev `docker-compose.yml`:

- `db`: `pgvector/pgvector:pg17`, `env` `POSTGRES_DB=qrecords`, `POSTGRES_USER=postgres`, `POSTGRES_PASSWORD`/`QR_OWNER_PASSWORD`/`QR_APP_PASSWORD` from `.env`; mounts `./docker/postgres/init:/docker-entrypoint-initdb.d:ro` and `qrsm_db_data:/var/lib/postgresql/data`; healthcheck `pg_isready`; **no host ports** (dev's `55432` mapping is E2E-only and dropped).
- `migrate`/`web`/`worker`/`bootstrap`: `image: ghcr.io/mrwind-up-bird/storemanager:latest`, **no `build:`**, `env_file: .env`.
- `web`: healthcheck `wget /api/auth/session`; Traefik labels (§5); `TRUST_PROXY=1`; no host ports.
- `worker`: `command: /app/entrypoint-worker.sh`, `restart:unless-stopped`.
- `bootstrap`: `command: node /app/bootstrap-prod.cjs`, `profiles:[bootstrap]`, `restart:no`.
- `splash`: `nginx:alpine`, mounts `./splash:/usr/share/nginx/html:ro`, Traefik labels (§5).
- `networks: [nyxcore-net]` where `nyxcore-net` is `external: true, name: nyxcore_nyxcore-net`.
- `deploy.resources.limits` + `logging` json-file (max-size 10m, max-file 3) on each service.

## 7. Environment contract

New **server-only** file `/opt/q-records-storemanager/.env` (never in git; the deploy rsync excludes it). Committed template: `.env.prod.example`.

| Key | Value | Notes |
|---|---|---|
| `NODE_ENV` | `production` | |
| `ROOT_DOMAIN` | `qrsm.store` | drives tenancy |
| `APP_PROTOCOL` | `https` | → `__Host-`/Secure cookies |
| `APP_PORT` | `443` | `tenantUrl()` omits default port → clean `https://demo.qrsm.store` |
| `TRUST_PROXY` | `1` | trust Traefik's `x-forwarded-host` |
| `PORT` / `HOSTNAME` | `3000` / `0.0.0.0` | container-internal |
| `DATABASE_URL` | `postgresql://qr_app:<APP_PW>@db:5432/qrecords` | RLS-bound runtime role |
| `DATABASE_OWNER_URL` | `postgresql://qr_owner:<OWNER_PW>@db:5432/qrecords` | migrations |
| `PGBOSS_DATABASE_URL` | `postgresql://qr_owner:<OWNER_PW>@db:5432/qrecords` | pg-boss schema |
| `POSTGRES_PASSWORD` | strong | superuser (db service only) |
| `QR_OWNER_PASSWORD` / `QR_APP_PASSWORD` | strong | **must match** the URLs above |
| `AUTH_SECRET` | `openssl rand -base64 32` | |
| `ENCRYPTION_KEY` / `ENCRYPTION_KEY_ID` | `openssl rand -base64 32` (32 bytes) / `v1` | boot guard checks 32 bytes |
| `MAIL_DRIVER` | `mailpit` | the "mailpit" adapter is plain unauth SMTP (`secure:false`) — doubles as the internal relay. **Caveat:** if `mailserver:25` advertises STARTTLS with a self-signed cert, nodemailer's default `rejectUnauthorized:true` will reject the upgrade → sends throw. Mitigation = an env-gated `ignoreTLS:true` / `tls.rejectUnauthorized:false` on the adapter (see §14). |
| `MAIL_SMTP_INSECURE` | `1` (if relay needs it) | *new, optional* — when set, the mail adapter passes `ignoreTLS:true, tls.rejectUnauthorized:false` for the internal relay only (mirrors the landingpage). Confirm need at bootstrap; leave unset if the relay accepts plain. |
| `MAIL_HOST` / `MAIL_PORT` | `mailserver` / `25` | shared docker-mailserver on the network |
| `MAIL_FROM` | `noreply@qrsm.store` | see §4.3 |
| `DISCOGS_DRIVER` | `http` | real API |
| `DISCOGS_CONSUMER_KEY` / `_SECRET` | **real** | from discogs.com/settings/developers |
| `DISCOGS_API_URL` / `_USER_AGENT` | defaults OK | |
| `BILLING_DRIVER` | `stripe` | |
| `STRIPE_SECRET_KEY` | `sk_test_…` | required (fail-closed) |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` | required (fail-closed); webhook = `/api/billing/webhook` (host-independent) |
| `EMBEDDINGS_DRIVER` | `http` | OpenAI |
| `EMBEDDINGS_API_KEY` | `sk-…` | required (fail-closed) |
| `EMBEDDINGS_MODEL` / `_API_URL` | `text-embedding-3-small` / `https://api.openai.com/v1` | defaults OK |
| `DB_POOL_MAX` / timeouts | defaults | |
| `PLATFORM_ADMIN_EMAIL` | `oli@qrsm.store` (choose) | consumed only by the bootstrap one-shot |
| `PLATFORM_ADMIN_PASSWORD` | strong | consumed only by the bootstrap one-shot |

`src/env.ts` + `parseEnv()` **fail closed at module load** if any required key or the Stripe/OpenAI cross-field rules are unmet — a bad `.env` never serves traffic.

**Stripe test-mode setup:** create a webhook endpoint in the Stripe test dashboard pointing at `https://admin.qrsm.store/api/billing/webhook` (any tenant host also works; the handler is host-independent and signature-gated); copy its signing secret into `STRIPE_WEBHOOK_SECRET`.

## 8. Data bootstrap

1. **First `db` init** runs `docker/postgres/init/01-roles.sql` (creates `qr_owner`/`qr_app`, sets ownership) + `02-extensions.sql` (`CREATE EXTENSION vector`) as superuser. Passwords come from the db service env, which **must equal** the `.env` URLs.
2. **`migrate`** applies Drizzle migrations (tracked/idempotent — safe to re-run on every deploy).
3. **`web` boot guard** asserts: `qr_app` is non-super/NOBYPASSRLS, every tenant table has RLS enabled+forced+`tenant_isolation` policy, a context-free `SELECT` returns 0 rows, and `pgvector` is present — else exits 1 before serving.
4. **Superadmin bootstrap (one-time):** `docker compose --profile bootstrap run --rm bootstrap`. A new `scripts/bootstrap-prod.ts` connects via `DATABASE_OWNER_URL` and upserts a single `platform_users` row (email + `hashPassword(PLATFORM_ADMIN_PASSWORD)`) — reusing the exact logic of `ensurePlatformUser` in `scripts/seed.ts`, **without** any demo/vinylcave/freeshop fixtures or fake Discogs tokens. It refuses to run if `PLATFORM_ADMIN_PASSWORD` is missing/weak and prints the login URL `https://admin.qrsm.store`.

The E2E fixture seed (`scripts/seed.ts`) is **never** run in production.

## 9. Deploy pipeline (GHCR image-pull)

Extend `.github/workflows/ci.yml` (or a new `deploy.yml`) with a `deploy` job gated on `github.ref == 'refs/heads/main'` (+ `workflow_dispatch`), `needs: [build, e2e]`:

1. **Deliver bundle** — `rsync` the deploy bundle to `/opt/q-records-storemanager/` (additive, `--exclude=.env`): `docker-compose.prod.yml`, `docker/postgres/init/*.sql`, `splash/`. Keeps server config in lockstep with the repo; never clobbers server secrets.
2. **Pull + up (over SSH)** — `docker login ghcr.io` with a read-only `GHCR_PULL_TOKEN` → `docker compose -f docker-compose.prod.yml pull` → `up -d --remove-orphans` (runs `migrate` to completion, then `web`/`worker`) → poll `web` container health (≤ ~2 min) → `docker image prune -f`.
3. On health failure: dump `docker logs` and exit non-zero.

**New GH secrets:** `DEPLOY_SSH_KEY`, `DEPLOY_HOST` (`46.224.105.254`), `GHCR_PULL_TOKEN` (PAT, `read:packages`), optional `DEPLOY_USER`/`DEPLOY_PORT`. The SSH public key goes into `root@…:~/.ssh/authorized_keys`.

Deploy only triggers on `main`; the current `feat/v2-slice7-…` branch must be merged to `main` to go live.

## 10. Repo changes (file inventory)

**New**
- `docker-compose.prod.yml` — production stack (§6).
- `splash/index.html` (+ minimal assets) — self-contained coming-soon page.
- `scripts/bootstrap-prod.ts` — superadmin-only bootstrap (§8.4).
- `.env.prod.example` — documented production env template (§7).
- `.github/workflows/deploy.yml` (or a `deploy` job appended to `ci.yml`).
- `docs/RUNBOOK-qrsm-store.md` — the ordered bootstrap runbook (§11) + rollback + DNS records.

**Modified (minimal, non-app-logic)**
- `Dockerfile` — one esbuild line compiling `scripts/bootstrap-prod.ts` → `dist/bootstrap-prod.cjs`, and a `COPY` into the runner (mirrors migrate/seed/worker/embeddings-backfill).
- `package.json` — `"bootstrap:prod": "tsx scripts/bootstrap-prod.ts"` (parity/local runs).
- `src/lib/email/mailpit.ts` *(only if the relay needs it)* — ≤5-line env-gated `MAIL_SMTP_INSECURE` branch (`ignoreTLS`/`rejectUnauthorized:false`) + the enum key in `src/env.ts`. No behavior change when unset (dev/E2E unaffected).

**Untouched:** all tenant/RLS/auth/billing/embeddings `src/**` logic, dev `docker-compose.yml`, `.env.compose`, existing E2E.

## 11. One-time server bootstrap runbook (operator-run, ordered)

1. **DNS:** create the `qrsm.store` zone in Hetzner, add the `A` + `*.A` records (§4.1), switch registrar nameservers, wait for propagation (`dig +short demo.qrsm.store` → `46.224.105.254`).
2. **Mail:** generate DKIM on the server (§4.3); publish SPF + DKIM + DMARC TXT (+ optional MX).
3. **Traefik prerequisites:** verify version (HostRegexp form), resolver name `letsencrypt`, Hetzner token covers `qrsm.store`, middlewares exist.
4. **Deploy SSH key:** add the CI public key to `authorized_keys`; set the GH secrets (§9).
5. **Server dir + secrets:** `mkdir -p /opt/q-records-storemanager`; create `.env` from `.env.prod.example` with generated secrets + real Stripe/OpenAI/Discogs keys + platform admin creds.
6. **First deploy:** merge to `main` (pipeline runs) **or** `workflow_dispatch`. Confirm the `web` container is healthy and Traefik issued the `*.qrsm.store` cert.
7. **Superadmin:** `cd /opt/q-records-storemanager && docker compose -f docker-compose.prod.yml --profile bootstrap run --rm bootstrap`.
8. **Verify (§13).** Log into `https://admin.qrsm.store`, create the first real tenant, confirm `https://<tenant>.qrsm.store` serves and the credential mail arrives.

## 12. Security & isolation (Nemesis lens)

- **RLS preserved end-to-end** — `qr_app` is NOBYPASSRLS; boot guard fails closed; the shared platform DB is never touched (dedicated instance).
- **Secrets** live only in the server `.env` (rsync-excluded) and GH encrypted secrets; none in the image or git. GHCR pull uses a read-only token.
- **No host port exposure** — DB and app are reachable only via the docker network / Traefik; the dev `55432` mapping is dropped.
- **Reserved subdomains** (`www app api auth static _next cdn mail assets`) can't be registered as tenant slugs; `admin` is the platform zone. State to operator.
- **Stripe webhook** is signature-verified and host-independent by design; no tenant header needed.
- **Blast-radius limits** — per-service CPU/memory caps + log rotation so storemanager can't starve the landingpage/core.
- **Mail auth** — internal relay is unauthenticated but network-scoped (`PERMIT_DOCKER=connected-networks`); SPF/DKIM/DMARC prevent spoofing/spam-filing. Any TLS relaxation (`MAIL_SMTP_INSECURE`) is scoped to the in-network `mailserver` hop only — mail leaves the host over the mailserver's own authenticated/TLS'd egress.

## 13. Verification / acceptance

- `dig +short *.qrsm.store` resolves; `curl -I https://demo.qrsm.store` returns a valid cert chain for `*.qrsm.store` (no browser warning).
- Bare `https://qrsm.store` and `https://www.qrsm.store` → coming-soon splash; `https://admin.qrsm.store` → platform login.
- `web` boot guard logs "All database safety assertions passed"; `pgvector` present.
- Superadmin login works; creating a tenant yields a working `https://<slug>.qrsm.store` store; the credential email arrives from `noreply@qrsm.store` (check headers: `spf=pass`, `dkim=pass`).
- A Stripe test-mode checkout drives a webhook that the app accepts (signature verified).
- CI: lint + typecheck + unit/integration + `next build` + docker-compose E2E all green before deploy (unchanged gates).

## 14. Risks & mitigations (Ipcha lens)

| Risk | Mitigation |
|---|---|
| Hetzner token scoped to `nyxcore.cloud` → no `*.qrsm.store` cert | Explicit bootstrap verify step; extend token + restart Traefik |
| `HostRegexp` v2/v3 syntax mismatch → no tenant routing | Verify `traefik version`; spec provides both forms |
| Splash vs. wildcard priority collision → apex routed to app | Explicit `priority` (splash 100 > web 1); verify with `curl` |
| Mail lands in spam before DKIM | SPF+DKIM+DMARC in §4.3; DMARC `p=none` first, tighten after `pass` |
| Relay rejects nodemailer's STARTTLS (self-signed cert) → credential mail throws | Bootstrap smoke-test a send; if it fails, set `MAIL_SMTP_INSECURE=1` (env-gated `ignoreTLS`/`rejectUnauthorized:false`, mirrors landingpage) |
| GHCR image private → server pull fails | Read-only `GHCR_PULL_TOKEN` + `docker login` in deploy step |
| Migration re-runs on every deploy | Drizzle migrations are tracked/idempotent; boot guard catches drift |
| Secrets in `.env` clobbered by rsync | rsync is additive with `--exclude=.env` |
| DB volume lost on `down -v` | Production deploy never uses `-v`; named volume `qrsm_db_data` persists; backups = follow-up |

## 15. Follow-ups (out of scope, tracked)

- `pg_dump` backup cron + offsite copy for `qrsm_db_data`.
- Prometheus scrape / Grafana panel for the storemanager services (postgres-exporter already on host).
- Tighten DMARC to `quarantine`/`reject` after alignment confirmed.
- Optional staging subdomain / branch-preview deploys.

---

## As-Built Deviations (2026-07-10)

This section records where the shipped production deploy diverges from the approved design above. The original design prose is left intact for historical record; **the table below is authoritative for operations.** Sources cited are the committed artifacts as-built: `docker-compose.prod.yml`, `.github/workflows/ci.yml`, and `.env.prod.example`.

| Topic | Design intent (this spec) | As-shipped | Why the change |
|---|---|---|---|
| **Deploy dir** | Dedicated stack in `/opt/q-records-storemanager/` (Scope, §3 Architecture line 46, §7 line 137, §9 line 188, §11 lines 215/219) | `/opt/storemanager/` — CI rsyncs to and `cd`s into it (`ci.yml` lines 216, 231); compose header line 3 confirms it | Path simplified during implementation. **Every `/opt/q-records-storemanager` reference in this spec (and the runbook) is stale** — an operator must use `/opt/storemanager`. |
| **DNS provider** | Move `qrsm.store` DNS to **Hetzner**; create zone in Hetzner console (Decision 1, §4.1) | DNS is **IONOS**-managed (`ui-dns.*`) | qrsm.store DNS lives at IONOS, not Hetzner. The "create the zone in Hetzner / switch nameservers to Hetzner" procedure is wrong. |
| **TLS challenge** | Wildcard `*.qrsm.store` cert via Let's Encrypt **Hetzner DNS-01** resolver; `tls.domains[].sans` (Decision 1, §4.2, §14 Hetzner-token risk) | **TLS-ALPN-01** (`tlsChallenge`) — no DNS-01 resolver, no Hetzner API token, no `tls.domains`/`sans` labels (`docker-compose.prod.yml` lines 10-13) | The DNS-01/wildcard decision was reversed at build time. §4.2 wildcard-cert procedure and the §14 Hetzner-token risk row describe a design that was not built. |
| **No wildcard cert** | One `*.qrsm.store` SAN cert covers every subdomain (§4.2, §2 Goals, §13, §11 line 220) | **Per-host** TLS-ALPN-01 certs, one per enumerated Host() (`admin.`, `demo.`, `qrsm.store`, `www.`) | No wildcard order will ever appear in Traefik logs. Verify per-host certs. Adding a tenant = add its Host() + its own A record + redeploy. |
| **Routing rule** | `qrsm-web` = `HostRegexp(^[a-z0-9-]+\.qrsm\.store$)` with `priority=1` (§5, §14 HostRegexp risk) | Enumerated `Host()` rules: `Host(\`admin.qrsm.store\`) \|\| Host(\`demo.qrsm.store\`)` — no HostRegexp, no priority label (`docker-compose.prod.yml` line 98) | HostRegexp does **not** auto-issue TLS-ALPN certs; enumeration was adopted so each host gets a cert. The §5 HostRegexp routing (both v2/v3 forms) and the §14 HostRegexp-mismatch risk row are stale. |
| **Mail from** | `noreply@qrsm.store` via internal relay; SPF/DKIM/DMARC published in the Hetzner qrsm.store zone (Decision 6, §4.3, §7 line 157, §13 line 239) | `MAIL_FROM=noreply@nyxcore.cloud` (`.env.prod.example` line 39) | Sending as `@qrsm.store` from the internal relay **fails SPF+DKIM** (qrsm.store mail is IONOS-managed), so the from-address was reversed to `nyxcore.cloud`. Acceptance must check for a `noreply@nyxcore.cloud` From with **nyxcore.cloud** SPF/DKIM alignment — `qrsm.store spf/dkim=pass` will never be seen. The §4.3 DKIM-on-the-relay setup was not built. (The mail *mechanism* — `secure:false` + `MAIL_SMTP_INSECURE` branch in `smtpOptions.ts`/`mailpit.ts` — matches as-built; only the from-address is stale.) |
| **GHCR image + pull auth** | `docker login ghcr.io` with a read-only `GHCR_PULL_TOKEN` PAT (`read:packages`) at deploy time (Decision 2, §9 line 189/192, §12, §14 GHCR risk) | The deploy pull authenticates with the **workflow's own `GITHUB_TOKEN`** (`packages:read`) — `GHCR_TOKEN=secrets.GITHUB_TOKEN`, login → pull → logout (`ci.yml` lines 183-185, 225, 233-237). Image is `ghcr.io/mrwind-up-bird/storemanager`. **No `GHCR_PULL_TOKEN` secret exists.** | No persistent server-side PAT was provisioned. The §9 secret list and §14 GHCR risk mitigation reference a token that was never created. Required secrets are only `DEPLOY_SSH_KEY` / `DEPLOY_HOST` / `DEPLOY_USER` / `DEPLOY_PORT`. |
| **Billing driver** | `BILLING_DRIVER=stripe` with `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` required, fail-closed (Decision 3, §7 lines 161-163, §13 Stripe-webhook step) | Operative production value is `BILLING_DRIVER=fake` — real Stripe deferred | The Stripe-required framing and the §13/§14 Stripe-webhook acceptance steps do not reflect deferred billing. **Caveat:** committed `.env.prod.example` line 51 still shows `BILLING_DRIVER=stripe`, so this discrepancy also lives in the template — the operative prod value is `fake`. |

**Net effect for operators:** use `/opt/storemanager`; DNS is at IONOS; certs are per-host TLS-ALPN-01 (no wildcard, no Hetzner token, no DNS-01); routing is enumerated `Host()` (add tenant = add Host() + A record + redeploy); credential mail comes **from** `noreply@nyxcore.cloud`; the deploy pulls `ghcr.io/mrwind-up-bird/storemanager` using the CI `GITHUB_TOKEN` (no PAT on the host); billing runs the `fake` driver. The companion `docs/RUNBOOK-qrsm-store.md` carries the same stale claims (Hetzner DNS, `/opt/q-records-storemanager`, wildcard cert, `noreply@qrsm.store`, `GHCR_PULL_TOKEN`) and should be read through this same lens until corrected.
