# Product roadmap — Forge (ACP desktop agent shell)

**Author voice:** Product (proposal after 0.6.6)  
**Date:** 2026-08-27  
**Status:** Proposal for operator review — not a GATE I sequence until a slice is chosen  
**Grounding:** Forge **v0.6.6** is published. Code uses vendor `grok agent stdio` when the CLI resolves. Chat stays grok-acp. Windows current-user installer ships. Authenticode is still unsigned. Mac is not started.

This file is the living **version ladder**.  
Long-term identity: `docs/VISION.md`.  
Groomed epics: `docs/EPICS.md`.  
Daily pick: `.spire/clusters/tech/context/BACKLOG.md`. Standing rules: `PROJECT_CONTEXT.md`.

---

## 0. How this version was formed (five rounds)

1. **What is true now.** 0.6.6 is a working Grok desktop for the operator: Chat + Code, Plan → File changes → Verify → Git review, live thought/words/tools/answer, Skills / Child agents / Browser chrome, Review / Trusted / Bypass. Other people still hit an unknown-publisher installer and no Mac.
2. **Where the market sits.** Daily coding is Cursor/Copilot (IDE). Terminal-first agents are Claude Code and Grok Build’s TUI. Desktop command centers are Claude Desktop and the Codex app (parallel agents, in-app editor/terminal/preview, computer use). xAI’s own ACP path is `grok agent stdio` — Forge is already that host, not a second TUI.
3. **What “next major” should mean.** Not more Code chrome. Not 1.0-by-declaration. The missing product is *someone else can run it*.
4. **What the major after that should mean.** Once a second human can install, 1.0 is *daily Grok desktop*: vendor-complete GUI (MCP/skills/hooks stay Grok’s; Forge shows them), capable Chat, Mac.
5. **What we refuse.** IDE clone, TUI skin, computer use, iOS Simulator, classifier auto-mode, cloud fleets, a Forge-built skills/MCP engine, a second non-ACP chat stack.

---

## 1. Product thesis

**Forge** is an **ACP-native desktop shell** (Chat + Code): local-first tools, permissions, diffs, policy. The GUI is Voidglass. The Code engine is the vendor Grok agent. grok-acp is Chat plus honest fallback.

**Wedge:** Claude and OpenAI already have Code/desktop surfaces. **Grok’s official surface is a TUI.** Forge is the Grok desktop that is not a terminal.

**Not forever Grok-only.** The north star is still “any ACP agent, same chrome.” That is the major *after* 1.0.

### Positioning (do not blur)

| Kind | Examples | Forge is |
|------|----------|----------|
| AI editor | Cursor, Windsurf, Copilot | **No** — no LSP, no in-app file editor, no pixel-parity |
| Terminal agent | Claude Code CLI, Grok TUI | **No** — not a TUI skin |
| Desktop command center | Claude Desktop, Codex app | **Cousin** — Chat + Code, inspect, approve. We do not take their IDE panes or computer use |
| ACP host GUI | Zed/JetBrains ACP, Forge | **Yes** — `grok agent stdio` in Voidglass |

xAI documents three Grok Build modes: interactive TUI, headless `-p`, and **ACP** (`grok agent stdio`). Forge owns the third.

### Pillars

| Pillar | Meaning now |
|--------|-------------|
| **ACP-native** | Host + UI are agent-agnostic; Code’s Grok engine is vendor ACP; grok-acp is Chat/fallback |
| **Subscription-first auth** | Pooled sub preferred; API key backup |
| **Local-first** | Secrets, workspaces, journals on-device |
| **Dual surface** | Chat (everyone) + Code (repo agent) — one protocol, two profiles |
| **Forge owns the GUI** | Voidglass, not a terminal dump; vendor decides when to think/tool/ask |
| **Lean & fast** | Performance and config depth are product features |
| **Trust is the moat** | Confine, staged writes, Review/Trusted/Bypass, diagnostics |

**Working brand (open):** repo *grokforge* / *Grok Code Shell*; product **Forge**. Rebrand still an operator decision.

---

## 2. Principles (non-negotiable)

1. **Lean before featureful** — every slice must change an observable daily decision.
2. **Performance is a product feature.**
3. **Configurable, not complicated** — Settings / files; brother-class users never need Level 2.
4. **Trust is the moat** — Review/Trusted/Bypass stay; never YOLO-only Code.
5. **Monetize the shell, not tokens.**
6. **ACP forever** — no second chat stack; new providers = new ACP agents.
7. **Do not grow grok-acp into a Grok Build clone** (skills engine, subagents, MCP host, xhigh harness). Ride the vendor agent.
8. **Wedge discipline** — Grok excellence before multi-agent.

---

## 3. Personas & jobs

