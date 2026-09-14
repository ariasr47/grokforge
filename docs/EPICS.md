# Forge — epics (groomed)

**Date:** 2026-08-27  
**Living ladder:** `docs/PRODUCT_ROADMAP.md` (refreshed 2026-09-08 — Code on grok-acp; Gate hunts in §9).  
**Status:** Grooming board. S1 in-flight (`honest-unsigned-first-run`, AC5 waits on next installer). G1, G2, and C1 shipped 2026-08-27.

Legend: **DONE** · **READY** · **BLOCKED** · **DEFERRED** (operator hold) · **PARKED** (later era) · **ANTI** (do not)

Effort: **S** days · **M** a feature pipeline · **L** a version-shaping program

Versions: **0.6.6** published · **0.7** shareable · **1.0** daily Grok desktop · **2.0** ACP platform  
See `docs/VISION.md` (house/guest) and `docs/PRODUCT_ROADMAP.md` (eras).

---

## Map

| Epic | Job | Era | State |
|------|-----|-----|--------|
| **E-HOUSE** | Keep the house | always | standing law |
| **E-LOOP** | Code inspect loop | 0.5–0.6 | **DONE** |
| **E-LIVE** | Live thought / words / tools / fences | 0.6.6 | **DONE** |
| **E-GUEST** | Vendor guest completeness | 0.6.6 → 1.0 | **partial (G1+G2 shipped; G3/G4 blocked-on vendor)** |
| **E-SHARE** | Other people can run it | **0.7** | **in flight (S1; AC 5 waits on next tag)** |
| **E-CHAT** | Capable Chat (P2) | 0.6 → 1.0 | **partial** |
| **E-PLAT** | Mac (and later OS) | **1.0** | not started |
| **E-TRUST** | Deeper confine / secrets | 1.0–2.0 | **PARKED** |
| **E-ACP** | Other ACP guests | **2.0** | **PARKED** (`grok-first`) |
| **E-TEAM** | Team policy + money | after 1.0 | **PARKED** |

---

## E-HOUSE — the house (not a build epic)

**Job:** Forge remains the window and the rules, no matter which guest is in Code.

**In (already law):** Voidglass; Chat \| Code; composer; Action dock; Review / Trusted / Bypass; journals; one parent ACP run per session; thought is not the answer; public ACP kinds; `forge-owns-gui`.

**Out:** TUI skin; YOLO-only Code; growing grok-acp into a second Grok Build.

**Grooming note:** every future BRIEF’s *Invariant watch* starts here. No slice “builds E-HOUSE.”

---

## E-LOOP — Code inspect loop — DONE

Shipped: `plan-mode`, `inspectable-run-changeset`, `structured-test-panel`, `git-review-surface`, `project-instructions`, `trusted-command-allowlist`, `trusted-deletes-renames` (v0.5.0–v0.6.5).

**Residual (not a new epic):** shell `del`/`rm` still cards; recursive protected deletes still refuse. Do not reopen without new evidence.

---

## E-LIVE — live streams — DONE

Shipped: `live-turn-attention` (v0.5.0), `acp-live-streams` + `syntax-themes` (v0.6.6).

**Residual:** highlighter is appearance-aware, not a theme picker. Mermaid is **E-CHAT**, not a second highlighter stack.

---

## E-GUEST — vendor guest completeness — PARTIAL

**Job:** In Code, whatever the vendor Grok agent actually did is inspectable in Voidglass. Chat and Mini-Grok stay honest-absent.

**Done (v0.6.6 + G1 + G2):** `spawn-grok-agent`, `slash-skills`, `subagent-pane`, `browser-panel`, `vendor-mcp-visible`, `vendor-hooks-visible`. Engine chip. Review maps `session/request_permission`.

**Guest-completeness test (grooming bar):** TUI can do X → Forge shows X from the parent wire **or** says absent. Never implement X inside grok-acp.

### Remaining stories

