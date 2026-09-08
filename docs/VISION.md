# Forge — long-term vision

**Date:** 2026-08-27  
**Status:** Proposal (operator has not locked this file). Versions live in `docs/PRODUCT_ROADMAP.md`. Groomed work lives in `docs/EPICS.md`. Daily pick lives in `BACKLOG.md`.

This is the house-with-guests bet, written as a product we can still recognize in five years.

---

## 1. One sentence

Forge is the **desktop house** for coding and capable chat: Voidglass chrome, our trust rules, any ACP guest. Grok is the first guest, not the walls.

---

## 2. Why this exists

Claude already has a terminal agent and a desktop. OpenAI already has Codex CLI, IDE, web, and a desktop app. Grok’s official coding surface is a **TUI** plus headless plus `grok agent stdio`.

The gap is not “another Grok.” It is **a Grok desktop that is not a terminal**, that keeps ask-before-edit, and that can later invite Codex or Claude into the same window.

If we invent a second Grok brain, we compete with xAI on their home ground forever. If we become a skin on their TUI, we throw away the house and the multi-agent story. **Good A** is the only path that stays a product.

---

## 3. Direction we already took (do not re-litigate)

Read this as the last six weeks of operator rulings, not as a new strategy.

| When | Turn | What it locked |
|------|------|----------------|
| Mid Aug | Dual-mode before self-host | Chat \| Code on one ACP path first; packaging second |
| Mid Aug | Loop quality, not feature count | Plan → File changes → Verify → Git review before connectors |
| 23–25 Aug | Brother / Chat | Named home + pack, PDF extract — Chat is a product, not a leftover tab |
| 25 Aug | **Option A (good A)** | Forge owns GUI. Code uses vendor `grok agent stdio`. grok-acp is Chat + fallback. Review/Trusted/Bypass stay. Not a TUI skin. Do not grow grok-acp into a skills/MCP/subagent engine |
| 25–26 Aug | Stream before spawn | Public ACP-shaped live kinds first; then actually spawn `grok agent` |
| 26 Aug | Vendor work visible | Skills, Child agents, Browser are **Forge chrome over vendor facts**, not a second Chrome and not decorative Sidebar theater |
| 26 Aug | A-pool drained | No more Option A slices until a cert / Mac override / new evidence |
| 27 Aug | 0.6.6 | The Option A wave is published, still unsigned |
| 27 Aug | Roadmap refresh | Next *era* is shareable (0.7), then daily Grok desktop (1.0), then ACP platform (2.0) |

Failed futures we already named:

1. **Bad A** — Forge is a terminal in a window. Trust rules gone. Grok-only forever.  
2. **Option B** — we keep writing mini-Grok until the TUI is unreachable.  
3. **IDE clone** — LSP, in-app editor, iOS Simulator, computer use, pixel-parity.

---

## 4. The house / guest split (permanent)

This is the operating model. Every epic is “draw a guest” or “keep the house.” Mixing the two is how we get a second engine.

### The house (Forge owns forever)

| Surface | Why it is ours |
|---------|----------------|
| Voidglass window, Chat \| Code, composer, dock | Display is the product |
| Review / Trusted / Bypass mapped onto guest permission prompts | Moat vs YOLO terminals |
| Plan, File changes, Verify, Git review | Inspect what *happened*, independent of whose brain |
| Named Chat home + pack | P2 product; not a coding-agent storage model |
| Journals, replay, one live parent ACP run per session | Honesty under cancel/reload |
| “Thought is not the answer” | Guest may think; we never promote it |
| Installer, update, first-run, diagnostics | What’s in the box |

### The guest (vendor owns the brain)

| Power | Forge’s job |
|-------|-------------|
| Model, tools, skills, MCP, hooks, plugins | **Show** what the guest advertises; never invent a catalog |
| Subagents / worktrees | **Show** identity + status; do not spawn our own workers |
| Browser / fetch | **Elevate** vouched fetch-class work; not a WebView clone |
| When to think / tool / ask | Guest decides; we draw it |
| Missing guest | Honest grok-acp fallback; never pretend vendor |

**Guest-completeness test:** if the Grok TUI can do X, Forge either shows X from the vendor wire or says it is absent. Faking X on grok-acp is a defect.

**Reversible door:** starting the vendor is one spawn line. Mini-Grok stays. Private `thinking_delta` / `tool_run` slang is not FE↔BE truth. Public ACP kinds are.

---

## 5. Dual engine is a feature

| Mode | Engine | Why |
|------|--------|-----|
| **Code** | In-house **grok-acp** (vendor `grok agent stdio` retired in Forge Code — operator ruling 2026-08-30, `docs/ACP_CODE_GOAL.md`) | We own the coding loop: Review diffs, shell, confinement. Do not spawn `grok.exe` for Code. |
| **Chat** | grok-acp | Homes, packs, PDF, brother-class use — do not dump Chat into a coding agent |

Moving Chat onto `grok agent` is a **1.0+ product decision**, not an implementation convenience. Until then, Chat must not grow a fake Skills/MCP/Child/Browser catalog.

---

## 6. Horizons

| Horizon | We are this |
|---------|-------------|
| **Now (0.6.7 source)** | The operator’s Grok desktop. Unsigned Windows. Chat and Code are grok-acp. Published box is still 0.6.6 until `release`. |
| **~2 quarters (0.7)** | A second human can install without us in the room. Publisher story is true (signed *or* honest-unsigned). First-run does not strand. |
| **~1 year (1.0)** | P1 does not open the TUI for hard jobs. P2’s week stays in Chat. Mac exists. Remaining guest powers (worktrees / TUI handoff) are visible or honestly absent. Artifacts exist so Chat does not drown in the bubble. |
| **2–3 years (2.0)** | Same house, new guests (Codex, Claude). File-based team policy. Still not an IDE. |
| **5 years** | “ACP desktop” is the category people name. Forge is a client they trust with Review/Trusted and their own provider seat. We still do not run inference, do not resell tokens, do not share one SuperGrok. |

Money stays: **license the house**, never the guest’s tokens. Personal free; Pro/Team only after 1.0 is used weekly.

---

## 7. How we choose work

1. Does this keep the house, or draw a guest? If neither, it is probably an IDE clone or a second engine — cull.  
2. Can a human observe the outcome without reading code? If not, it is not a slice.  
3. Does it fight a promoted invariant? Reshape or cull.  
4. Distribution before new chrome when the binary cannot leave this machine honestly.  
5. Ride the vendor before building a Forge engine for the same noun (skills, MCP, workers).

---

## 8. What success feels like

- **P1:** A hard repo job finishes in Forge. Skills, children, fetch, and MCP the guest actually used are on screen. Diffs settle in the dock. The TUI was not required.  
- **P2:** A week of Chat (mail, notes, EN↔JA) with a named home and a pack, without the operator. Large answers open beside the bubble, not as a wall.  
- **P3 (later):** A policy file and a signed install are enough to try a team. No seat-proxy of SuperGrok.

---

## 9. Related

- Ladder: `docs/PRODUCT_ROADMAP.md`  
- Groomed epics: `docs/EPICS.md`  
- Option A decision page: `docs/agent-strategy.html`  
- Standing rules: `.spire/clusters/tech/context/PROJECT_CONTEXT.md`
