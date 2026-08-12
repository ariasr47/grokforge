# Desktop self-host — packaging path

**Goal:** Double-click install works without cloning `C:\Dev\grokforge`.

## Current state (2026-08-11)

| Path | Status |
|------|--------|
| Tauri `ensure_host` spawns monorepo `apps/host/src/index.ts` via tsx | Dev works |
| `GROKFORGE_ROOT` / walk-up for monorepo | Works for dogfood |
| Packaged `resources/agents/grok-acp/index.js` | **Supported by agent spawn resolver** |
| Env `GROKFORGE_AGENT_ENTRY` | Override for CI/packaging |
| NSIS installer | Exists under `apps/shell/src-tauri` |

## Packaging checklist (toward monetization / beta)

1. **Build host + agent for production**
   ```bash
   npm run build --workspace @grokforge/grok-acp
   npm run build --workspace @grokforge/host
   ```
2. **Bundle into Tauri resources**
   - Copy `packages/grok-acp/dist/**` → `src-tauri/resources/agents/grok-acp/`
   - Copy host entry as `resources/host/index.js` (or keep spawning compiled host)
3. **Set at runtime**
   - `GROKFORGE_ROOT` = resource dir or app data
   - `GROKFORGE_AGENT_ENTRY` = absolute path to bundled agent
4. **Tauri spawn** (next code change): prefer resource paths before monorepo walk-up
5. **Smoke after install**
   - `GET /api/health` ok
   - Chat mode prompt without workspace
   - Code mode open folder + tools confine

## Agent registry

Host exposes `GET /api/agents`. Only `grok-acp` is `ready`. Codex/Claude are `planned` — shell UI already lists them disabled.

## Auth for install users

- Prefer **Sign in with Grok** (OAuth device code / sub pool)
- API key field is **backup only**
- Tokens under `~/.grokforge` — never in install tree