| ID | Story | IN | OUT | Depends | Blocked-on | Effort | Era | Status |
|----|--------|----|-----|---------|------------|--------|-----|--------|
| **G1** | **vendor-mcp-visible** | Code vendor MCP servers the guest advertised appear as Forge chrome (name + status). Quiet absent in Chat / Mini-Grok / zero-MCP turns | Forge MCP registry; grok-acp MCP engine; marketplace | Grok CLI + vendor `available` MCP on the parent session | Live pin `_x.ai/mcp/server_status` | M | 1.0 | **DONE** SHIPPED + ARCHIVED 2026-08-27 |
| **G2** | **vendor-hooks-visible** | Vendor hooks/plugins the guest advertises are visible or honestly empty | Forge skills engine; second `AGENTS.md` | G1’s mapping pattern | Live pin `_x.ai/session_notification`+`hook_execution` / `_x.ai/hooks/list` | M | 1.0 | **DONE** SHIPPED + ARCHIVED 2026-08-27 |
| **G3** | **vendor-worktree-identity** | If a child is in a vendor worktree, identity chrome can say so | Forge-spawned worktrees; `isolated-workers` | `subagent-pane` | Vendor child frame carries a worktree fact (or we withhold) | S | 1.0 | **BLOCKED** on a named vendor field |
| **G4** | **tui-handoff** | From Grok TUI, open *this* session in Forge (Claude `/desktop`, Codex `/app`) | Fake deep links; WSL-only hacks | Vendor/deep-link exists | xAI handoff surface | M | 1.0 | **BLOCKED** on vendor |
| **G5** | **guest-absent-honesty** | Chat / Mini-Grok never grow fake Skills/MCP/Child/Browser/Hooks | — | standing | — | S ongoing | always | **DONE as law**; regression tests stay |

**Sequencing inside the epic:** G5 is already law. G1 MCP chrome and G2 hooks chrome shipped 2026-08-27. G3/G4 wait on vendor facts.

**Not in this epic:** Forge MCP host (`mcp-host`) — that is **E-ACP / E-TEAM** if Chat needs connectors Grok will not carry.

---

## E-SHARE — shareable install — 0.7 NEXT ERA

**Job:** A human who is not the operator installs Forge on Windows and completes a Chat session without a call.

**Exit:** Publisher story is true; first-run does not strand; 0.6.x can update; walkthrough either closed or still explicitly deferred.

### Stories

| ID | Story | IN | OUT | Depends | Blocked-on | Effort | Status |
|----|--------|----|-----|---------|------------|--------|--------|
| **S1** | **honest-unsigned-first-run** | Fresh install states unknown-publisher is expected; SHA-256 is findable (notes / first-run / Settings). Never a fake “Verified publisher” | Authenticode theater | v0.6.6 notes already have SHA | Operator **A** 2026-08-27 | S | **IN FLIGHT** GATE Q · AC 5 waits on next published installer |
| **S2** | **authenticode-installer** | Current-user NSIS is Authenticode-signed; SmartScreen quiet | Buying a cert in-band | Cert in the org | **cert** | L | **BLOCKED** |
| **S3** | **first-run-cli-missing** | First Code visit: “install Grok CLI” vs Mini-Grok is host-vouched; Chat works without CLI | Bundling `grok.exe` as a silent extra product | `spawn-grok-agent` fallback chrome | — | S | **mostly DONE**; close remaining mute gaps only |
| **S4** | **update-path-proof** | A real 0.6.5/0.6.6 machine picks up the next tag via `latest.json` | New updater protocol | Updater key (present locally) | A 0.7 (or 0.6.7) tag | S | **READY** as verification, not a feature |
| **S5** | **brother-walkthrough** | Deferred `desktop-self-host` human/clean-machine rows close **or** stay named-deferred | Steering a session back to handoff without operator lift | Packaging already shipped | **Operator hold** since 2026-08-15 | M | **DEFERRED** |

**Grooming call:** 0.7 can start on **S1+S3+S4** without a cert. **S2** waits. **S5** waits for the operator. Do not mix Mac into this epic.

**Operator ruling (2026-08-27, A):** 0.7 starts on **S1** without waiting for a cert. S2 stays blocked.

---

## E-CHAT — capable Chat — PARTIAL

**Job:** P2 uses Chat for a week without Code and without the operator.

**Done:** dual-mode Chat, named home + pack (`named-projects` v0.6.3), PDF text extract (v0.6.4), grok-ui + markdown, live thought/words on grok-acp, appearance-aware fences, **Artifact** panel (`artifacts-panel` 2026-08-27).

### Stories

| ID | Story | IN | OUT | Depends | Blocked-on | Effort | Era | Status |
|----|--------|----|-----|---------|------------|--------|-----|--------|
| **C1** | **artifacts-panel** | Large grok-ui / long docs open beside the bubble; bubble stays scannable | PPT clone; HTML sandbox; PDF viewer | Rich display already in Chat | — | M | 1.0 | **DONE** SHIPPED + ARCHIVED 2026-08-27 |
| **C2** | **mermaid** | Fenced mermaid renders or stays honest plain | Second highlighter; clone of TUI diagrams | C1 (or syntax-themes non-goal stays) | — | S | 1.0 | **DONE live** 2026-09-14 Chat recapture `data-mermaid=drawn` (tests 5 mermaid + 2 connectors panel). Not a release. |
| **C3** | **chat-on-vendor** | Chat runs `grok agent` | Dumping homes/packs into a coding agent on day one | E-GUEST loved on Code | Product reason, not convenience | L | 1.0+ | **PARKED** — dual-engine is the 0.7/1.0 default |
| **C4** | **Chat week evidence** | Brother (or equivalent) completes a week | A feature named “brother” | E-SHARE first-run | Operator/brother time | — | 0.7–1.0 | **DEFERRED** (same hold as S5) |

