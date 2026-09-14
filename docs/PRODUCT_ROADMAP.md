# Product roadmap — Forge (living)

**Last refreshed:** 2026-09-10  
**Kind:** living product document. The loop (`docs/FORGE_EVER_GOAL.md`) may add a hunt row; it must not silently rewrite eras or anti-goals.  
**Identity:** `docs/VISION.md` · **Epics:** `docs/EPICS.md` · **Daily pick:** this file §9 then `.spire/clusters/tech/context/BACKLOG.md`

> **How to keep this alive.** After a dogfood slice that finds a *durable* product gap (not a one-pixel clip), add one row to §9. After a published tag, rewrite §1. Do not leave “Code uses `grok agent stdio`” in this file after 31 Aug 2026 — that ruling is reversed.

---

## 0. Now (read this, skip the rest if you only have a minute)

| | |
|--|--|
| **Product** | ACP-native desktop shell. Chat + Code. Voidglass. Review / Trusted / Bypass. |
| **Published** | **v0.7.1** unsigned NSIS, installed on this box. SHA-256 live in Settings. Canvas stdout no longer breaks ACP. |
| **Source (HEAD)** | **v0.7.1** plus Grok connectors Settings honesty and Chat mermaid (C2, local `a4d3c20`). Not a release. Do not re-stamp 0.6.7. |
| **Not published** | Signed cert. Mac. |
| **Wedge** | Grok’s official surface is a TUI + `grok agent stdio`. Forge is the Grok *desktop that is not a terminal*. |
| **Next era** | **0.7 Shareable** — a second human installs without us in the room. |
| **Loop** | `docs/FORGE_EVER_GOAL.md` — use Forge to build Forge. Hunt §9. Goal is not completable; operator is the only STOP. |

**Next product decision (operator):** S4 proved 2026-09-14 — repo is **public**; 0.7.0 Check for updates offered **Install 0.7.1**; 0.7.1 now **No update available.** S2 still needs a cert. S5 walkthrough still held. Local `a4d3c20` is not on origin.

---

## 1. What is true today (2026-09-08)

Two layers. Do not mix them.

### Published box (v0.6.7)

- Windows current-user installer, unknown publisher, SHA in `docs/releases/v0.6.7.md`.
- Chat \| Code. Both grok-acp. A `grok` CLI on PATH does not divert Code to vendor stdio.
- Identity chrome is **Grok**. Gate (shell / write / plan / ask). Changes. Home.
- Live thought / mid-turn / tools / vouched answer. Review is the default.
- Named Chat home + pack. PDF text extract. Appearance-aware fences.

### Still unproven on the box

- A real multi-file feature built *in* Forge.
- SHA-in-app (S1 AC5) — **observed** on this box’s 0.7.1 Settings + `/api/health` (`6abb936f…`). GATE Q clean-machine rows still open.

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
| **Met** | **0.6** Dogfood Grok desktop | Operator has a Windows desktop | v0.6.7 published |
| **Now** | **0.7** Shareable | A second human installs and finishes Chat | Honest publisher story; first-run does not strand; update path proved |
| **After that** | **1.0** Daily Grok desktop | P1 does not open the TUI; P2 stays in Chat; Mac exists | Gate loved; Artifacts (shipped in source); Mac; brand frozen |
| **After 1.0** | **2.0** ACP platform | Same chrome, other agents + team policy | Codex/Claude ACP; still no IDE |

Money only after 1.0 weekly use. Personal Chat stays free.

---

## 6. Next major — **0.7 Shareable Grok desktop**

**Job:** someone who is not the operator installs Forge on Windows and completes a real Chat session without a call.

### In

