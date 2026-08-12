# Idle autonomous queue (agent self-improvement)

> Work that **does not need operator decisions** while dogfooding continues.
> Prefer correctness → reliability → tests → perf → a11y polish → product readiness.
> Product identity: **ACP-native desktop agent shell** (Grok-first wedge).

**Last refreshed:** 2026-08-11 (8-round product loop)

## Standing rule

Keep shipping from this queue during dogfood. Prefer automation over asking humans to re-test.

## 8-round loop (completed)

| Round | Outcome |
|-------|---------|
| R1 | Playwright e2e (`npm run e2e`) — boot, mode, palette, composer |
| R2 | Host contract suite + sessionIO/firstRun unit tests |
| R3 | Auth hierarchy: sub pool preferred, API key backup |
| R4 | ACP agent registry API + settings UI (Grok ready; Codex/Claude planned) |
| R5 | Desktop self-host docs + Tauri resource host/agent spawn path |
| R6 | Audit JSONL + busy watchdog + tool payload caps |
| R7 | Dual-mode onboarding (Chat without folder) |
| R8 | policy.json + monetization readiness doc + verify:full |

## Commands

```bash
npm run verify           # typecheck + unit
npm run verify:full      # + host-contract + gate-q
npm run e2e              # UI (host :8787 + vite :5173)
```

## Next (toward money / adoption)

1. Finish packaging: copy dist → `src-tauri/resources/{host,agents}` in tauri build script
2. Signed installer + update channel
3. MCP host (Phase 2) after self-host
4. License / Pro tier (only after PMF)
5. Dedup host event handlers
6. Expand e2e: permission card, send mock prompt, offline reconnect

## Explicit non-goals while Phase 0–1

Paywalling basic Chat · reselling pool tokens · multi-tenant hosted agents · inventing empty-state marketing