| Persona | Job | Success |
|---------|-----|---------|
| **P1 Developer** | Local Grok coding agent on a real repo | Weekly Code sessions; accepted diffs without opening the TUI |
| **P2 Knowledge worker** | Everyday Chat: notes, email, EN↔JA, outlines | A week of Chat without the operator present |
| **P3 Team lead** | One desktop agent policy | Install + policy pack (after 1.0) |
| **P4 Security / IT** | Audit, signed deploy, no shadow AI | Pilot packet (after 1.0) |
| **P5 Power admin** | MCP, allowlists, later multi-agent | Config reuse |

P1 and P2 are the 0.7 / 1.0 audience. P3–P5 wait.

---

## 4. What 0.6.6 already is

Shipped and published:

- Windows current-user NSIS installer (unsigned)
- Chat \| Code on one ACP path
- Code: vendor `grok agent stdio` when CLI resolves; grok-acp fallback with honest chrome
- Live Thought / mid-turn words / one tool rail / vouched Answer
- Plan → File changes → Verify → Git review
- Skills palette (`/`), Child agents, Browser (fetch-class) in Forge chrome
- Named Chat home + pinned pack; PDF text extract
- Review / Trusted / Bypass; Trusted command classes; confined delete/rename
- Appearance-aware fenced code
- Auto-update *channel* exists (`latest.json`); Authenticode does not

**Still not true:**

- A second human can install without an unknown-publisher scare (cert) or the operator in the room (walkthrough)
- Mac
- Chat uses the vendor engine (Chat is mini-Grok by design)
- Forge-visible vendor worktrees (TUI has them; we now show children/skills/fetch/MCP/hooks)
- Artifacts panel / Mermaid
- Extra ACP agents (Codex, Claude)

---

## 5. Competitive gap (research, 2026-08)

Sources: xAI Grok Build docs (`grok agent stdio`, skills, MCP, subagents, worktrees); Claude Code Desktop (Chat / Cowork / Code, parallel sessions, in-app editor/terminal/preview, Artifacts, computer use, iOS Simulator); Codex app (parallel threads, worktrees, Windows sandbox, computer use); ACP registry + v2 *draft* (2026-07); Cursor as the IDE default.

| Capability | Grok TUI | Claude Desktop | Codex app | Forge 0.6.6 |
|------------|----------|----------------|-----------|-------------|
| Vendor coding engine | yes | Claude | Codex harness | **yes (Code)** |
| Desktop GUI | no | yes | yes | **yes** |
| Plan / diffs / approve | yes | yes | yes | **yes** |
| Skills / slash | yes | yes | yes | **Code palette** |
| Child / parallel agents | worktrees | desktop redesign | threads + worktrees | **visible roster, not our workers** |
| Browser / fetch | yes | Chrome + preview | in-app browser | **fetch list, not WebView** |
| MCP | vendor | connectors | shared MCP | **visible list, not a Forge host** |
| Hooks / plugins | yes | — | — | **visible list, not a Forge engine** |
| Artifacts / big docs | — | Artifacts (paid) | files/preview | **bubble only** |
| Signed install / Mac | n/a | yes | Mac then Windows | **Windows unsigned; no Mac** |
| Computer use / iOS sim | — | yes | yes | **anti-goal** |

**Implication:** do not spend the next major cloning Desktop/Codex panes. Spend it on (1) other people can run Forge, (2) the vendor engine’s remaining *visible* work (MCP, hooks, worktrees) in Voidglass, (3) Chat that a non-dev will keep.

---

## 6. Version ladder (concrete)

Semver stays `0.y.z` until 1.0. Product “majors” below are *eras*, not a promise to skip minors.

| Era | Name | One-liner | Exit |
|-----|------|-----------|------|
| **Now** | **0.6** Dogfood Grok desktop | Operator uses Code on the vendor engine | **Met** — v0.6.6 |
| **Next major** | **0.7** Shareable Grok desktop | A second human installs and completes a Chat week; Code still works | Unsigned warning is honest *or* gone; walkthrough evidence; first-run does not strand |
| **Major after that** | **1.0** Daily Grok desktop | P1 does not open the TUI for hard jobs; P2 stays in Chat; Mac exists | Vendor MCP/hooks/worktrees inspectable; Artifacts; Mac; brand frozen |
| **After 1.0** | **2.0** ACP platform | Same chrome, other agents + team policy | Codex/Claude ACP; SSO/audit; still no IDE |

Monetization experiments only after 1.0 retention, not inside 0.7.

---

## 7. Next major — **0.7 Shareable Grok desktop**

**Job:** someone who is not the operator can install Forge on Windows and finish a real Chat week.

### In

