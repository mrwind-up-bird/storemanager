import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // ── Domain ────────────────────────────────────────────────
  ROOT_DOMAIN: z.string().min(1),
  APP_PROTOCOL: z.enum(['http', 'https']).default('http'),
  /** Kept as string — used verbatim in URL construction via tenantUrl(). */
  APP_PORT: z.string().default('3000'),

  // ── Database ──────────────────────────────────────────────
  /** qr_app connection string — runtime role, non-superuser, NOBYPASSRLS. */
  DATABASE_URL: z.string().url(),
  /** qr_owner connection string — migrations, registry writes. */
  DATABASE_OWNER_URL: z.string().url(),
  /** pg-boss connection string — uses qr_owner, manages pgboss schema. */
  PGBOSS_DATABASE_URL: z.string().url(),

  // ── Auth.js ───────────────────────────────────────────────
  AUTH_SECRET: z.string().min(1),

  // ── Encryption (AES-256-GCM) ─────────────────────────────
  /** Base64-encoded 32-byte key. Full byte-length check done by assertEncryptionKey() at boot. */
  // Validated for exactly 32 decoded bytes HERE so every process (web, worker, migrate,
  // seed) fails closed at env load — assertEncryptionKey() remains a library helper but the
  // boot guarantee no longer depends on anyone remembering to call it.
  ENCRYPTION_KEY: z
    .string()
    .refine((v) => {
      try {
        return Buffer.from(v, 'base64').length === 32;
      } catch {
        return false;
      }
    }, 'ENCRYPTION_KEY must be base64 encoding exactly 32 bytes (AES-256)'),
  ENCRYPTION_KEY_ID: z.string().min(1),

  // ── Mail ──────────────────────────────────────────────────
  MAIL_DRIVER: z.enum(['mailpit', 'console']),
  MAIL_HOST: z.string().min(1),
  MAIL_PORT: z.coerce.number().int().positive(),
  // Accept local-domain emails (e.g. noreply@localhost) used in dev/test environments.
  // z.string().email() rejects bare hostnames; the refine covers full RFC domains too.
  MAIL_FROM: z.string().refine(
    (v) => /^[^\s@]+@[^\s@]+$/.test(v),
    'MAIL_FROM must be a valid email address',
  ),
  /**
   * Internal-relay escape hatch. '1' → the mailpit adapter skips STARTTLS and self-signed
   * cert validation (ignoreTLS + rejectUnauthorized:false), for the in-network mailserver hop
   * ONLY. Default '0' — dev/E2E and any real TLS relay are unaffected.
   */
  MAIL_SMTP_INSECURE: z.enum(['0', '1']).default('0'),

  // ── Discogs ───────────────────────────────────────────────
  DISCOGS_CONSUMER_KEY: z.string().min(1),
  DISCOGS_CONSUMER_SECRET: z.string().min(1),
  DISCOGS_API_URL: z.string().url().default('https://api.discogs.com'),
  DISCOGS_USER_AGENT: z.string().min(1).default('QRecordsStoremanager/2.0 +https://q-records.example'),
  DISCOGS_DRIVER: z.enum(['http', 'fake']).default('http'),

  // ── Billing ───────────────────────────────────────────────
  BILLING_DRIVER: z.enum(['fake', 'stripe']).default('fake'),
  /** Pflicht bei BILLING_DRIVER=stripe — geprüft in parseEnv (fail-closed on boot). */
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),

  // ── Embeddings / KI-Suche ─────────────────────────────────
  EMBEDDINGS_DRIVER: z.enum(['fake', 'http']).default('fake'),
  /** Pflicht bei EMBEDDINGS_DRIVER=http — geprüft in parseEnv (fail-closed on boot). */
  EMBEDDINGS_API_KEY: z.string().min(1).optional(),
  EMBEDDINGS_MODEL: z.string().default('text-embedding-3-small'),
  EMBEDDINGS_API_URL: z.string().url().default('https://api.openai.com/v1'),

  // ── Pool / timeouts ───────────────────────────────────────
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(10_000),
  DB_IDLE_TX_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(10_000),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Parse + Cross-Field-Refinement. Bewusst KEIN .superRefine am Schema selbst —
 * das würde envSchema zu ZodEffects machen und bestehende .shape-Zugriffe in Tests brechen.
 * Exportiert für tests/env-billing.test.ts.
 */
export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const parsed = envSchema.parse(source);
  if (parsed.BILLING_DRIVER === 'stripe' && (!parsed.STRIPE_SECRET_KEY || !parsed.STRIPE_WEBHOOK_SECRET)) {
    throw new Error(
      'BILLING_DRIVER=stripe erfordert STRIPE_SECRET_KEY und STRIPE_WEBHOOK_SECRET (src/env.ts).',
    );
  }
  if (parsed.EMBEDDINGS_DRIVER === 'http' && !parsed.EMBEDDINGS_API_KEY) {
    throw new Error('EMBEDDINGS_DRIVER=http erfordert EMBEDDINGS_API_KEY (src/env.ts).');
  }
  return parsed;
}

/**
 * Validated environment variables. Throws at module-load time (boot) if any
 * required key is absent or fails validation — this is intentional "fail-closed on boot".
 */
export const env: Env = parseEnv(process.env);

/**
 * Builds a fully-qualified tenant URL.
 * Omits port when it is the protocol default (80 for http, 443 for https).
 *
 * Example: tenantUrl('demo') → 'http://demo.localhost:3000'
 */
export function tenantUrl(slug: string): string {
  const defaultPort = env.APP_PROTOCOL === 'https' ? '443' : '80';
  const port = env.APP_PORT === defaultPort ? '' : `:${env.APP_PORT}`;
  return `${env.APP_PROTOCOL}://${slug}.${env.ROOT_DOMAIN}${port}`;
}
