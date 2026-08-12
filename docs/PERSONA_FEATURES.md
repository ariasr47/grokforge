# Persona deep dive — Knowledge worker & Developer

**Date:** 2026-08-11  
**Product:** ACP-native desktop shell (Grok-first)

---

## Knowledge worker (brother / Chat)

### Jobs that matter
Email & chat polish · long EN↔JA translation · market research synthesis · slide outlines · clerical lists · recipes · multi-day “projects” with context · local document folders · (later) PDF, calendar, Windows MCP

### Shipped this loop (Chat-facing)
| Feature | Why |
|---------|-----|
| **Attach files as text** (button + drag-drop) | Real content in the turn, not fake `@name` |
| **Export this chat as Markdown** | Take email/translation/summary out of the app |
| **Honest PDF/binary handling** | Clear errors instead of mojibake |
| **Effort tooltips** | Expert/Heavy for long translate & reports |
| **Plain-language permissions** | “Allow saving a file?” not “write” |
| **Brother-safe onboarding/empty states** | No ACP jargon; Chat-first samples |
| **UI→agent history rehydration** | “Remember this project” across restarts |

### Still gaps (priority order)
1. Native PDF text extract  
2. Named projects + pinned context pack UI  
3. `.pptx` / Word export  
4. Glossary memory for long JA work  
5. MCP desktop / calendar  

See `BROTHER_DOGFOOD.md`.

---

## Developer (Code)

### Jobs that matter
Repo Q&A · multi-step fix · staged diffs · shell verify · @file context · monorepo search · git via allowlisted shell

### Shipped this loop (Code-facing)
| Feature | Why |
|---------|-----|
| **@path expands to file body on send** | Fewer wasted tool turns |
| **History rehydration** | Multi-step work survives agent restart |
| **maxTurns 20** (env override) | Longer explore→test→fix loops |
| **Grep walk 1200 / file index 800** | Larger monorepos |
| **Shell allowlist: pwsh, rg, cargo, npm run** | Real Windows + Rust workflows |
| **Binary-safe read_file** | No garbage from PDF/binaries in tools |

### Still gaps
1. Real multi-hunk diffs  
2. Structured test/typecheck panel  
3. Git status/diff tools (beyond shell)  
4. Patch apply robustness  

---

## Architecture note (both personas)

```
UI localStorage transcript ──history on prompt──► grok-acp messages
Attach / @expand ──into user text──► same prompt
```

Without history, Chat looked continuous but the model was amnesiac after mode switch/restart — fixed for new turns.