| Slice | Observable outcome | Notes |
|-------|--------------------|--------|
| **Honest installer** | Brother (or any second human) gets a current-user setup whose publisher story is true | **A.** Authenticode when a cert exists. **B.** If the cert never comes: SHA-256 + “unknown publisher is expected” in first-run / notes — never pretend it is signed |
| **First-run** | Fresh profile: appearance Voidglass, Chat ready, sign-in obvious, Code explains “install Grok CLI” instead of failing mute | Uses existing `voidglass-default` / `grok-acp-fallback` |
| **Walkthrough evidence** | The deferred `desktop-self-host` human/clean-machine rows either close or stay explicitly deferred | Operator hold remains until they lift it |
| **Update path** | 0.6.x → 0.7 via `latest.json` without cloning the repo | Already wired; prove it on a 0.6.5 machine |
| **Installer hygiene** | Product name **Forge**, icon, current-user, close-before-upgrade copy | Mostly true today; treat misses as 0.7 bugs |

### Out of 0.7

- Mac (Windows-first stays unless operator overrides)
- Artifacts / Mermaid
- Vendor MCP / hooks chrome (1.0 skip-ahead; shipped 2026-08-27, uncommitted)
- Forge MCP host
- Extra ACP adapters
- Billing UI
- Computer use, iOS Simulator, in-app editor

### Blockers

- **Authenticode:** blocked-on a cert. Do not theater-sign. If 0.7 must ship without a cert, ship path **B** (honest unsigned) as a named slice, not a silent skip.
- **Brother walkthrough:** operator-deferred since 2026-08-15. 0.7’s exit is weaker without it.

### Suggested GATE I order inside 0.7 (when `go` resumes)

1. Honest installer (cert **or** honest-unsigned first-run)  
2. First-run / CLI-missing copy (Code already has fallback chrome — close remaining mute gaps)  
3. Update-path proof on a real 0.6.x install  
4. Walkthrough only if the operator lifts the hold  

Artifacts stay **later than 0.7** unless 0.7 exits early and Chat dogfood is the next pain.

---

## 8. Major after that — **1.0 Daily Grok desktop**

**Job:** P1’s hard jobs stay in Forge; P2’s week stays in Chat; a Mac user can install.

### In

| Slice | Observable outcome | Notes |
|-------|--------------------|--------|
| **Vendor MCP visible** *(shipped 2026-08-27)* | In Code on the vendor engine, MCP servers Grok already has are inspectable in Forge chrome | Same pattern as Skills / Browser: **show, don’t invent**. Not a Forge MCP registry |
| **Hooks / plugins chrome** *(shipped 2026-08-27)* | Lifecycle hooks and plugins the vendor advertises are visible or honestly absent | Do not build `skills-and-hooks` as a second engine |
| **Worktree / isolation honesty** | If the vendor puts a child in a worktree, Forge shows that identity; Forge still does not spawn worktree workers | `isolated-workers` stays parked as *our* workers |
| **Artifacts panel** | Large Chat/Code outputs (docs, long grok-ui) sit beside the bubble | From `RICH_DISPLAY_15_ROUNDS_REPORT.md`; not a PPT clone |
| **Mermaid (optional)** | Fenced mermaid renders or stays honest plain | After Artifacts; syntax-themes already refused a clone highlighter |
| **Mac desktop** | Current-user Mac install; Windows remains first-class | Phase 1 Windows-first lifts here |
| **Chat capability** | P2 week without Code: attach, pack, PDF, rich display, Artifacts | Chat stays grok-acp until there is a *product* reason to put Chat on `grok agent` (not day one of 1.0) |
| **TUI handoff (optional)** | From Grok TUI, open this session in Forge (Claude `/desktop`, Codex `/app`) | Only if vendor/deep-link exists; do not fake it |

### Out of 1.0

- Codex / Claude adapters (`grok-first` until 1.0 is loved)
- Team SSO / MDM / SIEM
- Forge-built MCP marketplace
- Full IDE (LSP, debug, rich git)
- Classifier auto-mode, cloud fleets, computer use, iOS Simulator

### Why this is 1.0, not 0.8

0.7 makes the binary shareable. 1.0 makes the *product* the place you work. Shipping Mac + vendor MCP chrome + Artifacts under another 0.6.x patch would hide the step change.

---

## 9. After 1.0 — **2.0 ACP platform** (do not start now)

| Theme | Outcome | Lean rule |
|-------|---------|-----------|
| Extra ACP agents | Codex / Claude Code behind the same Chat/Code chrome | After Grok daily-use is real |
| Per-agent auth | Each provider: sub preferred, API backup | No seat proxy |
| Team policy | File- or MDM-deployed allowlists, model caps | Admin console later |
| Audit export | JSON lines, local, optional SIEM | Append-only |
| Optional SSO | App login, not a new IdP | Don’t re-implement identity |
| Silent MSI / MDM | Windows enterprise deploy | After signed 0.7/1.0 |
| Monetize shell | Personal $0; Pro/Team for policy/ops | Never resell tokens |
| ACP v2 | Track the July 2026 **draft**; adopt when stable | Do not rewrite the host for a draft |

