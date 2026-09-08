# Product roadmap — Forge (living)

**Last refreshed:** 2026-09-08  
**Kind:** living product document. The loop (`docs/FORGE_EVER_GOAL.md`) may add a hunt row; it must not silently rewrite eras or anti-goals.  
**Identity:** `docs/VISION.md` · **Epics:** `docs/EPICS.md` · **Daily pick:** this file §9 then `.spire/clusters/tech/context/BACKLOG.md`

> **How to keep this alive.** After a dogfood slice that finds a *durable* product gap (not a one-pixel clip), add one row to §9. After a published tag, rewrite §1. Do not leave “Code uses `grok agent stdio`” in this file after 31 Aug 2026 — that ruling is reversed.

---

## 0. Now (read this, skip the rest if you only have a minute)

| | |
|--|--|
| **Product** | ACP-native desktop shell. Chat + Code. Voidglass. Review / Trusted / Bypass. |
| **Published** | **v0.6.6** Windows unsigned NSIS. Code still the *vendor* engine in that binary. |
| **Source (HEAD)** | `cc293d9` (8 Sep). Code is **house grok-acp**. Gate (shell / write / plan / ask). Changes dock. Home. |
| **Not published** | 0.6.7 installer. SHA-in-app (S1 AC5). Signed cert. Mac. |
| **Wedge** | Grok’s official surface is a TUI + `grok agent stdio`. Forge is the Grok *desktop that is not a terminal*. |
| **Next era** | **0.7 Shareable** — a second human installs without us in the room. |
| **Loop** | `docs/FORGE_EVER_GOAL.md` — use Forge to build Forge. Hunt §9. |

**Next product decision (operator):** cut 0.6.7 so S1 AC5 and update-path can close, *or* keep looping on source.

---

## 1. What is true today (2026-09-08)

Two layers. Do not mix them.

### Published box (v0.6.6)

- Windows current-user installer, unknown publisher, SHA in release notes.
- Chat \| Code. Chat = grok-acp. Code = `grok agent stdio` when CLI resolves, grok-acp fallback.
- Live thought / mid-turn / tools / vouched answer. Plan → File changes → Verify → Git review.
- Vendor Skills / children / browser chrome when the guest advertises them.
- Named Chat home + pack. PDF text extract. Appearance-aware fences.

### Source on `master` (ahead of the box)

- **Code engine is grok-acp.** Operator ruling 2026-08-30 (`docs/ACP_CODE_GOAL.md`). Do not spawn `grok.exe agent stdio` for Code.
- Identity chrome is **Grok**, not Mini-Grok consolation, not a CLI badge.
- **Gate** (`apps/shell/src/dock/Gate.tsx`): shell (“Grok wants to run a command”), write (“Grok wants to write a file”), plan (Accept / Keep planning), ask (“Grok has a question”). Keys ⏎ / S / esc.
- **Changes dock**, Home (what needs you), one-row composer, context ring, motion, domain-split shell.
- Dogfood proved: Allow once, Allow for this session, Deny+Retry, Accept plan then do, Revert. It did **not** prove: Keep planning as the chosen path, Trust this folder, Edit command, ask-tier questions, a queued second card, Bypass as a saved mode, a real multi-file feature built *in* Forge.

### Still not true

- Someone else can install without an unknown-publisher scare *or* a walkthrough.
- Mac.
- Chat on the vendor engine (parked on purpose).
- Forge-spawned worktrees / skills engine / MCP host.
- Classifier auto-mode, computer use, cloud fleets (anti-goals).

---

## 2. Product thesis

**Forge** is the **house**: window, trust rules, inspect surfaces, installer.  
The **brain** in Code is house grok-acp (we own diffs, shell, confine).  
The **guest** (Grok Build TUI / `grok agent`) still owns skills, MCP, hooks, subagents, worktrees — we **show** them when they appear on the wire; we do not invent a catalog.

**Wedge:** Claude and OpenAI already have desktops. Grok’s official coding surface is a TUI. Forge is that missing desktop, with ask-before-edit as the moat.

