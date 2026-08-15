/**
 * DEV-channel origin allowlist (SPEC §2.7 rule 4). The packaged asset origin plus the shell's own
 * dev-server cross-product, which fixes the currently-failing dev-channel origin (`:5174`, and the
 * `127.0.0.1` spellings) named in the BRIEF. Never copied into a prod build.
 */
export const ALLOWED_ORIGINS: readonly string[] = [
  "http://tauri.localhost",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5174",
];
