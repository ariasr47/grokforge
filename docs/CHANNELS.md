# Forge channels — Prod vs Dev (dogfood Forge-on-Forge)

Goal: run a **stable daily Prod** build while you **develop the next version** in the monorepo (eventually with **Forge Code** itself), without clobbering auth, sessions, or ports.

## Recommendation: **two channels** (not three)

| Channel | When to use |
|---------|-------------|
| **PROD** | Brother dogfood, your daily Chat, “it just works” |
| **DEV** | Building features, running monorepo, dogfooding Code on this repo |

**TST** is optional: use `GROKFORGE_CHANNEL=tst` (same isolation as DEV — port 8788 + `~/.grokforge-dev`). Prefer git branches + DEV rather than a third install unless you need a frozen QA build.

---

## Isolation matrix

| | **PROD** | **DEV** |
|--|----------|---------|
| **Product name** | Forge | Forge Dev |
| **Windows id** | `dev.grokforge.shell` | `dev.grokforge.shell.dev` |
| **Host port** | `8787` | `8788` |
| **Vite UI (web)** | `5173` | `5174` |
| **Data dir** | `%USERPROFILE%\.grokforge` | `%USERPROFILE%\.grokforge-dev` |
| **Window title** | Forge | Forge Dev · DEV |
| **Topbar badge** | (none) | **DEV** chip |
| **Banner strip** | (none) | Full-width **DEV** bar under the top (port + data path) |

Both can run **side by side** (different ports + app ids + data).

---

## Commands

### Daily stable (Prod host only / install later)
```bash
npm run host:prod          # host :8787 → ~/.grokforge
npm run build:prod         # NSIS installer for "Forge"
```

### Develop next version (default desktop)
```bash
npm run desktop            # same as desktop:dev
npm run desktop:dev        # Tauri "Forge Dev" + channel env
npm run host:dev           # host :8788 → ~/.grokforge-dev
npm run build:dev          # optional side-by-side installer "Forge Dev"
```

### Run both side-by-side
```bash
npm run desktop:prod       # window title: Forge  (no banner)
npm run desktop:dev        # window title: Forge Dev · DEV + cyan DEV banner
# or: npm run desktop:both
```
Dev uses a separate cargo target (`.cargo-target-dev/`) so Windows does not lock the Prod binary.

### Web shell (no Tauri)
```bash
npm run desktop:web        # prod ports
npm run desktop:web:dev    # dev channel ports
```

### Env overrides
```bash
set GROKFORGE_CHANNEL=dev
set GROKFORGE_PORT=8788
```

---

## Dogfood path: build Forge with Forge Code

1. **Install / keep** a **Prod** build for Chat (brother + you).  
2. Open monorepo in **Forge Dev** → mode **Code** → workspace `C:\Dev\grokforge`.  
3. Use Prod for personal work; Dev for engineering (never point both at the same host port).  
4. When Dev is stable: `npm run build:prod` → install over Prod → bump version in `package.json` / `tauri.conf.json`.

---

## Version discipline

| Piece | Where |
|-------|--------|
| Semver | root `package.json`, `apps/shell/package.json`, `tauri.conf.json` |
| Channel | env + Tauri merge config `tauri.conf.dev.json` |
| Health | `GET /api/health` returns `channel`, `port`, `dataDir` |

Ship **Prod** installers only from `main` (or release tags). Run **Dev** from working tree anytime.

---

## Files

| Path | Role |
|------|------|
| `apps/host/src/channel.ts` | dataDir / port / label |
| `apps/shell/src-tauri/tauri.conf.json` | Prod identity |
| `apps/shell/src-tauri/tauri.conf.dev.json` | Dev identity merge |
| `scripts/tauri-dev.mjs` | channel-aware Tauri dev |
| `scripts/tauri-build.mjs` | channel-aware installer |
| `scripts/run-host.mjs` | channel-aware host |

---

## Checklist before brother dogfood (Prod)

- [ ] `npm run build:prod` succeeds  
- [ ] Installer product name **Forge** (not Grok Code Shell)  
- [ ] Icon transparent + large  
- [ ] Sign-in works on `~/.grokforge`  
- [ ] Chat default; Connectors visible  
- [ ] Dev monorepo still uses `npm run desktop:dev` without killing Prod host on 8787  