**Not an IDE.** No LSP, no in-app file editor, no pixel-parity with Cursor or Claude Code’s VS Code skin.

### Positioning

| Kind | Examples | Forge is |
|------|----------|----------|
| AI editor | Cursor, Windsurf, Copilot | **No** |
| Terminal agent | Claude Code CLI, Grok Build TUI | **No** — not a TUI skin |
| Desktop command center | Claude Desktop, Codex app | **Cousin** — Chat + Code + approve. No computer use, no IDE panes |
| ACP host GUI | Zed / JetBrains ACP, Forge | **Yes** — a first-class ACP *client*, not an editor plugin |

xAI documents three Grok Build modes: interactive TUI, headless `-p`, and **ACP** (`grok agent stdio`). Forge is a desktop ACP client that, as of 31 Aug, **runs its own agent** on Code rather than wrapping the TUI.

### Pillars

1. ACP-native (host + UI agent-agnostic; extra guests after 1.0 is loved).
2. Subscription-first auth; API key backup.
3. Local-first secrets, workspaces, journals.
4. Dual surface: Chat (everyone) + Code (repo) — one protocol, two profiles.
5. Forge owns the GUI. Guest (or house agent) decides when to think / tool / **ask**.
6. Lean and fast are product features.
7. **Trust is the moat** — Review / Trusted / Bypass. Never YOLO-only Code.
8. Monetize the shell, never tokens.

---

## 3. Personas

| Persona | Job | Success |
|---------|-----|---------|
| **P1 Developer** | Local Grok coding on a real repo | Weekly Code sessions; Gate + Changes; no TUI required |
| **P2 Knowledge worker** | Chat: mail, EN↔JA, outlines, files | A week without the operator |
| **P3 Team** | One desktop policy | After 1.0 |
| **P4 IT / security** | Signed deploy, audit | After 1.0 |

P1 and P2 are 0.7 / 1.0. P3–P4 wait.

---

## 4. Competitive bar (research 2026-09-08)

Sources (official unless noted):