Chat must not grow G1–G5 fake catalogs. That is G5, not C1.

---

## E-PLAT — platforms

| ID | Story | IN | OUT | Depends | Blocked-on | Effort | Era | Status |
|----|--------|----|-----|---------|------------|--------|-----|--------|
| **P1** | **mac-desktop** | Current-user Mac install; Code still vendor CLI; Chat works | Windows-quality drop; Electron | E-SHARE patterns | Windows-first sequence; codesign on Apple | L | 1.0 | **PARKED** unless operator overrides |
| **P2** | **linux-desktop** | Later | — | P1 | demand | L | 2.0+ | **PARKED** |

---

## E-TRUST — deeper confine — PARKED

| ID | Story | IN | OUT | Status |
|----|--------|----|-----|--------|
| **T1** | **os-sandbox** | OS confine for Trusted *generic* shell; label today stays honest unsandboxed | Pretending Review/Trusted is a sandbox | **PARKED** |
| **T2** | **os-keychain** | Tokens leave `config.json` | Inventing a vault product | **PARKED** (1.0–2.0) |

Review/Trusted/Bypass and workspace confine are **E-HOUSE**, already shipped.

---

## E-ACP — other guests — PARKED until 1.0 is loved

| ID | Story | IN | OUT | Status |
|----|--------|----|-----|--------|
| **A1** | **codex-acp** | Codex as a Code guest; same dock/loop | Rewriting chrome | **PARKED** (`grok-first`) |
| **A2** | **claude-acp** | Claude Code as a guest | — | **PARKED** |
| **A3** | **guest-switcher** | Pick guest per workspace/session | Multi-agent fleets | **PARKED** |
| **A4** | **acp-v2** | Adopt stable v2 | Rewriting the host for the **July 2026 draft** | **BLOCKED** on stable spec |
| **A5** | **forge-mcp-host** | Forge registry only if Chat needs connectors Grok will not carry | Doing this instead of G1 | **PARKED** behind G1 + honest installer |

---

## E-TEAM — team + money — PARKED after 1.0

Shared policy pack, audit JSON lines, optional app SSO, MDM/MSI, Personal $0 / Pro-Team for policy and support. Never resell tokens. Never share one SuperGrok.

Do not BRIEF these until 1.0 has weekly P1 use.

---

## Anti-goals (not epics)

Classifier auto-mode · cloud fleets · iOS Simulator · computer use · pixel-parity TUI/IDE · second non-ACP chat stack · Forge skills engine · Forge-spawned worktree workers · scrape grok.com · Electron rewrite.

---

## Suggested GATE I order (when `go` resumes)

1. **S1** honest-unsigned first-run *(if operator allows 0.7 without a cert)* — else wait, only **S3** mute-gap polish is unblocked  
2. **S4** update-path proof (verification on the next tag)  
3. **G1** vendor-mcp-visible *(SHIPPED 2026-08-27)*  
4. **C1** artifacts-panel *(SHIPPED 2026-08-27)*  
5. **C2** mermaid *(READY; later than S1/S4)*  
6. **P1** Mac *(Windows-first until then)*  
7. **G2** hooks/plugins chrome *(SHIPPED 2026-08-27)*  

**S2** (cert), **S5** (walkthrough), **G3/G4** (vendor fields), **C3** (Chat on vendor), **E-ACP**, **E-TEAM**: not GATE I without a named lift.

---

## Round notes (extra brainstorm)

1. **Epics cut across versions.** E-GUEST started in 0.6.6 and finishes in 1.0. E-SHARE *is* 0.7. Do not open a new epic per kebab.  
2. **Nouns we must not own.** Skills, MCP, hooks, worktrees, browser engine: guest nouns. We own the *list in Voidglass* and the dock.  
3. **Distribution vs capability.** Shipping Artifacts while the publisher is a lie does not make a second human. 0.7 before C1 unless Chat is the live pain.  
4. **Evidence is an epic dependency.** S5 and C4 are not code. 0.7’s exit is weaker without them; do not fake GATE Q green.  
5. **ACP v2 is a draft.** Track it under A4; do not let it preempt G1.

---

## Related

`docs/VISION.md` · `docs/PRODUCT_ROADMAP.md` · `docs/agent-strategy.html` · `BACKLOG.md`
