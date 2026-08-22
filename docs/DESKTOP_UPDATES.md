# Desktop updates, CSP, and summon shortcut

Forge’s packaged WebView now ships a Content Security Policy (no Google Fonts, no `csp: null`). Geist is bundled from `@fontsource-variable`.

## Auto-update

- Public key lives in `apps/shell/src-tauri/tauri.conf.json` (`plugins.updater.pubkey`).
- Private key is **not** in git. Keep `.tauri/updater.key` local (or `TAURI_SIGNING_PRIVATE_KEY`).
- Endpoint: GitHub `releases/latest/download/latest.json`.
- `createUpdaterArtifacts` stays false in `tauri.conf.json` so a key-less `build:prod` still works. `scripts/tauri-build.mjs` turns artifacts **on** when `.tauri/updater.key` is present (writes a merged config).
- CSP `connect-src` is the channel port ladder plus GitHub updater hosts — not `127.0.0.1:*`.
- In Settings: **Check for updates**. Packaged launches also check once. Ctrl+Alt+F focuses the window.
- WebView errors go to `recentCrashes()` (diagnostics) and `tauri-plugin-log` (`forge.log` under the OS log dir).