| Slice | Observable | Status |
|-------|------------|--------|
| **S1 honest-unsigned** | First-run says unknown-publisher is expected; SHA-256 findable in the app | **SHA live** on installed 0.7.1 (`6abb936f…` in Settings + `/api/health`). GATE Q clean-machine rows still open |
| **S2 authenticode** | Signed NSIS; SmartScreen quiet | **BLOCKED on a cert** |
| **S3 CLI-missing** | First Code visit is honest without bundling `grok.exe` | Mostly done (house Code no longer needs the CLI) |
| **S4 update-path** | A 0.6.6 machine picks up the next tag via `latest.json` | **PROVED** 2026-09-14 — `ariasr47/grokforge` public; anon `latest.json` 200; 0.7.0 UI **Install 0.7.1** |
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
| Mermaid | Fenced mermaid draws or stays honest plain | **Live in Chat** 2026-09-14 (`data-mermaid=drawn` Forge Chat → Mermaid). Not a published tag |
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
| **Changes — write_file whole-file ±** | Keep-planning execute once showed **+301 −300** vs git **+1**. Later Trusted one-line writes were **+1 −0**. Re-elect only if live regresses. | `countDiffLines` in `diffUtil.ts`; ever-goal §10 2026-09-09 |
| **Copy — Settle this in the card below** | Held 2026-09-09: after write Allow, settle copy is **Settle this in Changes.** Re-elect only if live regresses. | `SETTLE_IN_CHANGES`; ever-goal §10 |
| **Gate — Trust this folder** | Held 2026-09-09: persist Trusted from the write Gate; later same-day New Code session auto-applied eligible text (**Applied**, +1 −0, no Accept). Re-elect only if live regresses. | `GATE_TRUST_FOLDER`; ever-goal §10 2026-09-09 auto-apply |
| **Gate — Edit command** | Held 2026-09-10: unlock (deny+prefill) and in-place Allow (Gate stays; Allow runs edited string; stdout `forge-edit-right`). Stale acp-client dist dropped `command` on `permission/respond` — rebuilt. Re-elect only if live regresses. | `GATE_EDIT_COMMAND`; `client.permission-command.test.ts`; ever-goal §10 2026-09-10 |
| **Gate — ask tier** | Held 2026-09-09: `ask_user` raises cyan **Grok has a question**; click numbered option settles `option:N`. Receipt and transcript show the question, not raw JSON. Re-elect only if live regresses. | `GATE_ASK_TITLE`; grok-acp `ask_user`; `decisionRecordDetail`; ever-goal §10 |
| **Gate — queue** | Held 2026-09-09: same-turn tool batch overlaps permission_request; dock shows **1 of 2**; Allow advances to the remaining card. Re-elect only if live regresses. | ActionDock `queue-pos`; grok-acp `executeTools`; ever-goal §10 |
| **Gate — keys** | Held 2026-09-09: ⏎ Allow, **s** session, **esc** Deny. Footer says **esc deny** while a Gate is pending (Stop no longer claims esc). | `Gate.test.tsx`; ComposerPane `META_HINT_GATE`; ever-goal §10 |
| **Complex Code** | Held 2026-09-10 as a first real ≥2-file Forge-builds-Forge: Review `apply_patch` of `xai.ts` (+ no-reread SYSTEM_PROMPT rule) and `xai.no-reread.test.ts`; Changes Accept both; test **1/1**. Re-elect if a later large-file job 20-read-loops anyway. | ever-goal §10 2026-09-10 |
| **Large apply_patch** | Hunk apply held 2026-09-09; unprefixed/blank context held; trailing-newline phantom blank context held 2026-09-10 (live Deny-one `@@ -0,0` / minus-plus); V4A `*** End Patch` skipped; empty/unparseable names missing `@@` + first body line; hunk-fail quotes first differing line, 120-truncation tails, and **first expected line at file line N** when the block is elsewhere (`describeHunkFail`). Re-elect only if live regresses. | `tools.apply-patch.test.ts`; ever-goal §10 |
| **Git tab stdout** | Held 2026-09-09. Git tab Status paints unwrapped `activity.output` stdout (`M`/`??` lines), not only the command string and not the JSON envelope. | `gitStdoutText`; ever-goal §10 |
| **Gate — Deny one / session-allow other** | Held 2026-09-10. Review + New Code session + two write Gates **1 of 2**; Deny one path; Allow for this session the other; Retry denied still cards. Trusted auto-apply is not this hunt. | ever-goal §10 2026-09-10 |
| **Chat glance** | Held 2026-09-10. After Code chrome: Chat Home **Good evening.**, **Grok · live**, no engine-stop. Re-elect only if live regresses. | ever-goal §10 |
| **Unix head on cmd** | Held 2026-09-10. Mixed Path with unexpanded `%NVM_HOME%` no longer `continue`s; Unix `head` preflight-rejects `leading_command_unresolved` (no Gate, no exit 255). Re-elect only if live regresses. | `shellPreflight.ts`; ever-goal §10 |
| **Model label mismatch** | Held 2026-09-10. Fast chip is effort. After Vite reload, header/footer prefer last-run `appliedModel` (`sessionChromeModel`). After host process restart, GET `/api/state.appliedModel` restores from the last journal run (`restoreAppliedModelFromJournal`; `awaitReady` waits `runHydration`). Re-elect only if live regresses. | `sessionChromeModel`; `session-applied-model-hydrate.test.ts`; ever-goal §10 |
| **Bypass honesty** | Bypass is not a saved workspace radio. Standing. | `FORGE_DAILY_GOAL.md` Settings look |
| **S1 AC5 SHA-in-app** | **Held 2026-09-14:** installed 0.7.1 Settings + health SHA `6abb936f…` match notes. Re-elect if a later tag paints unavailable. | `docs/releases/v0.7.1.md` |
| **Mermaid** | Chat diagrams. Later than 0.7. | EPICS C2 |
| **Empty-stop chrome honesty** | Held 2026-09-10 YOU 02:08: two-path `git status --short --` (no Gate) vouched the status lines; Copy; no Run failed on that YOU; host.log `done/stop` no agent error. Re-elect only if live regresses. | ever-goal §10 2026-09-10 |
| **Invent the next job** | If none of the above is the live FAIL, invent a harder Forge-builds-Forge job. Skip inspection-grammar two-file `apply_patch` (TWO-FILE-HANG). | Ever-goal |

