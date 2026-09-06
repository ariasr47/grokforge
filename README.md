# Grok Code Shell

Local coding agent for Grok — open a repo, chat, approve tools, review diffs.

```
Desktop window  →  Host :8787 (prod) / :8788 (dev)  →  grok-acp  →  xAI + workspace tools

**Channels:** see [`docs/CHANNELS.md`](docs/CHANNELS.md) — **Prod** (stable) vs **Dev** (side-by-side dogfood / build Forge in Forge).
```

## Load the app

### Installed (release)

Installer (built):

```text
apps\shell\src-tauri\target\x86_64-pc-windows-msvc\release\bundle\nsis\Forge_*_x64-setup.exe

# Dev (side-by-side)
npm run desktop:dev
# or install: npm run build:dev → "Forge Dev"
```

Or run the portable exe:

```text
apps\shell\src-tauri\target\x86_64-pc-windows-msvc\release\grok-code-shell.exe
```

> Host still needs the monorepo (Node + `apps/host`) on this machine — set `GROKFORGE_ROOT=C:\Dev\grokforge` if the app can’t find the repo.

### Dev

```powershell
cd C:\Dev\grokforge
npm install
npm run desktop
```

> [ripgrep](https://github.com/BurntSushi/ripgrep) (`rg`) on PATH is recommended. `rg` is one of the two allowed fixed-inspection commands, so without it in-app `rg` inspections fail to spawn and one `@grokforge/grok-acp` boundary test skips — `npm test` still passes, but the skip is printed with its reason.

### First-time flow (in-app)

1. **Open folder…**  
2. **Sign in with Grok** (or API key in Settings)  
3. Ask Grok about the repo  

### Fallbacks

```powershell
npm run desktop:web   # Edge/Chrome app window
npm run dev           # Browser + host
```

## Auth

1. `XAI_API_KEY`  
2. `%USERPROFILE%\.grokforge\config.json`  
3. OAuth `%USERPROFILE%\.grokforge\oauth.json`  
4. Grok Build `~/.grok\auth.json`  

## Scripts

| Command | Purpose |
|---------|---------|
| **`npm run desktop`** | **Primary — Tauri desktop app** |
| `npm run desktop:web` | Edge/Chrome app-mode fallback |
| `npm run desktop:tauri:build` | Release installer build |
| `npm run dev` | Browser + host |
| `npm run start` | Host only |
| `npm test` | Unit tests |

## Layout

```
apps/host/     Node host (API, WS, OAuth, pick-folder, agent)
apps/shell/    React UI + optional Tauri
scripts/desktop.mjs
```
