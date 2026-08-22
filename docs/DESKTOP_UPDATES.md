# Desktop updates, CSP, and summon shortcut

Forge’s packaged WebView now ships a Content Security Policy (no Google Fonts, no `csp: null`). Geist is bundled from `@fontsource-variable`.

## Auto-update

- Public key lives in `apps/shell/src-tauri/tauri.conf.json` (`plugins.updater.pubkey`).
- Private key is **not** in git. Keep `.tauri/updater.key` local (or `TAURI_SIGNING_PRIVATE_KEY`).
- Endpoint: GitHub `releases/latest/download/latest.json`.
- `createUpdaterArtifacts` stays false so a key-less `build:prod` still works. When you cut a release with the key present, set `"createUpdaterArtifacts": true` for that build so `latest.json` is emitted.
- In Settings: **Check for updates**. Ctrl+Alt+F focuses the window.