**Done in the preferred loop (do not re-elect unless live regresses):** Allow once; Allow for this session; Deny + Retry; Accept plan records; Revert offered and chip says Reverted; session-grant Changes membership; Plan WOULD CHANGE is mutations only; Your turn after a clean finish; catch-up Changes not stuck Loading. Full log: `docs/FORGE_PREFERRED_GOAL.md` §9.

**Done in the ever loop:** Home no longer covers a bound Code empty session (AGENTS.md loads). Keep planning as the chosen path through constraint → second Plan Gate → Accept → write Allow → Changes Accept (disk +1). Trust this folder persists Trusted from the write Gate. Trusted in-flight eligible text auto-applies (**Applied automatically · Trusted workspace**, no second Changes Accept). Edit command one-click prefills and unlocks the composer (denies the pending shell). Keyboard ⏎ / s / esc settle a shell Gate; footer says **esc deny** while pending. One-line write Changes ± is **+1 −0**. After write Allow, settle copy is **Settle this in Changes.** Empty/dead `events.cas.lock` is stolen so the next Dev host can listen. Ask-tier **Grok has a question** live (`ask_user`, numbered click, `option:N`). Same-turn queued Gates **1 of 2**. Turn-budget vouches a final after max tool rounds. Ask receipt and transcript show the question, not JSON. `git status --short` is fixed inspection (no Gate), including `--` + one or more relatives (three-path too); `git diff --stat --` one or more relatives (three-path too). Plan then do Accept-plan path. 12k tool-result cap now 100k. `apply_patch` hunk-by-hunk (no `write_file` steer), blank/unprefixed hunk context, trailing-newline not phantom blank, V4A `*** End Patch` skipped, empty-unparseable names missing `@@`, hunk-fail quotes first-diff / 120-tails / first-expected-elsewhere / `(blank line)`. Git tab Status paints unwrapped stdout. Deny-one: Deny one write + session-allow the other + Retry denied still cards. Chat glance after Code is Home **Good evening.** / **Grok · live**. Unix `head` on mixed Path preflight-rejects (no Gate). After-reload SHELL chrome and host-hydrate GET `/api/state.appliedModel` match the YOU line after Vite reload / process restart. First real ≥2-file Forge-builds-Forge: SYSTEM_PROMPT no-reread rule under `Rules:` + `xai.no-reread.test.ts`. grok-acp tools-then-empty-stop vouches a final (agent-side). Shell-run of `inspection-grammar.test.ts` vouched **Tests passed (exit 0).** (YOU 01:55). Empty-stop chrome: two-path `git status --short --` vouched status lines (YOU 02:08). Singular `1 tool round` voucher live (YOU 02:36, 02:49). Log: `docs/FORGE_EVER_GOAL.md` §10.

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
| 2026-09-09 | Ever-loop relaunch. HELD: Trust folder, Trusted auto-apply, Edit command unlock, ⏎/s/esc, footer esc deny, one-line write ±, SETTLE_IN_CHANGES, lock-steal. OPEN ordered: ask-tier → queued Gates → multi-file. `/goal` no longer completable via “named the next hunt.” |
| 2026-09-09 | Ask-tier live held: grok-acp `ask_user` + host title **Grok has a question** + numbered Gate click `option:N`. OPEN next: queued Gates (1 of 2). |
| 2026-09-09 | Queued Gates held: `executeTools` overlaps same-turn shell permissions; dock **1 of 2**. OPEN next: multi-file Forge-builds-Forge. |
| 2026-09-09 | Turn-budget honesty: tool-only max turns vouches a final instead of **Run failed · No final answer**. Multi-file JSON dump still OPEN. |
| 2026-09-09 | Ask receipt JSON held: Waiting-for-you row shows the question, not `{question,options}`. Leftover: transcript body still dumps permission JSON. |
| 2026-09-09 | Ask transcript JSON held: RunSurface pending-ask record shows the question, not raw JSON. git via shell held (fixed inspection, no Gate). |
| 2026-09-09 | Ever-loop relaunch 2. STARTED = Send + wait/Gate. Remaining OPEN: multi-file, large `apply_patch`, Git tab stdout, Deny-one, Chat glance. IN-FLIGHT: Plan then do. |
| 2026-09-09 | 12k tool-result cap held: `capToolResultForContext` now 100k so a 24k `read_file` keeps `GitTab`. Plan then do Accept-plan held. OPEN in-flight: large `apply_patch`. |
| 2026-09-09 | apply_patch hunk apply held; write_file steer removed. Leftover: unparseable patches with no `@@`. OPEN next: multi-file. |
| 2026-09-09 | apply_patch unprefixed/blank hunk context held (live `@@ -1,3`). OPEN next: Git tab stdout. |
| 2026-09-09 | Git tab stdout held: Status row paints unwrapped `activity.output`. OPEN next: Deny-one. |
| 2026-09-09 | Ever-loop relaunch 3. Disk beats paste IN-FLIGHT. STARTED ≠ OBSERVED (compact mid-wait = click). Operator re-paste is not restart OPEN #1. Deny-one is Review + New session, never Trusted follow-up. OPEN: Deny-one → Chat glance → multi-file → Unix `head` on cmd → grok-4-fast label. |
| 2026-09-10 | Deny-one held. apply_patch trailing-newline phantom context held (`splitKeepNl` + skip `***`). Chat glance held. OPEN in-flight: multi-file Unix `head` preflight. |
| 2026-09-10 | Unix `head` mixed Path held: skip unexpanded `%NVM_HOME%` Path entries; recapture **Command not found: head**, no Gate. OPEN next: grok-4-fast label. |
| 2026-09-10 | apply_patch hunk-fail quotes `file line N` + `patch expected`. Fast chip is effort (live run matches). After-reload header `grok-4-fast` vs YOU `grok-4-fast-non-reasoning` still OPEN. |
| 2026-09-10 | After-reload model chrome held: `sessionChromeModel` prefers last-run appliedModel. OPEN next: multi-file. |
| 2026-09-10 | Host hydrate `appliedModel` held: `awaitReady` waits `runHydration`; last journal run restores GET `/api/state.appliedModel` after process restart (pid 54480 → 13664). Ever-loop relaunch 4: 20-read-loop is TUI-ship, not STOP; remaining OPEN is durable multi-file in Forge. |
| 2026-09-10 | apply_patch hunk-fail 120-truncation held: `quoteHunkLine` shows later mismatch (live SYSTEM_PROMPT lines looked identical at 120). OPEN next: durable multi-file SYSTEM_PROMPT no-reread + test in Forge. |
| 2026-09-10 | First real ≥2-file Forge-builds-Forge held (no-reread paragraph + test). Path `git status --short -- <relative>` held. Empty/unparseable names missing `@@`. OPEN: Rules-bullet move. |
| 2026-09-10 | apply_patch hunk-fail first-expected-line-elsewhere held: `describeHunkFail` names `first expected line at file line N` (live `@@ -481` quoted Be concise vs Writes-and-shell at 479). Ever-loop relaunch 5. OPEN next: Rules-bullet via GREP-THE-SENTENCE. |
| 2026-09-10 | apply_patch hunk-fail blank-line quote held: empty patch line is `(blank line)` not `""` (live `@@ -470` `}` vs empty). OPEN: move no-reread `-` bullet under `Rules:` (it sits above). |
| 2026-09-10 | No-reread sentence is a `Rules:` bullet (TUI-ship after Forge hunk-fail + hung missing_final_answer). Test asserts `/Rules:[\\s\\S]*Never re-read/`. OPEN: invent harder. |
| 2026-09-10 | Two-path `git status --short --` and `git diff --stat --` held as fixed inspection. grok-acp tools-then-empty-stop vouches (agent-side **2/2**). YOU 01:55 shell-run vouched **Tests passed (exit 0).** Ever-loop relaunch 6: LAST-YOU-ONLY + EMPTY-STOP RECAPTURE. OPEN: empty-stop chrome honesty. |
| 2026-09-10 | `git status --short -- <rel> <rel>` is fixed inspection (live two-path carded a Gate; grammar had exactly-one-path). `git diff --stat -- a.ts b.ts` locked by test. OPEN: invent harder. |
| 2026-09-10 | Tools then empty stop vouches `Stopped after N tool rounds` instead of **No final answer was produced.** (live inspection/shell jobs). OPEN: invent harder. |
| 2026-09-10 | Ever-loop relaunch 7: FIRST ACTION is click-if-Gate else log-then-Send; VOUCHER-CHROME vs VOUCHER-PARROT; TWO-FILE-HANG; HELD-DRIFT (empty-stop is HELD, do not resurrect). YOU 03:00 Edit command still deny+prefill. OPEN: in-place Allow (Gate stays; Allow runs edited string). |
| 2026-09-10 | Ever-loop relaunch 8: CHROME-MCP STALL LAW. TUI chrome-devtools `take_snapshot`/`wait_for` on a live Forge page poisons JSON-RPC (`mcp_transport_decode_error`) then waits 6000s. Glance with `evaluate_script` `waitForStableDom: false`; snapshot only with `filePath`; after decode error stop Chrome MCP this session. OPEN unchanged: in-place Allow. |
| 2026-09-10 | Edit command in-place Allow held. Live stdout was still `forge-edit-wrong` until `@grokforge/acp-client` dist included `command` on `permission/respond`. Recapture stdout `forge-edit-right`. OPEN next: invent harder. |

---

## 14. Related

`docs/VISION.md` · `docs/EPICS.md` · `docs/FORGE_EVER_GOAL.md` (operating loop) · `docs/FORGE_PREFERRED_GOAL.md` (prior loop log) · `docs/DOGFOOD_EXPLAINER.html` · `docs/releases/v0.6.6.md`
