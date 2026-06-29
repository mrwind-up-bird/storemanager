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

  // ── Pool / timeouts ───────────────────────────────────────
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(10_000),
  DB_IDLE_TX_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(10_000),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Validated environment variables. Throws a ZodError at module-load time (boot) if any
 * required key is absent or fails validation — this is intentional "fail-closed on boot".
 */
export const env: Env = envSchema.parse(process.env);

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
