/**
 * Single source of truth for the default tenant brand accent.
 *
 * `#E8552E` is the coral-500 design token. It passes WCAG AA — contrast ≈ 5.19:1
 * against #111111 (dark text wins) — so `assertAccessibleAccent()` accepts it.
 *
 * This is a plain constant module with NO `server-only` guard so the three call
 * sites that need to agree on the default — the provisioning registry insert,
 * the per-request tenant branding fallback, and the seed script — can all import
 * the same value instead of hard-coding three subtly different "coral" hexes.
 */
export const DEFAULT_PRIMARY_COLOR = '#E8552E';