**MCP host (Forge-built registry)** stays blocked on “installer honest” *and* on “ride vendor MCP first.” A Forge MCP engine is only if Chat needs connectors the vendor will not carry.

---

## 10. Configurability

| Level | What | Who |
|-------|------|-----|
| **0 Defaults** | Chat/Code, Auto effort, Voidglass, Review | Everyone |
| **1 Settings** | Model, effort, theme, density, Trusted classes, diagnostics | Power users |
| **2 Files** | `config.json`, workspace policies, Trusted class lists | Admins |
| **3 Managed** | MDM / enterprise lock | IT (2.0) |

---

## 11. Performance budgets (unchanged contracts)

| Surface | Budget |
|---------|--------|
| Cold start to interactive UI | &lt; 3 s on a mid laptop |
| Host ready | &lt; 2 s after UI |
| Mode switch | &lt; 500 ms to usable chrome; agent restart may lag with spinner |
| Token stream | Composer stays typable; batch, don’t block |
| Session list | 500 chats without lag (virtualize when needed) |

---

## 12. Near-term sequence (when the hold lifts)

```text
0.6.6     Published. Pipeline hold until cert, Mac override, or go-with-evidence.
0.7       Honest installer → first-run → update-path proof → walkthrough if lifted
1.0       Vendor MCP/hooks visible → Artifacts → Mac → optional TUI handoff
2.0       Other ACP agents + team policy  (only after 1.0 is used weekly)
```

**GATE I alignment (BACKLOG §B):**

1. Honest Windows installer (cert or honest-unsigned)  
2. First-run / update-path (0.7)  
3. Mac (1.0, unless operator overrides Windows-first)  
4. Artifacts panel (1.0 quality)  
5. Vendor MCP visible (1.0; not a Forge MCP host)

Parked until 1.0+ : skills-and-hooks *engine*, isolated-workers *we* spawn, os-sandbox, extra ACP adapters, mcp-host registry, billing.

---

## 13. Risks & anti-goals

| Risk | Mitigation |
|------|------------|
| Becoming a mini-IDE | No LSP/debug/in-app editor in 0.7/1.0 |
| Becoming a TUI screenshot | `forge-owns-gui`; show vendor work, don’t paste a terminal |
| Building a second Grok engine | grok-acp stays Chat/fallback; no skills/MCP/subagent engine in grok-acp |
| Unsigned forever | Honest-unsigned is an explicit 0.7 path, not a pretend signature |
| Draft ACP v2 churn | Stay on negotiated v1 until v2 is stable |
| Enterprise bloat before PMF | File policy before admin consoles |
| Seat proxy | Single-user; no multi-human SuperGrok share |

**Anti-goals unless strategy changes:** scrape grok.com · share one SuperGrok · cloud agent farm · Electron rewrite · classifier auto-mode · iOS Simulator · computer use · marketplace of random models day one · pixel-parity with Claude/Codex UI

---

## 14. Decisions still needed from the operator

1. **0.7 without a cert:** **locked operator A 2026-08-27** — honest-unsigned first-run (`honest-unsigned-first-run`). S2 Authenticode stays later.  
2. **Brand:** keep Forge, or “Grok Desktop”?  
3. **Open core:** host/protocol later?  
4. **Mac:** stay Windows-first through 0.7, or pull Mac into 0.7?  
5. **Chat engine:** keep Chat on grok-acp through 1.0, or move Chat to `grok agent` once Code is loved?  
6. **First paid tier:** Pro individual vs Team-first (after 1.0 only)

---

## 15. Summary

| Question | Answer |
|----------|--------|
| **What is the product?** | ACP-native desktop shell (Chat + Code). Voidglass GUI. Grok vendor engine in Code. |
| **Why Grok now?** | TUI exists; Claude/OpenAI already have desktops; we have a pool sub |
| **Where are we?** | 0.6.6 dogfood Grok desktop, Windows unsigned |
| **Next major (0.7)?** | Shareable: honest installer + first-run + a second human |
| **Major after that (1.0)?** | Daily Grok desktop: vendor MCP/hooks visible, Artifacts, Mac |
| **After 1.0?** | Other ACP agents + team policy; monetize the shell |
| **Money?** | Charge for client + policy + support; never for tokens |

*Proposal. Promote slices into BACKLOG / GATE I as the operator chooses.*
