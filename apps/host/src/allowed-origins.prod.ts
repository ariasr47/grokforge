/**
 * PROD-channel origin allowlist. Copied to the generated `allowed-origins.ts` by
 * scripts/gen-allowed-origins.mjs at packaging time (SPEC §2.7 rule 4).
 *
 * The packaged asset origin ONLY. `http://tauri.localhost` is what the packaged WebView sends on
 * /api/* and on the /ws upgrade alike (observed, SPEC §2.7). Exact-string enumeration: no regex,
 * no prefix rule, no port range. Adding a dev origin here is a shipped security defect and is
 * caught independently by the staged-artifact grep (AC-S4).
 */
export const ALLOWED_ORIGINS: readonly string[] = ["http://tauri.localhost"];