- Claude Code permission modes — [code.claude.com/docs/en/permission-modes.md](https://code.claude.com/docs/en/permission-modes.md) (fetched 2026-09-08)
- Grok Build product — [x.ai/build](https://x.ai/build)
- Codex app intro — [openai.com/index/introducing-the-codex-app](https://openai.com/index/introducing-the-codex-app/) (Windows from 4 Mar 2026)
- ACP registry — [zed.dev/blog/acp-registry](https://zed.dev/blog/acp-registry) (28 Jan 2026)
- ACP v2 draft — [agentclientprotocol.com](https://agentclientprotocol.com/announcements/acp-v2-draft) (20 Jul 2026)
- ACP agent matrix — `agentclientprotocol/registry` `.protocol-matrix/latest.md` (generated 2026-09-08, 33 agents probed)

### What they ask the human

| Product | How the human decides | Forge today |
|---------|----------------------|-------------|
| **Claude Code** | Manual / acceptEdits / **plan** (approve → auto *or* review each edit *or* keep planning) / **auto** (classifier, default on Pro/Max/Team since 14 Aug 2026) / dontAsk / bypass. `AskUserQuestion`. Shift+Tab. | Review ≈ Manual. Trusted ≈ acceptEdits. Plan Gate exists. **No classifier** (anti-goal). Ask Gate exists in code, **not dogfooded**. |
| **Grok Build TUI** | Plan viewer `[a]pprove [c]omment [q]uit`. Multiple-choice Q&A. Permission modes ask / auto / always-approve. Subagents in worktrees. Skills / MCP / hooks / plugin marketplace. | Plan Accept / Keep planning. Comment-on-steps **missing**. Q&A **missing live**. Marketplace **out**. |
| **Codex app** | `sandbox_mode` (can it?) independent of `approval_policy` (must it ask?). Parallel threads. Computer use on Mac (May 2026). | Confine + Review are one story. No OS sandbox yet (parked). Computer use **anti-goal**. |
| **Zed / JetBrains ACP** | Host any registry agent; diffs and approval in the *editor*. 33 agents on the 8 Sep matrix. v2 is **draft**. | Forge is a dedicated ACP *desktop*, not an editor. Extra guests are **2.0**. Do not rewrite the host for v2 draft. |

### Implication (do not clone)

Spend the next era on (1) **other people can run it**, (2) **Gate + Plan + ask** matching the daily coding loop, (3) **complex work in the same window** (multi-file, follow-up, tests, git), (4) Chat a non-dev will keep. Do **not** spend it on classifier auto-mode, computer use, IDE panes, or a Forge plugin marketplace.

Claude’s auto-mode classifier is a documented default on paid plans. **Forge refuses that.** Our bet is a visible Gate the operator actually answers.

### Research fold (workflow 2026-09-08, partial)

Independent check of official pages. Gaps noted in the report; do not treat this as a vendor “2026 contract.”

- **ACP card** is `session/request_permission`: title, optional description/subject, options whose kinds are `allow_once` / `allow_always` / `reject_once` / `reject_always`. Client returns `selected` or `cancelled`. Agent SHOULD be `requires_action` while blocked. ([agentclientprotocol.com/protocol/v2/tool-calls](https://agentclientprotocol.com/protocol/v2/tool-calls))
- **Exiting plan/architect** on ACP is that same permission RPC on a `switch_mode` tool: auto-accept all / accept once / **stay in architect** (`reject_once`). ([session-modes](https://agentclientprotocol.com/protocol/session-modes))
- **Grok Build plan** stays until approve or quit; only the session plan file may be edited until then — even under auto / always-approve. Plan gates *edits*, not shell (bash redirect can still write). ([docs.x.ai/build/features/plan-mode](https://docs.x.ai/build/features/plan-mode))
- **Cursor** opens the plan as editable markdown; coding starts only after **Build**. ([cursor.com/docs/agent/plan-mode](https://cursor.com/docs/agent/plan-mode))
- **Codex `/plan`** is a “propose first” mode, **not** a documented hard lock on file-edit tools (unlike Claude and Grok).
- **ACP v2 draft** would drop dedicated `session/set_mode`. Do not bet the house on v1 modes as the only future contract.

Forge’s **Keep planning** hunt is the `reject_once` / “No, keep planning” seat. We have the button; we have not dogfooded it as the chosen path.

---

## 5. Version ladder

Semver stays `0.y.z` until 1.0. Names below are *eras*.

| Era | Name | One-liner | Exit |
|-----|------|-----------|------|
| **Met** | **0.6** Dogfood Grok desktop | Operator has a Windows desktop | v0.6.6 published |
| **Now (source)** | **0.6.7-unreleased** House Code | grok-acp Code + Gate + Home + Changes | Tag + installer (not cut) |
| **Next major** | **0.7** Shareable | A second human installs and finishes Chat | Honest publisher story; first-run does not strand; update path proved |
| **After that** | **1.0** Daily Grok desktop | P1 does not open the TUI; P2 stays in Chat; Mac exists | Gate loved; Artifacts (shipped in source); Mac; brand frozen |
| **After 1.0** | **2.0** ACP platform | Same chrome, other agents + team policy | Codex/Claude ACP; still no IDE |

Money only after 1.0 weekly use. Personal Chat stays free.

---

## 6. Next major — **0.7 Shareable Grok desktop**

**Job:** someone who is not the operator installs Forge on Windows and completes a real Chat session without a call.

### In

| Slice | Observable | Status |
|-------|------------|--------|
| **S1 honest-unsigned** | First-run says unknown-publisher is expected; SHA-256 findable in the app | GATE Q; **AC5 waits on next installer** |
| **S2 authenticode** | Signed NSIS; SmartScreen quiet | **BLOCKED on a cert** |
| **S3 CLI-missing** | First Code visit is honest without bundling `grok.exe` | Mostly done (house Code no longer needs the CLI) |
| **S4 update-path** | A 0.6.6 machine picks up the next tag via `latest.json` | READY as verify on the next tag |
| **S5 brother walkthrough** | Clean-machine evidence | **Operator hold** since 15 Aug |

### Out of 0.7

Mac · Mermaid · Forge MCP host · extra ACP adapters · billing · computer use · classifier auto-mode.

### Grooming call

0.7 can ship **S1 + S4** without a cert (operator **A**, 27 Aug). Cutting **0.6.7** is what unblocks S1 AC5 and S4. Loop quality on source does not replace that tag.

---

## 7. Major after that — **1.0 Daily Grok desktop**

**Job:** P1’s hard jobs stay in Forge; P2’s week stays in Chat; a Mac user can install.

| Slice | Observable | Status |
|-------|------------|--------|
| Vendor MCP / hooks visible | Show guest lists, don’t invent | **Shipped** 27 Aug (source; was for vendor Code) |
| Worktree identity | Show if the guest names a worktree | **BLOCKED** on a vendor field |
| TUI handoff | Open *this* session from Grok TUI | **BLOCKED** on vendor deep-link |
| Artifacts | Long / grok-ui Open beside the bubble | **Shipped** 27 Aug |
| Mermaid | Fenced mermaid draws or stays honest plain | READY to BRIEF; later than 0.7 |
| Mac | Current-user Mac install | PARKED Windows-first |
| Chat week | Brother (or equivalent) uses Chat a week | DEFERRED (operator hold) |
| **Gate loved** | Shell / write / plan / ask all used in real work; Keep planning and Trust folder work | **Loop hunt** — see §9 |
| **Complex Code** | Multi-file feature, follow-up, tests, git, Deny one path — in Forge, on this repo | **Loop hunt** — see §9 |

Chat stays grok-acp until there is a *product* reason to put Chat on `grok agent`.

---

## 8. After 1.0 — **2.0 ACP platform** (do not start now)

Codex / Claude as Code guests · per-agent auth · file- or MDM-deployed allowlists · local audit JSONL (already started) · optional app SSO · silent MSI · Personal $0 / Pro-Team for policy. Never resell tokens. Never share one SuperGrok.

**ACP v2** is a July 2026 **draft**. Track it. Do not rewrite the host for a draft.

**Forge MCP host** only if Chat needs connectors the vendor will not carry, and only after the installer is honest.

---

## 9. Loop hunts (ever-evolving)

The operating loop reads this table when live dogfood has not yet shown something worse. **Drop a row the moment a worse live defect appears.** Add a row when a slice finds a durable gap. This is not GATE I.

| Hunt | Why it is here | Evidence |
|------|----------------|----------|
| **Changes — write_file whole-file ±** | Live Keep-planning execute: git was **+1**, Changes showed **+301 −300** (`@@ -1,300 +1,301 @@` every line deleted then added). Review is unusable. | `countDiffLines` in `diffUtil.ts`; `docs/FORGE_EVER_GOAL.md` §10 |
| **Copy — Settle this in the card below** | After write **Allow**, the pending settle is Changes Accept, not ActionDock. Transcript still says the card is below. | `SETTLE_IN_DOCK` |
| **Gate — Trust this folder** | Write Gate has the control; no live journey persisted Trusted from the card. | `GATE_TRUST_FOLDER` in `copyDock.ts` |
| **Gate — Edit command** | Shell Gate can prefill the composer; not dogfooded. | `GATE_EDIT_COMMAND` |
| **Gate — ask tier** | Grok Build’s product page leads with multiple-choice Q&A. Our Ask Gate is coded (`GATE_ASK_TITLE`) and unproven live. | `Gate.tsx` `tier: "ask"`; [x.ai/build](https://x.ai/build) “Q&A” |
| **Gate — queue** | Two live cards (1 of 2). Only a stale second click after settle was seen (404). | KEEP-TWELVE banner |
| **Gate — keys** | ⏎ / S / esc exist in the Gate. Not proven in a live session. | `Gate.test.tsx` |
| **Complex Code** | Real multi-file work on `apps/` / `packages/`, not `docs/dogfood/*.md`. Ceiling so far: one comment, one CSS pass, 3-file fixtures. | Dogfood explainer; this conversation |
| **Bypass honesty** | Bypass is not a saved workspace radio. Standing. | `FORGE_DAILY_GOAL.md` Settings look |
| **0.6.7 tag** | Unblocks S1 AC5 + S4. Not a loop slice unless the operator says `release`. | `RESUME.md` 1 Sep; HEAD `cc293d9` |
| **Mermaid** | Chat diagrams. Later than 0.7. | EPICS C2 |
| **Invent the next job** | If none of the above is the live FAIL, invent a harder Forge-builds-Forge job. | Ever-goal |

**Done in the preferred loop (do not re-elect unless live regresses):** Allow once; Allow for this session; Deny + Retry; Accept plan records; Revert offered and chip says Reverted; session-grant Changes membership; Plan WOULD CHANGE is mutations only; Your turn after a clean finish; catch-up Changes not stuck Loading. Full log: `docs/FORGE_PREFERRED_GOAL.md` §9.

**Done in the ever loop:** Home no longer covers a bound Code empty session (AGENTS.md loads). Keep planning as the chosen path through constraint → second Plan Gate → Accept → write Allow → Changes Accept (disk +1). Log: `docs/FORGE_EVER_GOAL.md` §10.

---

## 10. Configurability & speed

| Level | What |
|-------|------|
| 0 Defaults | Chat/Code, Auto effort, Voidglass, Review |
| 1 Settings | Model, effort, theme, density, Trusted classes, diagnostics |
| 2 Files | workspace policies, Trusted class lists |
| 3 Managed | MDM (2.0) |

Budgets (unchanged): cold UI &lt; 3 s · host ready &lt; 2 s · mode switch &lt; 500 ms to chrome · composer stays typable while streaming · 500 chats without lag.

---

## 11. Anti-goals (not later-maybe)

Classifier auto-mode · cloud agent fleets · iOS Simulator / computer use · pixel-parity with Claude Code or Codex UI · a second non-ACP chat stack · a Forge-built skills or MCP *engine* · Forge-spawned worktree workers · scrape grok.com · share one SuperGrok · Electron rewrite · KEEP overwrite series as a product process.

---

## 12. Operator decisions still open

1. **Cut 0.6.7?** Unblocks honest-unsigned SHA-in-app and update-path proof. Loop quality does not ship itself.
2. **Brand:** keep Forge, or “Grok Desktop”?
3. **Mac in 0.7 vs 1.0?** Windows-first unless overridden.
4. **Chat engine:** stay grok-acp through 1.0, or move Chat onto `grok agent` once Code is loved?
5. **First paid tier:** after 1.0 only. Personal Chat stays free.
6. **Brother walkthrough:** still held since 15 Aug.

Locked: 0.7 may ship unsigned-and-honest (27 Aug A). Code engine is grok-acp (30 Aug). Classifier auto-mode is out.

---

## 13. Changelog (this file)

| Date | What changed |
|------|----------------|
| 2026-08-27 | First version-ladder after v0.6.6. Code still described as vendor `grok agent stdio`. |
| 2026-09-08 | Living refresh. Source truth: house grok-acp, Gate, Changes, Home. Competitive bar re-read (Claude auto default, Grok TUI Q&A/plan, Codex sandbox≠approval, ACP v2 draft, 33-agent matrix). §9 loop hunts added. Engine sentence corrected. |
| 2026-09-08 | Folded deep-research (partial): ACP permission option kinds, plan-exit `reject_once`, Grok plan-file edit gate, Cursor Build-after-plan, Codex `/plan` not a hard edit lock. |
| 2026-09-08 | Keep planning full loop done in ever-goal. New hunts: write_file whole-file ±; SETTLE_IN_DOCK when Changes owns the settle. |

---

## 14. Related

`docs/VISION.md` · `docs/EPICS.md` · `docs/FORGE_EVER_GOAL.md` (operating loop) · `docs/FORGE_PREFERRED_GOAL.md` (prior loop log) · `docs/DOGFOOD_EXPLAINER.html` · `docs/releases/v0.6.6.md`
