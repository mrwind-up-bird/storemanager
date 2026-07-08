# RUNBOOK — q·records storemanager on qrsm.store

Server: `root@46.224.105.254` · Deploy dir: `/opt/q-records-storemanager` · Domain: `qrsm.store`
Spec: `docs/superpowers/specs/2026-07-08-qrecords-v2-production-deploy-qrsm-store-design.md`

## One-time bootstrap (ordered)

### 1. DNS (Hetzner DNS console)
Create the `qrsm.store` zone, then add:

```
A     qrsm.store        46.224.105.254
A     *.qrsm.store      46.224.105.254
```

Point the registrar's nameservers at the ones Hetzner lists for the zone. Verify:

```bash
dig +short demo.qrsm.store   # → 46.224.105.254
```

### 2. Mail records (SPF / DKIM / DMARC)
Generate DKIM on the server (docker-mailserver mints the record):

```bash
docker exec -ti mailserver setup config dkim domain qrsm.store   # default selector: mail
cat /tmp/docker-mailserver/opendkim/keys/qrsm.store/mail.txt      # the TXT value to publish
```

Publish in the Hetzner zone:

```
TXT   qrsm.store              v=spf1 ip4:46.224.105.254 -all
TXT   mail._domainkey.qrsm.store   <the p=... value from mail.txt>
TXT   _dmarc.qrsm.store       v=DMARC1; p=none; rua=mailto:postmaster@qrsm.store; adkim=r; aspf=r
# optional (receive / strict alignment); mailserver FQDN: `docker exec mailserver hostname -f`
MX    qrsm.store   10   mail.nyxcore.cloud
```

Tighten DMARC to `p=quarantine` then `p=reject` once SPF+DKIM report `pass`.

### 3. Traefik prerequisites (verify on server)
```bash
docker exec <traefik-container> traefik version     # v2 vs v3 → HostRegexp form (see compose comment)
```
- Confirm the resolver is named `letsencrypt` and its Hetzner DNS API token is authorized for `qrsm.store` (not scoped to nyxcore.cloud only). If scoped, extend the token and restart Traefik.
- Confirm `security-headers@file` and `gzip-compress@file` middlewares exist.

### 4. Registry + deploy access
```bash
# GHCR pull auth — persistent, server-side (a read-only PAT with read:packages):
echo <GHCR_READ_PAT> | docker login ghcr.io -u <github-user> --password-stdin
```
Add the CI deploy public key to `~/.ssh/authorized_keys`; set repo secrets `DEPLOY_SSH_KEY`, `DEPLOY_HOST=46.224.105.254` (+ optional `DEPLOY_USER`/`DEPLOY_PORT`).

### 5. Server dir + secrets
```bash
mkdir -p /opt/q-records-storemanager
cd /opt/q-records-storemanager
# copy .env.prod.example content into .env and fill every value:
#   openssl rand -base64 32   # AUTH_SECRET
#   openssl rand -base64 32   # ENCRYPTION_KEY (must decode to 32 bytes)
# real Stripe(test)/OpenAI/Discogs keys + a strong PLATFORM_ADMIN_PASSWORD (>=12 chars).
chmod 600 .env
```

Stripe: create a **test-mode** webhook at `https://admin.qrsm.store/api/billing/webhook`; put its signing secret in `STRIPE_WEBHOOK_SECRET`.

### 6. First deploy
Merge the branch to `main` (pipeline runs) or trigger `workflow_dispatch` from `main`. It rsyncs the bundle, pulls the image, `up -d`, and health-checks `qrsm-web`. Confirm Traefik issued the `*.qrsm.store` cert (watch Traefik logs).

### 7. Create the superadmin (one-time)
```bash
cd /opt/q-records-storemanager
docker compose -f docker-compose.prod.yml --profile bootstrap run --rm bootstrap
# → "[bootstrap] Platform superadmin ... created. Login at https://admin.qrsm.store"
```

### 8. Verify (acceptance)
```bash
curl -sI https://demo.qrsm.store | head -1         # 200/302, valid *.qrsm.store cert
curl -sI https://qrsm.store | head -1              # → splash (200)
docker logs qrsm-web | grep "database safety"      # "All database safety assertions passed"
```
Log into `https://admin.qrsm.store`, create the first real tenant, confirm `https://<slug>.qrsm.store` serves and the credential mail arrives from `noreply@qrsm.store` (headers: `spf=pass`, `dkim=pass`). If credential mail throws with a TLS/cert error, set `MAIL_SMTP_INSECURE=1` in `.env` and `docker compose -f docker-compose.prod.yml up -d web worker`.

## Redeploy
Push to `main` → the pipeline pulls the new `:${sha}` and `up -d` (migrations re-run idempotently).

## Rollback
```bash
cd /opt/q-records-storemanager
IMAGE_TAG=<previous-good-sha> docker compose -f docker-compose.prod.yml up -d web worker
```

## Backup (follow-up, recommended)
```bash
docker exec qrsm-db pg_dump -U postgres qrecords | gzip > qrecords-$(date +%F).sql.gz
```
