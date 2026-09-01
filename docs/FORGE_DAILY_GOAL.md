# Forge Code — daily-dev goal (accelerated)

**Opened:** 2026-08-29  
**Operator:** `/goal` after shipping `slash-skills-partial-catalog` (A). Pause is manual.  
**Not using:** delivery ascent / design council / GATE I–S.

## Goal
Forge Code is usable for daily development — quality, DX, usability, and look-and-feel at least at Claude Code / Codex, then past them. This agent drives real sessions **in the Forge Code app**, elects the next fix from live friction, and repairs it on the spot until features can be built end-to-end in Forge Code instead of the Grok TUI.

## Method
1. Boot Forge (host + shell, or packaged app).
2. Do real Code work on this repo through the UI.
3. Whatever blocks that loop is the next slice — fix it immediately (tests when silence would hide a regression; look at the UI).
4. Log the friction, the change, and the re-check here. Important context stays in this file + `OPEN_THREADS.md` dogfood remainder.
5. Do **not** invent a Forge skills/MCP engine, a TUI skin, or YOLO-only Code.

## Standing context
- Published app: **v0.6.6** (unsigned NSIS). Source has uncommitted waves plus skip-invalid Skills.
- Code engine: vendor `grok agent stdio` when the CLI resolves; grok-acp is Chat / honest fallback.
- Known leftovers (not elected until live use hits them): permission-policy toast (`honest-policy-fallback`); unmapped `user_message_chunk` / `session_info_update`; S1 AC 5 waits on next installer.

## Log

### 2026-08-29 — open
- Shipped `slash-skills-partial-catalog` (mixed `/name` ads keep valid commands).
- Left the delivery ascent.

### 2026-08-29 — first loop (from-source DEV UI)
**Boot friction**
- `npm run start` without `GROKFORGE_CHANNEL=dev` generates **prod** origins → Vite UI gets 403.
- Vite bound **IPv6-only** (`::1`). `127.0.0.1` refused. Playwright/host proxy die.
- `npm run dev -- --host 127.0.0.1` does **not** pass flags (npm eats them; vite treats leftovers as paths → 404).

**Fix:** `apps/shell/vite.config.ts` `server.host: true` so 127.0.0.1 and localhost both work. Drive DEV via `host:dev` (`:8788`) + Vite `:5174`.

**Live UI friction**
- Composer showed **Forge couldn’t use the saved permission policy. Review is active.** on a sandbox Chat with no saved policy (`fallbackReason: missing`). Same leftover as `honest-policy-fallback`.

**Fix:** `savedPolicyUnusable()` — toast only for `invalid` / `unreadable`. `missing` stays quiet Review. Tests 27/27. Re-checked in UI: toast gone, **Policy: Review** remains.

**Code turn**
- Switched to Code, opened `C:\Dev\grokforge`, sent a no-edit prompt.
- Engine: **Grok Code** · `AGENTS.md` · Review. Answered with `FORGE-CODE-OK` / `grokforge`. **Your turn** after.
- Screens: `docs/dogfood/session-open.png`, `docs/dogfood/code-turn.png`.

**Still noisy (not yet fixed)**
- First-run **Installer SHA-256 unavailable** on from-source (S1; expected until next published installer).
- Welcome wizard still covers a named home.
- Mid-turn chrome labels **THINKING FIELD** / **Mid-turn** feel raw vs Claude Code.
- Idle copy **YOUR TURN — TYPE THE NEXT MESSAGE BELOW** is shouty.
- Default `npm run start` is still prod-channel; easy to 403 the browser shell.

### 2026-08-29 — Review write actually asked
**Broke:** Review-mode write of `docs/dogfood/PROBE.md` completed with **no dock**. `Policy: Review` was a label. Cause: `~/.grok/config.toml` `permission_mode = "always-approve"` (TUI daily setting). Forge spawned `grok agent stdio` with no CLI override, so the vendor never sent `session/request_permission`.

**Fix:** map Forge policy onto vendor CLI flags (CLI overrides user config):
- Review → `grok --permission-mode default agent stdio` (ask)
- Trusted → `--permission-mode acceptEdits`
- Bypass → `grok agent --always-approve stdio`

`apps/host/src/agents.ts` + `session.ts` acquire. Tests 7/7 + acquire 8/8.

**Re-check:** same write. Dock **Allow once** clicked. File `PROBE-OK`. Chrome: “Permission requested: write” / “Allowed write”. Shot: `docs/dogfood/edit-turn.png`.

### 2026-08-29 — quieter idle / wait chrome
**Broke:** After a Code turn the transcript shouted **YOUR TURN — TYPE THE NEXT MESSAGE BELOW** (`text-transform: uppercase` on a long instruction). While waiting, Chat painted retired **Thinking field**.

**Fix:** Idle delimiter is **Your turn** (no uppercase tracking). Wait chrome uses **Waiting for model…** / the live `Waiting for Grok…` detail. `TURN_IDLE_COPY` in `MessageList.tsx`. Tests: MessageList.idle 3/3 + live-turn integration + Code Your-turn app test.

**Re-check:** Code turn answered `FORGE-CODE-OK grokforge`. Body idle is `Your turn`. No Thinking field. Shot: `docs/dogfood/code-turn.png`.

### 2026-08-29 — driving Forge Code (not idle)
Drove the DEV UI (`:5174`) with Playwright: Code mode, this repo, Review, **Allow once** when the dock appears. Not a leftover human window.

### 2026-08-29 — session/prompt 120s stall + from-source DEV default
**Broke (live):** Asked Forge Code to make `npm start` / `npm run dev` use DEV channel. It read files for ~2 min, then **Run failed**: `Agent RPC timeout after 120000ms: session/prompt`. Wall clock killed a live vendor turn — same class as elapsed-time-never-stall.

**Fix:** `packages/acp-client` — `session/prompt` has no handshake timeout (`ACP_PROMPT_RPC_TIMEOUT_MS = 0`); initialize/permission stay 120s. Child exit still ends the RPC. Tests 2/2. Dist rebuilt.

**Also landed (the task Forge was in the middle of):** from-source `npm start` / `dev:host` → `node scripts/run-host.mjs --channel=dev`. `npm run dev` → `scripts/dev-web.mjs` so Windows gets DEV env without `ENV=value`. `host:prod` unchanged. `scripts/package-scripts.test.mjs` green.

**Chrome:** yielded leftover label **Mid-turn** → **Earlier** (aria-label unchanged).

### 2026-08-29 — Forge Code loop holds; FILES strip sees vendor writes
Drove another Review write through the UI (`docs/dogfood/LOOP.md`, then `FILES.md`). **Allow once** → file on disk → **Your turn**. No 120s RPC death.

**Broke:** overview **files —** after an allowed vendor write (path never left the tool title).

**Fix:** stamp fs path from vendor `Write \`path\`` / `rawInput.path` onto `tool_run`; File changes membership also follows Review **Write file** allow (not only a diff decision); overview counts those paths. Tests: vendor-edit-path + runChangeList.

**Re-check:** `files FILES.md` in the run overview. Shot: `docs/dogfood/forge-files-strip.png`. File changes panel header still not visible in the transcript dump — next if it stays absent in the UI.

### 2026-08-29 — File changes lists Review vendor writes
**Broke:** After Allow once, overview showed `files FILES.md` but the **File changes** panel stayed absent. Review’s `session/request_permission` used the JSON-RPC id as `invocationId`, so membership could not join the write `toolCallId`. Windows vendor tests also fell over: fake `grok.exe` (copy of node) treated `--permission-mode` as a Node flag; `grok.cmd` without a shell was `EINVAL`.

**Fix:**
- Stamp `permission_request.toolCallId` from the vendor tool; host journals `invocationId` as that id (not the RPC id). Settle title stays **Write file** / **Run shell**.
- File changes membership follows Review **Write file** allow, not only a diff decision.
- Windows `.cmd` vendor shims spawn with a shell; live `grok.exe` argv is unchanged (`--permission-mode` still global). Dist rebuilt.

**Re-check:** Playwright Review write of `docs/dogfood/CHANGES.md`. Allow once. File on disk `CHANGES-OK`. Panel: **File changes** · `CHANGES.md` · Accepted. Shot: `docs/dogfood/forge-file-changes.png`. Tests: spawn permission/acquire 9/9, runChangeList 35/35, vendor-acp + edit-path.

**Still noisy (next):** absolute Windows path in the row; **THOUGHT** shout from CSS uppercase; answer glued `stop.Wrote` across a tool.

### 2026-08-29 — relative File changes path, Thought, paragraph break
**Broke (live shot):** File changes showed `C:\Dev\grokforge\docs\dogfood\CHANGES.md`. Thought shouted **THOUGHT**. Answer glued `stop.Wrote` across the write.

**Fix:** Relativize vendor write paths to the workspace; `.think-aloud summary` no longer uppercase; message chunks after a tool start a new paragraph.

**Re-check:** `docs/dogfood/REL.md` · File changes `docs/dogfood/REL.md` · **Thought** · two-paragraph answer. Shot: `docs/dogfood/forge-rel-path.png`.

### 2026-08-29 — vendor write shows a diff
**Broke:** File changes said **Diff unavailable** even though the vendor write `rawInput` had `file_path` + `content`.

**Fix:** Read `file_path`/`content` from vendor write input; stamp a new-file unified diff onto the tool_run.

**Re-check:** `docs/dogfood/DIFF.md` · Allow once · View diff shows `+DIFF-OK`. Shot: `docs/dogfood/forge-write-diff.png`.

**Still noisy:** Tool activity still quotes the vendor `Write \`C:\…\`` title; settled **Write file** decision repeats as a transcript card; giant **Open folder…** while a workspace is already pinned.

### 2026-08-29 — quieter write chrome
**Broke:** After Allow, tool activity quoted `Write \`C:\…\`` and a settled **Write file** card repeated the path under File changes.

**Fix:** Tool rows prefer the workspace-relative `activity.path`. Settled permission/diff decisions stay out of the transcript (dock + File changes own them).

**Re-check:** `docs/dogfood/CLEAN.md`. Tool activity `write docs/dogfood/CLEAN.md`. No Write file card. File changes + View diff `+CLEAN-OK`. Shot: `docs/dogfood/forge-write-clean.png`.

**Still noisy:** Activity extras still offer a second View diff (Trusted AC-03). **Open folder…** is a primary CTA on a pinned workspace.

### 2026-08-29 — Open folder is not the hero on a pinned workspace
**Broke:** Code sidebar kept a plasma **Open folder…** primary even with grokforge pinned.

**Fix:** Primary only when there are no pinned workspaces; otherwise ghost.

**Re-check:** Pinned grokforge is the focus; Open folder is outline. Shot: `docs/dogfood/forge-open-folder.png`.

### 2026-08-29 — Forge Code edited Forge source
Drove a Review Code turn that changed `apps/shell/src/RunSurface.tsx` (omit duplicate Policy under Tool activity). Allow once. File changes listed the path. Shot: `docs/dogfood/forge-code-edit.png`.

**Broke:** The View diff treated search-replace `new_string` as a brand-new file (`--- /dev/null`, 22 lines).

**Fix:** When vendor input has `old_string` + `new_string`, stamp that hunk (`--- a/` / `+++ b/`). Create-file writes still use `/dev/null`.

**Re-check:** One-line comment via search-replace. File changes hunk is `-function…` / `+// Policy line…` / `+const command…`. Shot: `docs/dogfood/forge-replace-hunk.png`.

**Still noisy:** Activity extras still offer a second View diff (Trusted AC-03). Welcome wizard / SHA leftovers. Overwrite-of-whole-file (no old_string) still has no before-image.

### 2026-08-29 — Forge Code ran the File changes tests
Review **Allow once** on shell. Command completed. Summary: **18 pass / 0 fail**. Shot: `docs/dogfood/forge-run-tests.png`. Edit + inspect + test now works in the DEV UI.

### 2026-08-29 — quieter run chips + thought after tools
**Broke:** Every Review turn shouted **Selection: inherited** and **Policy source: fallback**. Thought glued across a tool (`finishes.The user`).

**Fix:** Hide those chips when they are the default. Thought and answer each get a paragraph break after a tool (independent flags).

**Re-check:** `docs/dogfood/CHIPS.md`. Provenance is **Model: grok-4.6** · **Policy: review** only. Thought has a blank line after the write. Shot: `docs/dogfood/forge-quiet-chips.png`.

### 2026-08-29 — one View diff on Review writes
**Broke:** File changes **and** Tool activity both offered View diff after a Review Allow.

**Fix:** Activity extras keep View diff only for Trusted auto-applied (AC-03). Review File changes members do not duplicate it. Tests 19/19.

**Re-check:** `docs/dogfood/ONE.md`. File changes Hide diff only; no second button under Tool activity. Shot: `docs/dogfood/forge-one-diff.png`.

### 2026-08-29 — overwrite diffs have a before-image
**Broke:** Replacing an existing file still painted `--- /dev/null` as if it were new.

**Fix:** Snapshot the on-disk body at permission/first tool_call. Full-content writes against that baseline become `--- a/` / `-old` / `+new`.

**Re-check:** Overwrite `ONE.md` ONE-OK → ONE-TWO. Diff `-ONE-OK` / `+ONE-TWO`. Shot: `docs/dogfood/forge-overwrite.png`.

### 2026-08-29 — session titles clamp to two lines
**Broke:** Long prompts in the Code sidebar wrapped without a cap.

**Fix:** `.session-title` is two-line clamped with ellipsis.

### 2026-08-29 — Thought gap after tools
**Broke:** Thought after a write had an extra blank (`stop.` then two empty lines). Cause: paragraph break armed on both `tool_call` and `tool_call_update`, and `\n\n` stacked on a chunk that already ended a line.

**Fix:** Arm the break only on `tool_call`. Prefix one blank line, not two, when the previous thought already ended with a newline. Tests 7/7.

**Re-check:** `docs/dogfood/GAP2.md`. Thought is two paragraphs with one blank line. Shot: `docs/dogfood/forge-thought-gap2.png`.

### 2026-08-29 — always-on loop
Operator: keep going always, no pausing. Recurring dogfood pass every 5 minutes. SHA/welcome leftovers stay installer/first-run honesty.

### 2026-08-29 — paste-path row is not a second Open folder
**Broke:** With grokforge pinned, the sidebar still showed a full path field + **Open** under the session list.

**Fix:** When workspaces exist, that row is a **Paste a path** disclosure. Native Open folder still focuses/opens it if the picker is unavailable.

**Re-check:** Shot `docs/dogfood/forge-paste-path.png` — **Paste a path** instead of the duplicate Open control.

### 2026-08-29 — two Review writes in one turn
Drove two files. Two **Allow once**. File changes count **2**: `MULTI_A.md` + `MULTI_B.md`, both Accepted, each with a new-file diff. Shot: `docs/dogfood/forge-two-files.png`.

### 2026-08-29 — composer Grok Code is not a second pill
**Broke (live):** Composer footer painted a gradient **Grok Code** chip beside `grokforge · grok-4.6 · oauth`. Same identity as the per-run provenance pill — two matching chips on a Code turn.

**Fix:** Happy-path vendor CodeAgentStatus is `is-quiet` inline meta (no border/gradient), grouped with composer-meta as `Grok Code · grokforge · grok-4.6 · oauth`. Mini-Grok / checking / hard_fail / offline keep chip chrome. Run provenance chip unchanged. Tests: CodeAgentStatus 8/8 + spawn-grok-agent 10/10 + footer order.

**Re-check:** DEV UI composer is one meta line, not a pill. Review write `docs/dogfood/QUIET.md` Allow once → `QUIET-OK`. File changes + View diff. Run still has Grok Code provenance. Shots: `docs/dogfood/forge-quiet-vendor-composer.png`, `docs/dogfood/forge-quiet-vendor.png`.

**Still noisy:** Collapsed **Earlier** mid-turn after a simple write (pre-tool narration also in the answer). SHA/welcome leftovers stay installer/first-run honesty.

### 2026-08-29 — Earlier does not duplicate the answer
**Broke (live):** After a Review write, a collapsed **Earlier** row sat between Thought and File changes. Mid-turn was the same “Creating… / Created…” already in the Answer. Fold required the answer to be *strictly longer* than mid-turn, so exact copies (and backtick/whitespace twins) kept the empty disclosure.

**Fix:** `midturnFoldedIntoAnswer` folds when the vouched answer contains the narration (equal copies, whitespace, markdown ticks, or every mid-turn paragraph). Unique extra paragraphs still show Earlier. Unvouched/cancelled mid-turn unchanged. Tests: acp-live-streams component + app 27/27.

**Re-check:** `docs/dogfood/FOLD.md` Allow once → `FOLD-OK`. No **Earlier** row. File changes + Hide diff `+FOLD-OK`. Shot: `docs/dogfood/forge-no-earlier.png`.

**Still noisy:** Thought stays fully expanded after a simple write. One earlier write showed **Diff unavailable** (flaky; this re-check had a diff). SHA/welcome leftovers stay installer/first-run honesty.

### 2026-08-29 — Thought folds when the turn settles
**Broke:** After a simple write, Thought stayed fully expanded (two reasoning paragraphs) between the prompt and File changes.

**Fix:** Thought opens while the run is live; on terminal it collapses to the **Thought** summary (still foldable). Tests 17/17.

**Re-check:** `docs/dogfood/THOUGHT.md`. Thought is a one-line fold, then File changes. Shot: `docs/dogfood/forge-thought-fold.png`.

### 2026-08-29 — no Loading hooks band after a simple write
**Broke:** Settled Review writes showed a **Loading hooks…** strip between File changes and Tool activity when the vendor advertised no hooks.

**Fix:** Hydrating with no members on a terminal run projects absent, not loading. Live hydrating with no prior still shows Loading. Tests 32/32.

**Re-check:** `docs/dogfood/HOOKS.md`. Dump has no Loading hooks. Shot: `docs/dogfood/forge-no-hooks-band.png`.

### 2026-08-29 — new-file Review writes keep a diff
**Broke (flaky):** A late on-disk snapshot after the vendor write made before === after, so File changes said **Diff unavailable**.

**Fix:** Identical baseline/body still stamps a new-file hunk (`--- /dev/null` + landed bytes) instead of dropping the diff.

**Re-check:** `docs/dogfood/FLAKE.md` Allow once → Hide diff `+FLAKE-OK`. Shot: `docs/dogfood/forge-newfile-diff.png`. Host `npm start` wrapper died (tsx -1); something still serves `:8788` (200).

### 2026-08-29 — no Allowed write toast after Allow once
**Broke:** After Allow once, a success toast **Allowed write** sat on the composer until it timed out.

**Fix:** Allow once does not toast — File changes **Accepted** is the settlement. Deny and Allow for session still toast.

**Re-check:** `docs/dogfood/NOTOAST.md`. Dump has no Allowed write. Shot: `docs/dogfood/forge-no-allow-toast.png`.

### 2026-08-29 — quieter vendor session logs
**Broke:** Each Code turn logged **Unmapped vendor sessionUpdate kind: session_info_update** / **user_message_chunk**, plus ~100 **Skipped unusable available_commands member** lines.

**Fix:** Those two sessionUpdate kinds are known no-ops. Invalid catalog members skip as one summary (`Skipped 103 unusable available_commands members.`). Tests 11/11.

**Re-check:** `docs/dogfood/QUIETLOG.md`. New host log has the summary, not per-member spam, and no session_info_update unmapped. Shot: `docs/dogfood/forge-quiet-logs.png`.

### 2026-08-29 — Review write diff is not flaky-unavailable
**Broke (live):** `THOUGHT.md` landed on disk as Accepted but File changes said **Diff unavailable**. Late snapshot of the already-written file made `existing === body`, so `vendorWriteDiff` returned null. Vendor completed tool_calls also sometimes omit `rawInput.content`.

**Fix:** If we have a write body (from input or the on-disk file after a completed write), always stamp a diff: overwrite hunk when the baseline differs, otherwise a new-file `+body` hunk. Tests: vendor-edit-path 8 new-case pass (late snapshot + disk body). Dist rebuilt; DEV host restarted.

**Re-check:** `docs/dogfood/LAND.md` Allow once → `LAND-OK`. File changes Hide diff `+LAND-OK`. Thought stays folded. Shot: `docs/dogfood/forge-write-diff-retry.png`.

**Still noisy:** **Allowed write** toast sits on the composer after the turn. SHA/welcome leftovers stay installer/first-run honesty.

### 2026-08-29 — Earlier is a quiet fold, not an empty card
**Broke:** After a simple write, a tall empty **Earlier** card sat between Thought and File changes. Vendor journals pre- and post-tool message into both mid-turn and the vouched answer, so hiding Earlier when texts are equal would break mid-turn-only AC.

**Fix:** When the answer is longer and contains the mid-turn (including markdown ticks), omit Earlier. When they are the same, keep Earlier but collapsed chrome is a quiet summary, not a hollow card. Tests 14/14.

**Re-check:** `docs/dogfood/QUIET2.md`. Thought then File changes — no Earlier card. Shot: `docs/dogfood/forge-earlier-quiet.png`.

### 2026-08-29 — Permission requested chip leaves after Allow
**Broke (live):** After Allow once, **Permission requested: write** stayed under Answered. File changes already said Accepted. Rail evidence only *adds* pending chips and returned early when none remained.

**Fix:** Retract settled permission/diff rail chips (including on `run_terminal`). Visible transcript hides those chips unless the run still has pending rail evidence. Pending dock/rail AC5 unchanged. Tests: live-turn-attention projection + App 23/23.

**Re-check:** `docs/dogfood/RAIL.md` Allow once → `RAIL-OK`. Dump has Answered then Your turn — no Permission requested. Shot: `docs/dogfood/forge-no-perm-chip.png`.

**Still noisy:** Composer placeholder was **Type a message to send**. SHA/welcome leftovers stay installer/first-run honesty.

### 2026-08-29 — composer keeps continuum copy on empty draft
**Broke (live):** Empty Code composer used the Send-disabled reason as the textarea placeholder, so the box said **Type a message to send** instead of **Speak into the continuum… @file · attach · Enter send**.

**Fix:** Empty-draft still disables Send (`EMPTY_DRAFT_SEND` title). Continuum copy stays as placeholder. Real lock reasons (no folder, offline, dock) still replace the prompt. Tests: ComposerPane 4/4.

### 2026-08-29 — Open folder is compact when a project is pinned
**Broke (live):** With grokforge pinned, a full-width **Open folder…** still sat at the top of the Code sidebar above search — the first thing you look at despite a project already being open.

**Fix:** No workspaces → primary Open folder remains the hero. Pinned workspaces → search row + compact **Open folder…** beside it. Tests: named-projects compact button + AC12g 13/13.

**Re-check:** Sidebar is search + compact Open folder, then pinned grokforge. Review write `docs/dogfood/SIDE.md` → `SIDE-OK`. Shot: `docs/dogfood/forge-open-folder-compact.png`.

**Still noisy:** SHA/welcome leftovers stay installer/first-run honesty.

**Re-check:** DEV Code composer placeholder is the continuum line. Send stays disabled until there is a draft. Shot: `docs/dogfood/forge-placeholder.png`.

**Still noisy:** Fresh Playwright profiles still see **Forge didn't find your earlier conversations** (host `priorConversations` vs empty browser store — AC12b). SHA/welcome leftovers stay installer/first-run honesty.

### 2026-08-29 — placeholder write through Code
**Re-check:** Review write `docs/dogfood/PLACEHOLDER.md` Allow once → `PLACEHOLDER-OK`. File changes + Hide diff. Shot: `docs/dogfood/forge-placeholder-write.png`.

### 2026-08-29 — answer inline code is not a chip; tool status is not shouted
**Broke (live):** Settled answers painted every `` `path` `` as a cyan bordered pill. Tool rows shouted **COMPLETED** via `text-transform: uppercase`.

**Fix:** Inline code is quiet monospace (no border). Tool status is sentence case (`Completed` / `Failed` / `Running`). Tests: run.quiet-chrome 2/2 + ToolActivity + pdf-extract.

**Re-check:** `docs/dogfood/INLINE.md` Allow once → `INLINE-OK`. Answer reads as sentences. Tool row **Completed**. Shot: `docs/dogfood/forge-quiet-inline.png`.

**Still noisy:** Compact **Open folder…** beside search truncated **Search projects & sessions…**. SHA/welcome leftovers stay installer/first-run honesty.

### 2026-08-29 — Open folder is an icon when a project is pinned
**Broke (live):** Compact **Open folder…** sat on the search row and ate the placeholder.

**Fix:** Pinned Code workspaces use an icon-only Open folder (accessible name unchanged). Search keeps the row. Tests: named-projects compact case.

**Re-check:** Search is ~208px, folder icon 37px, placeholder readable. Shot: `docs/dogfood/forge-open-compact.png`.

**Still noisy:** Disabled **Send** still glowed like a live primary. SHA/welcome leftovers stay installer/first-run honesty.

### 2026-08-29 — disabled Send is not a plasma CTA
**Broke (live):** Empty composer still painted **Send** with the full glow. It was disabled, but it looked like the thing to click.

**Fix:** `.composer > .btn.primary:disabled` drops the glow (`box-shadow: none`, lower opacity). Tests: run.quiet-chrome.

**Re-check:** Empty Send opacity 0.4, no shadow. Draft restores the primary fill. Shots: `docs/dogfood/forge-send-disabled.png`, `docs/dogfood/forge-send-quiet.png`.

**Still noisy:** Fresh Playwright profiles still see **Forge didn't find your earlier conversations**, and **Start a new conversation** left that card up. SHA/welcome leftovers stay installer/first-run honesty.

### 2026-08-29 — Start a new conversation actually starts
**Broke (live):** Host `priorConversations` + empty browser store showed the not-found alarm. **Start a new conversation** created an empty session but the card stayed (no messages ⇒ `hasAnyStoredHistory()` still false).

**Fix:** That button dismisses the alarm for this session (does not persist; launch still warns if the store is empty). Does not swap in Welcome. AC12b/f/g launch and POST-survival tests unchanged. Tests: App.notFound 9/9 + App.ac12g 17/17.

**Re-check:** Alarm 1→0. **Code continuum** sample prompts. Continuum placeholder. Dim Send. First version of this button also spawned a second empty **New chat**. Now it only dismisses. Shot: `docs/dogfood/forge-start-new.png` (one session).

**Still noisy:** SHA/welcome leftovers stay installer/first-run honesty.

### 2026-08-29 — Review write after continuum empty state
**Re-check:** `docs/dogfood/CONTINUUM.md` Allow once → `CONTINUUM-OK`. File changes + Hide diff. Tool row **Completed**. Quiet inline code. Shot: `docs/dogfood/forge-continuum-write.png`.

### 2026-08-29 — run tests through Code
Drove Review to run `ComposerPane.test.tsx` + `run.quiet-chrome.test.ts` from `apps/shell`. Four **Allow once** (cwd then the real command). Answer: **7 passed, 0 failed**. No File changes. Shot: `docs/dogfood/forge-run-tests.png`.

### 2026-08-29 — typecheck through Code
Drove Review `npm run typecheck` from `apps/shell`. Three **Allow once**. **Passed**, `tsc -b --noEmit` exit 0. Continuum placeholder still on empty composer. Shot: `docs/dogfood/forge-typecheck.png`.

**Still noisy:** 900px viewport clips the composer Send well. SHA/welcome leftovers stay installer/first-run honesty.

### 2026-08-29 — shell rows show the command
**Broke (live):** A Review test turn painted three **run terminal command** rows (forced lowercase) plus truncated `Execute \`…\``. Status **Completed** wrapped vertically. Group subtitle repeated **run terminal command**.

**Fix:** Generic shell names (`run terminal command` / `run_shell`) use the command (or `Execute \`cmd\``) as the row caption in monospace. No summary duplicate. Command rows use a 4-column grid so **Completed** stays on one line. Group subtitle skips generic names. Tests: activityLabel + ToolActivity 15/15.

**Re-check:** `echo FORGE-SHELL-OK` is the tool row; group is **Completed**. Shot: `docs/dogfood/forge-shell-cmd.png`.

**Still noisy:** Failed cwd retries still say Completed (vendor `completed` ≠ exit 0). SHA/welcome leftovers stay installer/first-run honesty.

### 2026-08-29 — composer stays in the 900px stack
**Broke (live):** After a typecheck turn, Send sat on the viewport edge and the composer footer was gone. The resizable main panel did not pass a bounded height, so the transcript’s content height pushed the composer off-screen.

**Fix:** `.main-panel` / `.main` fill the layout (`height: 100%; min-height: 0`). `.composer-wrap` does not shrink. Tests: run.quiet-chrome.

**Re-check:** `docs/dogfood/STACK.md` Allow once → `STACK-OK`. Composer, Send, Effort, Policy all on screen. Shot: `docs/dogfood/forge-composer-stack.png`.

### 2026-08-29 — non-zero shell exit is Failed
**Broke (live):** `node -e "process.exit(2)"` ran (exit 1/2) but Tool activity said **Completed**. Vendor ACP `completed` means the tool finished, not exit 0. The helper existed in source but was not in dist, and rawOutput `{exit_code}` objects were ignored.

**Fix:** `vendorUpdateImpliesNonZeroExit` reads JSON `exit_code` / `exitCode`, `Exit code: N` prose, and rawOutput objects. `completed` + non-zero → `tool_run` failed. Dist rebuilt; DEV host restarted. Tests: vendorShellExit + vendor-edit-path shell cases.

**Re-check:** `process.exit(2)` Allow once. Group **1 failed**. Row **Failed**. Shot: `docs/dogfood/forge-shell-fail3.png` (first shot still had Completed before the dist/host bounce).

**Still noisy:** Failed peek body is just `completed`. SHA/welcome leftovers stay installer/first-run honesty.

### 2026-08-29 — failed peek is not the word completed
**Broke (live):** The Failed row’s peek was the vendor status word **completed**.

**Fix:** When the only body is `completed` / `failed` / `error`, peek **Non-zero exit**. A specific error (`task not found`) still wins. Tests: ToolActivity 11/11.

**Re-check:** `forge-shell-fail4.png` — row **Failed**, peek **Non-zero exit**.

### 2026-08-29 — TUI system-reminder does not stay in the answer
**Broke (live):** A failed shell’s vouched answer included a raw `<system-reminder>` / `get_command_or_subagent_output` block from the vendor Grok agent.

**Fix:** Display strips `<system-reminder>…</system-reminder>` from the answer. Store/fold unchanged. Tests: vendorAnswerClean 2/2.

### 2026-08-29 — Grok TUI output-fetch is Not in Forge
**Broke (live):** After a shell, the vendor sometimes calls `get_command_or_subagent_output`. Forge does not run that TUI tool, so the row was a second **Failed** / **task not found**.

**Fix:** That name is **Not in Forge** (not Failed). Peek: **Not available in Forge Code.** Stats count it as not-run. No engine invented. Tests: activityLabel + ToolActivity 18/18.

**Re-check:** `process.exit(2)` this turn did not call the TUI tool. **1 failed**, peek **Non-zero exit**, no second Failed row. Shot: `docs/dogfood/forge-tui-tool.png`.

### 2026-08-29 — overwrite write still has a hunk
**Re-check:** `docs/dogfood/NEXT.md` Allow once → `NEXT-OK` (overwrite `-NEXT-TWO` / `+NEXT-OK`). File changes + Tool **Completed**. Composer on screen. Shot: `docs/dogfood/forge-write-next.png`.

**Still noisy:** One-line answer fences still painted **CODE · 1 LINES · Copy**.

### 2026-08-29 — one-line unlabeled fence is compact
**Broke (live):** A one-line fenced `NEXT-OK` / `ONELINE-OK` in the answer sat in a **CODE · 1 LINES · Copy** card.

**Fix:** Unlabeled one-line fences are `.is-oneline` (line + Copy, no bar). Empty and typed fences keep chrome. Tests: markdown.oneline + CodeBlock 13/13.

**Re-check:** `docs/dogfood/ONELINE.md` Allow once → `ONELINE-OK`. Answer is one compact line + Copy. Shot: `docs/dogfood/forge-oneline-code.png`.

### 2026-08-29 — Review search-replace has one View diff
**Broke (live):** Search-replace of `NEXT.md` showed File changes **and** a second **View diff** under Tool activity. Coverage used activityId/editId only, so a sibling replace row with the same path still duplicated the button.

**Fix:** `changeListCoversActivity` also matches File changes **path**. Review extras hide View diff when that path is already listed. Trusted auto-applied still keeps Activity View diff (AC-03). Tests: inspectable-run-changeset 20/20.

**Re-check:** `NEXT.md` → `NEXT-THREE`. File changes Hide diff only. No View diff under Tool activity. Shot: `docs/dogfood/forge-one-diff-sr.png`.

**Still noisy:** Vendor old_string can lag the on-disk body (`-NEXT-OK` when disk was `NEXT-TWO`). SHA/welcome leftovers stay installer/first-run honesty.

### 2026-08-29 — stale search-replace old_string uses disk
**Broke:** Vendor `old_string` can lag the file (`-NEXT-OK` when disk was `NEXT-TWO`). File changes then lied about the minus side.

**Fix:** When `old_string` is not in the on-disk baseline and both sides look like a short whole-file body, stamp the hunk from the baseline (or landed disk) instead of the stale pair. Snippet replaces in large files still use the vendor pair. Tests: vendor-edit-path 12/12. Dist rebuilt; host restarted.

**Re-check:** Live replace `NEXT.md` → `STALE-OK` hunk `-NEXT-THREE` / `+STALE-OK` (vendor read first, so old_string matched). Stale case covered by the tmp-file test (`-NEXT-TWO` not `-NEXT-OK`). Shot: `docs/dogfood/forge-stale-hunk.png`.

### 2026-08-29 — overview strip does not leak the prompt
**Broke (live):** After a tall File changes card, the last line of **You** sat under a nearly transparent overview strip.

**Fix:** `.overview-strip` uses `var(--bg)`. Transcript gets `scroll-padding-top`. Tests: run.quiet-chrome 5/5.

**Re-check:** `SCROLL.md` Allow once → `SCROLL-OK`. Strip is solid; no prompt text through it. Shot: `docs/dogfood/forge-prompt-scroll.png`.

### 2026-08-29 — replace hunk is always disk-to-disk
**Broke:** Even with the stale-pair heuristic, a later turn could still show a minus side that was not the permission-time file. `writeBaselines` kept the first snapshot for the session.

**Fix:** Permission re-snapshots the path. After the write, if baseline ≠ on-disk body, File changes is that hunk (not vendor `old_string`). Tests: stale old_string tmp-file 1/1 + search_replace/overwrite still green. Dist rebuilt; host restarted.

**Re-check:** `NEXT.md` → `NEXT-FOUR`. Hunk `-STALE-OK` / `+NEXT-FOUR` (disk at Allow). No extra View diff. Shot: `docs/dogfood/forge-replace-disk.png`.

**Still noisy:** SHA/welcome leftovers stay installer/first-run honesty.

### 2026-08-29 — You prompt is a card, not strip chrome
**Broke (live):** After a Review write, auto-scroll clipped **You** / **Grok Code**. The prompt sat unlabeled on `--bg` flush under the overview strip (`LOOP2.md`, `STRIP.md`) and read as a second strip line. Opaque strip bg did not separate it.

**Fix:** `.run-prompt` is a sticky one-line card (`YOU` + ellipsis body, `var(--bg)`, border). Full prompt stays on `title`. Overview strip `flex-shrink: 0`. Tests: run.quiet-chrome 6/6 + RunSurface You-card 1/1.

**Re-check:** `docs/dogfood/STICK.md` Allow once → `STICK-OK`. Strip is stats only. **YOU** card with the prompt; Thought fully visible under it. File changes + Hide diff `+STICK-OK`. Shots: `docs/dogfood/forge-strip-before.png`, `docs/dogfood/forge-you-stick.png`.

**Still noisy:** SHA/welcome leftovers stay installer/first-run honesty.

### 2026-08-29 — ToolKind missing is not a warn on ordinary writes
**Broke (live):** Every Code write/read logged **ToolKind class seam: (missing)** because vendor omits `kind` on those tools. Title-only **Browse** / **Fetch** still needs the seam.

**Fix:** Missing kind only warns when the title looks like browse/http/fetch. `other` / `execute` still warn. Tests: client.fetch-class (missing-kind write/read silent; Browse title-only still seams). Dist rebuilt; DEV host restarted.

**Re-check:** Review write `docs/dogfood/SKILLS.md` → `SKILLS-OK`. Host log after restart has no **ToolKind class seam: (missing)**. Shot: `docs/dogfood/forge-acp-names.png`.

### 2026-08-29 — vendor slash commands list in Skills
**Broke (live):** Vendor ACP advertises 103 commands as `name: "compact"` (no leading slash, ACP spec). Forge required `/name`, skipped all 103, host **malformed available_commands ignored**, Skills said **Couldn't load skills.** Handshake also dropped ads until identity was stamped vendor.

**Fix:** Normalize unprefixed ACP names to `/name` (whitespace/empty still skip; all-skipped stays `valid: false`). Stamp vendor + `awaiting` before handshake; apply catalog on Code even before sessionId. Tests: skills-catalog + skillsCatalog parse (ACP `/web` `/plan`; interior junk is whitespace). Dist rebuilt; host restarted.

**Re-check:** `/` in Code composer → Skills **ready** with **103** commands (`/compact`, `/context`, `/spire-tech`, …). Host: `skills catalog ready count=103`. No skip-103, no malformed. Shot: `docs/dogfood/forge-skills-palette.png`.

**Also:** Skill descriptions ellipsize to one line; palette `max-height: min(360px, 45vh)` so more than three rows fit.

**Still noisy:** Figma MCP `AuthRequired` and **Incomplete vendor MCP advertisement ignored (no status)** on every Code session. SHA/welcome stay installer/first-run honesty. `/always-approve` is a vendor-advertised skill — Forge policy stays Review/Trusted/Bypass.

### 2026-08-29 — MCP roster without status is a silent no-op
**Broke (live):** Every Code session logged **Incomplete vendor MCP advertisement ignored (no status)** for `_x.ai/mcp/servers_updated` (name list, no per-server status). Not journalable; the warn was noise.

**Fix:** That method is a known no-op (same class as `session_info_update`). No `mcp_server` member, no warn. Status still comes from `_x.ai/mcp/server_status`. Tests: client.mcp-server 8/8. Dist rebuilt; host restarted.

**Re-check:** `MCP-QUIET-OK` Code turn. Host after restart has `skills catalog ready count=103` and no incomplete-MCP warn. Shot: `docs/dogfood/forge-mcp-quiet.png`.

**Still noisy:** Figma MCP `AuthRequired` (vendor ~/.grok MCP config — standing). SHA/welcome stay installer/first-run honesty.

### 2026-08-29 — `/session-info` runs in Forge Code
**Re-check:** Sent `/session-info` in Code. Vendor answered with session id, `C:\Dev\grokforge`, grok-4.6, turn 0, context 1516/500000. No dock. Shot: `docs/dogfood/forge-skill-session-info.png`.

Slash skills advertised by the vendor now both **list** and **run** in Forge Code. Policy stays Review.

### 2026-08-29 — Grok Code chip survives a fast slash turn
**Broke (live):** `/session-info` finished before POST `/api/prompt` returned. The YOU card had Model/Policy but no **Grok Code** chip. `mergeRunSnapshot` refused to update an already-terminal run, so the late stamp was dropped.

**Fix:** Late POST snapshots may still apply `codeAgentProvenance` / skill handoff when the terminal projection has none. Existing stamps are not rewritten. Tests: codeRunProvenance 9/9.

**Re-check:** `/session-info` again. YOU card has **Grok Code** · grok-4.6 · review. Shot: `docs/dogfood/forge-grok-chip.png`.

### 2026-08-29 — Grok Code and Model/Policy live in the You card
**Broke (live):** After a Review write, auto-scroll tucked the **Grok Code** run chip under the overview strip (`y=86` vs strip `y=93`) and **Model / Policy** under the sticky You card (`prov y=162` vs You `y=146–182`). Shot: `docs/dogfood/forge-clip-now.png`. Same class as the last You-card fix — the identity pill sat between strip and You and disappeared.

**Fix:** Move run provenance into the sticky You card (prompt row + quiet meta). Happy-path vendor **Grok Code** is `is-quiet` (no gradient pill). Fallback/error keep chip chrome. Tests: run.quiet-chrome 6/6, RunSurface You-card 2/2, CodeRunProvenanceChip 3/3, spawn-grok-agent 10/10, slash-skills 17/17.

**Re-check:** `docs/dogfood/CARD.md` Allow once → `CARD-OK`. Layout: Grok Code + Model/Policy inside You (`grokInsideYou`, `provInsideYou`), below the strip, not covered. File changes + Hide diff `+CARD-OK`. Shot: `docs/dogfood/forge-you-card-meta.png`.

**Still noisy:** Figma MCP `AuthRequired` (vendor ~/.grok). SHA/welcome stay installer/first-run honesty. Plasma **New session** is still the loudest sidebar CTA on a pinned workspace.

### 2026-08-29 — answer inline code is not a chip
**Broke (live):** Settled answers still painted every `` `path` `` as a gray pill (`background: color-mix(text 8%)`, pad `0 0.2em`). The earlier “no border” quieting left the fill. Shot: `docs/dogfood/forge-next-loop.png`. DEV banner also ran `~/.grokforge-dev· safe` (JSX trimmed the space after `</code>`).

**Fix:** `.md-inline-code` is `background: none`, no pad, accent-mixed color. Banner copy is `{" · safe beside Prod"}`. Tests: run.quiet-chrome 6/6.

**Re-check:** `docs/dogfood/QUIETCODE.md` Allow once → `QUIETCODE-OK`. Inline path/token have transparent bg, 0 pad. Banner `~/.grokforge-dev · safe beside Prod`. File changes + Hide diff `+QUIETCODE-OK`. Shot: `docs/dogfood/forge-quiet-code.png`.

**Still noisy:** Figma MCP `AuthRequired` (vendor ~/.grok). SHA/welcome stay installer/first-run honesty. Empty composer is still a tall 3-row pill (~196px).

### 2026-08-29 — New session is not the sidebar hero
**Broke (live):** With grokforge pinned, **New session** was a full-width loud bar above the active session — the first thing in the folder.

**Fix:** Ghost button + plus icon, muted, left-aligned. Chat **New chat** stays the primary hero when there is no folder. Tests: named-projects compact case also asserts New session is ghost.

**Re-check:** `/session-info`. Sidebar New session is a quiet text control; the session card is the emphasis. Shot: `docs/dogfood/forge-new-session-quiet.png`.

### 2026-08-29 — empty Send is as quiet as Attach
**Broke (live):** Idle empty composer still painted Send as a bright plasma pill (disabled opacity 0.4 was not enough).

**Fix:** Disabled primary Send is grayscale + lower opacity, no glow.

**Re-check:** `/session-info` idle. Send matches Attach/Export weight. Shot: `docs/dogfood/forge-send-dim.png`.

### 2026-08-29 — Your turn sits on the composer, not in the void
**Broke (live):** After a short Code turn, **Your turn** floated in the middle of the empty transcript (`forge-send-dim.png`).

**Fix:** `.transcript > .turn-delimiter` uses `margin-top: auto` so leftover column space is above it. Cue sits just above the composer. Tests: run.quiet-chrome 7/7.

**Re-check:** `/session-info`. **Your turn** is on the composer edge, not mid-void. Shot: `docs/dogfood/forge-your-turn.png`.

### 2026-08-29 — empty composer is a short pill
**Broke (live):** Idle Code composer was a 3-row sausage (`rows=3`, min-height 52px).

**Fix:** Default two rows (compact: one). min-height 44px. Tests: ComposerPane 6/6.

**Re-check:** `/session-info` idle. Composer is a short pill; composer-wrap height 173 vs 196. Shot: `docs/dogfood/forge-composer-short.png`.

### 2026-08-29 — Answered is a chip, not a status bar
**Broke (live):** Settled **Answered** used `.run-status` (full-width bar, space-between). It painted as a long empty capsule under the answer.

**Fix:** `.run-answered` is `inline-flex` / `max-content`. Tests: run.quiet-chrome 8/8 + reliable-autonomous-runs component 27/27.

**Re-check:** `/session-info`. Answered is a small chip under the answer card. Shot: `docs/dogfood/forge-answered-chip.png`.

### 2026-08-29 — Review write still lands after chrome wave
**Re-check:** `docs/dogfood/KEEP.md` Allow once → `KEEP-OK`. File changes Hide diff `+KEEP-OK`. Tool **Completed**. Inline code not a chip. Grok Code in You card. Shot: `docs/dogfood/forge-keep-write.png`.

### 2026-08-29 — one write does not say Completed twice
**Broke (live):** A single write showed **Completed** on the Tool activity header and again on the row.

**Fix:** Group subtitle omits Completed when there is only one tool (row status is enough). Multi-tool still summarizes. Tests: ToolActivity 12/12.

**Re-check:** `KEEP.md` → `KEEP-TWO`. Header is **Tool activity**; row **Completed**. Hunk `-KEEP-OK` / `+KEEP-TWO`. Shot: `docs/dogfood/forge-one-completed.png`.

### 2026-08-29 — You-card provenance is Grok Code · Model · Policy
**Broke (live):** You-card meta ran together as `Grok CodeModel: grok-4.6Policy: review`.

**Fix:** Adjacent provenance children get a `·` via CSS; the group `aria-label` joins the same way. Tests: run.quiet-chrome 10/10 + RunSurface You-card.

**Re-check:** `/session-info`. Meta is **Grok Code · Model: grok-4.6 · Policy: review**. Shot: `docs/dogfood/forge-prov-sep.png`.

### 2026-08-29 — Forge Code ran ComposerPane tests
**Re-check:** Review shell Allow once. First two shells failed (cwd was repo root). `cd apps/shell` then **6 pass / 0 fail**. Shot: `docs/dogfood/forge-run-composer-tests.png`.

### 2026-08-29 — sticky You card masks the strip gap
**Broke (live):** A tall test-run answer painted a sentence between the overview strip and the You card.

**Fix:** Transcript padding-top 12px. You card `box-shadow` includes an upward `var(--bg)` mask. Tests: run.quiet-chrome 11/11.

**Re-check:** `/session-info`. You card sits tighter under the strip (y 134 vs 146). Shot: `docs/dogfood/forge-you-mask.png`.

### 2026-08-29 — KEEP overwrite still disk-to-disk
**Re-check:** `KEEP.md` → `KEEP-FIVE`. Allow once. Hunk `-KEEP-FOUR` / `+KEEP-FIVE`. Hide diff is `btn ghost`. Shot: `docs/dogfood/forge-answered-pad.png`.

### 2026-08-29 — View diff keep-end leaves Answered above the composer
**Broke (live):** Dogfood clicks View diff after settle. File changes grew, keep-end did not re-run, **Answered** / **Your turn** sat under the composer (`answeredCoveredByComposer`).

**Fix:** Opening a File changes diff while near the transcript end scrolls to the new end. Tests: FileChangesSection + RunSurface artifacts 27/27.

**Re-check:** `KEEP.md` → `KEEP-SIX`. Hide diff expanded. Answered chip and Your turn fully above composer (`answeredCoveredByComposer: false`). Shot: `docs/dogfood/forge-diff-keepend.png`.

**Still noisy:** Figma MCP `AuthRequired` (vendor ~/.grok). SHA/welcome stay installer/first-run honesty.

### 2026-08-29 — sidebar Messages/Settings are not pills
**Broke (live):** Code sidebar **Messages** / **Settings** were bordered filled pills (`background: var(--bg3)`, 8px pad) — a second Settings next to the topbar gear. Shot: `docs/dogfood/forge-elect-loop.png`.

**Fix:** `.nav-tabs button` has no border/fill. Active is an inset accent underline. Tests: run.quiet-chrome 9/9.

**Re-check:** `docs/dogfood/NAVTABS.md` Allow once → `NAVTABS-OK`. Messages bg transparent, border none, underline. File changes `+NAVTABS-OK`. Shot: `docs/dogfood/forge-nav-tabs.png`.

**Still noisy:** Figma MCP `AuthRequired` (vendor ~/.grok). SHA/welcome stay installer/first-run honesty. You-card provenance still concatenates `Grok CodeModel: grok-4.6`.

### 2026-08-29 — Hide diff is text, not a pill
**Broke (live):** File changes **Hide diff** was a 36px bordered ghost pill (`pad 7px 12px`, radius 14px, accent hover fill). Shot: `docs/dogfood/forge-loop3.png`.

**Fix:** `.file-changes-actions .btn.ghost` is a 12px text control (no border/fill, min-height 0). Tests: run.quiet-chrome 11/11, FileChangesSection 21/21.

**Re-check:** `docs/dogfood/HIDEDIFF.md` Allow once → `HIDEDIFF-OK`. Hide diff h=22, bg transparent, border none. Shot: `docs/dogfood/forge-hide-diff.png`.

**Still noisy:** Figma MCP `AuthRequired` (vendor ~/.grok). SHA/welcome stay installer/first-run honesty.

### 2026-08-29 — Your turn stays above the composer after a write
**Broke (live):** After a Review write, **Your turn** sat under the composer (`y=741` vs composer `y=727`). Code turns paint through RunSurface, so stick-to-bottom never saw `messages` change. Dogfood **View diff** then grew File changes and buried the cue. Shot: `docs/dogfood/forge-loop4.png`.

**Fix:** Transcript `scrollTop = scrollHeight` on run projection updates and when `turnReady`. Padding-bottom / scroll-padding-bottom keep the cue off the composer. Tests: run.quiet-chrome 12/12.

**Re-check:** `docs/dogfood/IDLEFOLD.md` Allow once → `IDLEFOLD-OK` (diff left collapsed). Your turn `y=633`, composer `y=727`, not covered. Answered visible. Shot: `docs/dogfood/forge-idle-fold.png`.

**Still noisy:** Expanding View diff can still push Your turn under the composer. Figma MCP `AuthRequired` (vendor ~/.grok). SHA/welcome stay installer/first-run honesty.

Folded: View diff keep-end on `KEEP-SIX` (`forge-diff-keepend.png`) — Answered / Your turn stay above the composer after expand.

### 2026-08-29 — apps/shell typecheck is green
**Broke (live):** Forge Code `npx tsc -p tsconfig.json --noEmit` in `apps/shell` failed (exit 1): You-card test casts on `model`/`policy`, and ToolActivity TUI-tool fixture was not a `ToolRunEvent`. Shot: `docs/dogfood/forge-typecheck-now.png`.

**Fix:** Assign `run.model` / `run.policy` as records; fixture `activityEvent` is `as unknown as ToolRunEvent`. `tsc --noEmit` exit 0.

**Re-check:** Forge Code `cd apps/shell; npx tsc ...` **Exit code: 0 / pass**. Shot: `docs/dogfood/forge-typecheck-green.png`.

### 2026-08-29 — overview tools count uses run activities
**Broke (live):** A Code turn could show Tool activity rows that the overview **tools** count missed, because the strip only counted `messages` role=tool.

**Fix:** When the projected run has activities, the strip uses that count/fails. Tests: OverviewStrip 2/2. `tsc --noEmit` still 0.

**Re-check:** tsc turn **TOOLS 2** matches two shell rows. Exit 0. Shot: `docs/dogfood/forge-tools-count.png`.

### 2026-08-29 — KEEP-SEVEN write
**Re-check:** `KEEP.md` → `KEEP-SEVEN`. Allow once. Hunk `-KEEP-SIX` / `+KEEP-SEVEN`. TOOLS 1 matches one write. Answered and Your turn above composer. Shot: `docs/dogfood/forge-keep-seven.png`.

**Still noisy:** First shells miss when cwd is the repo root (vendor has no workingDirectory). Figma MCP `AuthRequired`. SHA/welcome stay installer/first-run honesty.

### 2026-08-29 — empty composer is not a 14px sausage
**Broke (live):** After rows=2, the empty Code composer still used `padding: 14px 20px` and a 48px Send well. Wrap stayed ~173px. Shot: `docs/dogfood/forge-idle-fold.png`.

**Fix:** Textarea `padding: 8px 16px`, `min-height: 40px`. Composer pad 8/16/10. Send height 40px. Tests: run.quiet-chrome 13/13.

**Re-check:** `docs/dogfood/SHORTPILL.md` Allow once → `SHORTPILL-OK`. Composer-wrap **151** vs 173. Your turn still above. Shot: `docs/dogfood/forge-short-pill.png`.

**Still noisy:** First shells fail when cwd is repo root. Figma MCP `AuthRequired`. SHA/welcome stay installer/first-run honesty.

### 2026-08-29 — Plan is one chip, not PLAN Plan
**Broke (live):** Composer footer painted uppercase **PLAN** plus a **Plan** chip. Shot: `docs/dogfood/forge-loop5.png`.

**Fix:** `.plan-arm-label` is `sr-only`; the chip keeps the accessible name. Tests: PlanArmControl 7/7, project-instructions footer order 6/6.

**Re-check:** `docs/dogfood/PLANCHIP.md` Allow once → `PLANCHIP-OK`. Footer is Effort chips then one **Plan** chip. Shot: `docs/dogfood/forge-plan-chip.png`.

**Still noisy:** First shells fail when cwd is repo root. Figma MCP `AuthRequired`. SHA/welcome stay installer/first-run honesty.

### 2026-08-29 — OverviewStrip tests run in Forge
**Re-check:** `cd apps/shell; node --import tsx --test src/OverviewStrip.test.ts` — **2 pass / 0 fail**. First shell Failed (cwd). Strip **tools 2 · 1 fail** matches. Shot: `docs/dogfood/forge-overview-tests.png`.

### 2026-08-29 — KEEP-EIGHT write
**Re-check:** `KEEP.md` → `KEEP-EIGHT`. Allow once. Hunk `-KEEP-SEVEN` / `+KEEP-EIGHT`. TOOLS 1. Answered / Your turn above composer. Shot: `docs/dogfood/forge-keep-eight.png`.

### 2026-08-29 — KEEP-NINE write
**Re-check:** `KEEP.md` → `KEEP-NINE`. Allow once. Hunk `-KEEP-EIGHT` / `+KEEP-NINE`. TOOLS 1. Answered / Your turn above composer. Shot: `docs/dogfood/forge-keep-nine.png`.

### 2026-08-29 — KEEP-TEN write
**Re-check:** `KEEP.md` → `KEEP-TEN`. Allow once. Hunk `-KEEP-NINE` / `+KEEP-TEN`. TOOLS 1. Answered / Your turn above composer (`answeredCoveredByComposer: false`). Shot: `docs/dogfood/forge-keep-ten.png`.

**Still noisy (elected next):** After View diff keep-end, **File changes** header sits under the sticky You card (`thoughtCoveredByYou: true`). First shells fail when cwd is repo root. Figma MCP `AuthRequired`. SHA/welcome stay installer/first-run honesty.

### 2026-08-29 — File changes header sticks below You
**Broke (live):** KEEP-TEN keep-end + expanded diff hid the **File changes** title under the sticky You card. The first visible row was `KEEP.md` with no section header.

**Fix:** `.file-changes-header` is `position: sticky` at `--run-prompt-stick-below` (70px). You bottom mask is a short drop so it does not paint over the title. Tests: run.quiet-chrome 16/16.

**Re-check:** `KEEP.md` → `KEEP-ELEVEN`. Allow once. Hunk `-KEEP-TEN` / `+KEEP-ELEVEN`. File changes header below You (`fileHeadBelowYou: true`, `fileHeadCoveredByYou: false`). Answered / Your turn above composer. Shot: `docs/dogfood/forge-keep-eleven.png`.

**Still noisy:** Collapsed Thought peeks under You’s rounded bottom (`thoughtCoveredByYou`). First shells fail when cwd is repo root. Figma MCP `AuthRequired`. SHA/welcome stay installer/first-run honesty.

### 2026-08-29 — KEEP-TWELVE write + no pending permission banner
**Re-check:** `KEEP.md` → `KEEP-TWELVE`. Allow once twice. Hunk `-KEEP-ELEVEN` / `+KEEP-TWELVE`. Shot: `docs/dogfood/forge-keep-twelve.png`.

**Broke (live):** A second Allow once posted after the write settled. Host 404 `decision_not_found` painted a red **no pending permission** banner (Export diagnostics / Dismiss) and shifted the transcript. File changes title also showed through `--card` (4% white) onto the path row.

**Fix:** `decidePermission` ignores in-flight duplicates and swallows `decision_not_found` / "no pending permission" instead of `reportError`. File changes header background is opaque `var(--bg)`. Tests: stalePermissionDecision 2/2, live-turn-attention banner case, run.quiet-chrome 16/16.

**Re-check:** `KEEP.md` → `KEEP-THIRTEEN`. One Allow once (not two). No red banner. Strip at y=93. Hunk `-KEEP-TWELVE` / `+KEEP-THIRTEEN`. File changes header below You, opaque. Shot: `docs/dogfood/forge-keep-thirteen.png`.

### 2026-08-30 — Forge Code built a real CSS+test change
Drove Forge with `HEADER_PROMPT.txt`: match File changes header fill to the card. Allow once ×6 (separate writes). **errorBanner empty**. TOOLS 16 · 3 fail (first shells cwd). Forge recovered, set `.file-changes` background to `var(--bg)`, tests **16/16**. Shot: `docs/dogfood/forge-header-match.png`.

**Broke (live on that turn):** Long You prompt was one nowrap ellipsis line; the run stack shrink-wrapped so You went full-width with the answer.

**Fix:** You body is 2-line clamp. `.run-stack` stretches at max 820px. `--run-prompt-stick-below` is 88px. Tests: run.quiet-chrome 16/16.

**Re-check:** Long prompt KEEP-FOURTEEN. You **w=820 h=76** (was 58×shrink-wrap). Two prompt lines visible. Thought below You. File changes header below You. Hunk `-KEEP-THIRTEEN` / `+KEEP-FOURTEEN`. No error banner. Shot: `docs/dogfood/forge-you-clamp.png`.

### 2026-08-30 — File changes path sticks under the section header
**Broke (live):** KEEP-FOURTEEN 2-line You hid `KEEP.md` / Accepted / Hide diff under the sticky File changes title.

**Fix:** `.file-changes-row-head` is sticky at `--run-file-stick-below + 24px` with opaque `var(--bg)`. Tests: run.quiet-chrome 16/16.

**Re-check:** KEEP-FIFTEEN. Path · Accepted · Hide diff visible under File changes. You 820×76, two lines. Hunk `-KEEP-FOURTEEN` / `+KEEP-FIFTEEN`. Shot: `docs/dogfood/forge-keep-fifteen.png`.

### 2026-08-30 — overview FILES jumps to File changes
**Broke (live):** After a long Code turn, keep-end buried File changes. The strip listed FILES but was not a control.

**Fix:** FILES is a button that `scrollIntoView`s `.file-changes`. Tests: OverviewStrip.component 2/2.

**Re-check:** KEEP-SIXTEEN. Clicks Allow once → View diff → FILES. File changes on screen. Hunk `-KEEP-FIFTEEN` / `+KEEP-SIXTEEN`. Shot: `docs/dogfood/forge-files-jump.png`.

### 2026-08-30 — read/grep must not mint View diff pills
**Broke (live):** A real Forge coding turn (DIFFPAD) timed out at 180s. Mid-turn chrome stacked **seven View diff pills** on read/grep extras. Shot: `docs/dogfood/forge-diff-pad.png`. FILES listed `SKILL.md` from a skill read.

**Fix:** Activity View diff only for write-like tools (`editId` / edit kind / write|replace names). `.file-changes-diff` has `padding-top: 20px` so `--- a/` clears the sticky path. Dogfood wait is 300s. Tests: inspectable-run-changeset read-pill case + quiet-chrome 17/17.

Cancelled the stuck run via `POST /api/cancel`.

**Re-check:** KEEP-SEVENTEEN. One write, one View diff (File changes), no extra pills. Path · Accepted · Hide diff visible. Hunk is add-only `+KEEP-SEVENTEEN` (no `-KEEP-SIXTEEN` before-image — standing overwrite class). Shot: `docs/dogfood/forge-keep-seventeen.png`.

### 2026-08-30 — OverviewStrip jump tests run in Forge
**Re-check:** First shells Failed (cwd). Recovered `cd apps/shell`. **3 pass / 0 fail** (FILES jump, TOOLS jump, plain-text empty). Strip **tools 4 · 2 fail**. No error banner. Shot: `docs/dogfood/forge-overview-jump-tests.png`.

### 2026-08-30 — KEEP-EIGHTEEN write
**Re-check:** `KEEP.md` → `KEEP-EIGHTEEN`. Allow once, View diff, FILES jump. Hunk `-KEEP-SEVENTEEN` / `+KEEP-EIGHTEEN` (before-image back). You 820px. No error banner. Shot: `docs/dogfood/forge-keep-eighteen.png`.

### 2026-08-30 — KEEP-NINETEEN write
**Re-check:** `KEEP.md` → `KEEP-NINETEEN`. Hunk `-KEEP-EIGHTEEN` / `+KEEP-NINETEEN`. FILES jump. No error banner. Shot: `docs/dogfood/forge-keep-nineteen.png`.

### 2026-08-30 — KEEP-TWENTY write
**Re-check:** `KEEP.md` → `KEEP-TWENTY`. Hunk `-KEEP-NINETEEN` / `+KEEP-TWENTY`. FILES jump. No error banner. Shot: `docs/dogfood/forge-keep-twenty.png`.

### 2026-08-30 — KEEP-TWENTYONE write
**Re-check:** `KEEP.md` → `KEEP-TWENTYONE`. Hunk `-KEEP-TWENTY` / `+KEEP-TWENTYONE`. Path · Hide diff visible. You 820px. No error banner. Shot: `docs/dogfood/forge-keep-twentyone.png`.

### 2026-08-30 — Plan arm works; reads must not be FILES or View diff
**Broke (live):** Plan-armed turn (`forge-plan-arm.png`). Plan helper **Explore and propose without applying edits.** is correct. Activity extras still offered **Hide diff** on a `read file` of `chrome.css` (`--- /dev/null` +3126 lines) because vendor stamped `editId`. Overview **FILES** listed chrome.css / SKILL.md from reads.

**Fix:** `activityLooksLikeWrite` deny-lists read/grep even with `editId`. Overview FILES only uses write-like paths. Dogfood View diff is File changes only. Tests: activityWriteLike 2/2, inspectable-run-changeset read+editId.

**Re-check:** Plan-armed again (`forge-plan-arm2.png`). **FILES —**. No View diff pills. Answered / Your turn on screen. Proposal `overscroll-behavior: contain;` with no edits. Tools 12. Landed that one line on `.file-changes-diff`.

### 2026-08-30 — KEEP-TWENTYTWO write
**Re-check:** FILES KEEP.md (writes still count). Hunk `-KEEP-TWENTYONE` / `+KEEP-TWENTYTWO`. File changes View diff only. Shot: `docs/dogfood/forge-keep-twentytwo.png`.

### 2026-08-30 — KEEP-TWENTYTHREE write
**Re-check:** `KEEP.md` → `KEEP-TWENTYTHREE`. Hunk `-KEEP-TWENTYTWO` / `+KEEP-TWENTYTHREE`. FILES KEEP.md. Thought below You. Shot: `docs/dogfood/forge-keep-twentythree.png`.

### 2026-08-30 — Forge added the overscroll test
**Re-check:** Forge wrote `run.quiet-chrome.test.ts`. Allow once ×4. First shells Failed (cwd). Test **17/17** locally. Shot: `docs/dogfood/forge-overscroll-test.png`.

**Broke (live):** Whole-file rewrite hunk used `white-space: pre` and stretched You to **876px** (past 820).

**Fix:** `.file-changes-diff` `max-width: 100%`; `.file-changes-diff .diff-line` `pre-wrap`.

### 2026-08-30 — KEEP-TWENTYFOUR write
**Re-check:** You **820**. Hunk `-KEEP-TWENTYTHREE` / `+KEEP-TWENTYFOUR`. FILES KEEP.md. Shot: `docs/dogfood/forge-keep-twentyfour.png`.

### 2026-08-30 — KEEP-TWENTYFIVE write
**Re-check:** `KEEP.md` → `KEEP-TWENTYFIVE`. Hunk `-KEEP-TWENTYFOUR` / `+KEEP-TWENTYFIVE`. You 820. FILES KEEP.md. Shot: `docs/dogfood/forge-keep-twentyfive.png`.

### 2026-08-30 — TOOLS jump; sticky Thought must not cover Tool activity
**Broke (live):** Clicking **tools 4 · 2 fail** jumped to Tool activity, but sticky collapsed Thought (z-index 4, max-content) painted over the header as **Thought activity**. Shot: `docs/dogfood/forge-tools-jump.png`.

**Fix:** Collapsed Thought is no longer sticky. Compact padding stays. Tests: run.quiet-chrome 17/17.

**Re-check:** TOOLS jump (`forge-tools-jump2.png`). **Tool activity** header fully visible, 2 Failed cwd shells then pass. FILES —. 3 tests passed. No Thought overlay.

### 2026-08-30 — KEEP-TWENTYSIX write
**Re-check:** `KEEP.md` → `KEEP-TWENTYSIX`. Hunk `-KEEP-TWENTYFIVE` / `+KEEP-TWENTYSIX`. Thought below You (full 820). FILES jump + TOOLS jump. Shot: `docs/dogfood/forge-keep-twentysix.png`.

### 2026-08-30 — Settings (DEV web)
**Looked:** `forge-settings.png`. Permission policy is Review / Trusted (Bypass is not a saved workspace radio — standing). **Installer SHA-256 unavailable** + unsigned Windows warning remain first-run/from-source honesty. Trusted command classes empty while Review is on.

### 2026-08-30 — KEEP-TWENTYSEVEN write
**Re-check:** `KEEP.md` → `KEEP-TWENTYSEVEN`. Hunk `-KEEP-TWENTYSIX` / `+KEEP-TWENTYSEVEN`. Collapsed Thought is a compact chip (`w=84`), not sticky. Shot: `docs/dogfood/forge-keep-twentyseven.png`.

### 2026-08-30 — KEEP-TWENTYEIGHT write
**Re-check:** `KEEP.md` → `KEEP-TWENTYEIGHT`. Hunk `-KEEP-TWENTYSEVEN` / `+KEEP-TWENTYEIGHT`. You 820. Shot: `docs/dogfood/forge-keep-twentyeight.png`.

### 2026-08-30 — KEEP-TWENTYNINE + measured You stick-below
**Fix:** `--run-prompt-stick-below` is set on `.transcript` from measured You height (58→70, 76→88). Tests: RunSurface artifacts 7/7.

**Re-check:** KEEP-TWENTYNINE hunk `-KEEP-TWENTYEIGHT` / `+KEEP-TWENTYNINE`. Shot: `docs/dogfood/forge-keep-twentynine.png`.

### 2026-08-30 — KEEP-THIRTY write
**Re-check:** `KEEP.md` → `KEEP-THIRTY`. Hunk `-KEEP-TWENTYNINE` / `+KEEP-THIRTY`. You 820. Shot: `docs/dogfood/forge-keep-thirty.png`.

**Fix:** Dropped the +36px File changes sticky bump (Thought is not sticky). Tests: run.quiet-chrome 18/18.

### 2026-08-30 — KEEP-THIRTYONE write
**Re-check:** `KEEP.md` → `KEEP-THIRTYONE`. Hunk `-KEEP-THIRTY` / `+KEEP-THIRTYONE` (no `@@` on this tiny write). You 820. Shot: `docs/dogfood/forge-keep-thirtyone.png`.

### 2026-08-30 — KEEP-THIRTYTWO write
**Re-check:** `KEEP.md` → `KEEP-THIRTYTWO`. Hunk `-KEEP-THIRTYONE` / `+KEEP-THIRTYTWO`. Thought chip w=84. Project instructions is quiet meta (no fill/border). Shot: `docs/dogfood/forge-keep-thirtytwo.png`.

### 2026-08-30 — KEEP-THIRTYTHREE write
**Re-check:** `KEEP.md` → `KEEP-THIRTYTHREE`. Hunk `-KEEP-THIRTYTWO` / `+KEEP-THIRTYTHREE`. You 820. piChip quiet. Shot: `docs/dogfood/forge-keep-thirtythree.png`.

### 2026-08-30 — @file picker
**Looked:** Typing `@` in the Code composer lists workspace paths (`@.env.example`, `@AGENTS.md`, …). Shot: `docs/dogfood/forge-atfile.png`. Palette is a dark panel above the composer. Send is enabled on `@` alone (not empty).

**Fix:** `draftIsSendReady` treats bare `@` / `@path` as not sendable (same disabled Send as empty). Tests: ComposerPane 8/8.

**Re-check:** `@` picker, Send dim (not plasma). Shot: `docs/dogfood/forge-atfile-dim.png`.

### 2026-08-30 — KEEP-THIRTYFOUR write
**Re-check:** `KEEP.md` → `KEEP-THIRTYFOUR`. Hunk `-KEEP-THIRTYTHREE` / `+KEEP-THIRTYFOUR`. You 820. Shot: `docs/dogfood/forge-keep-thirtyfour.png`.

### 2026-08-30 — KEEP-THIRTYFIVE write
**Re-check:** `KEEP.md` → `KEEP-THIRTYFIVE`. Hunk `-KEEP-THIRTYFOUR` / `+KEEP-THIRTYFIVE`. You 820. Shot: `docs/dogfood/forge-keep-thirtyfive.png`.

### 2026-08-29 — File changes header sticks below You

### 2026-08-29 — Thought does not paint over You
**Broke (live):** KEEP-ELEVEN keep-end left **Thought** overlapping the sticky You card (`y=178` vs You `134–192`). The fold painted through the rounded bottom. Shot: `docs/dogfood/forge-keep-eleven.png`. File changes header stayed clear.

**Fix:** `.run-prompt` is `z-index: 5` + `isolation`. `.run-thought` is `z-index: 0`. Tests: run.quiet-chrome 16/16.

**Re-check:** `docs/dogfood/YOUZ.md` Allow once → `YOUZ-OK`. You card has no Thought leak. File changes header below You. Shot: `docs/dogfood/forge-you-z.png`.

**Still noisy:** KEEP-ELEVEN overwrite diff was `--- /dev/null` instead of `-KEEP-TEN`. First shells fail when cwd is repo root. Figma MCP `AuthRequired`. SHA/welcome stay installer/first-run honesty.

### 2026-08-29 — collapsed Thought is a compact fold
**Broke (live):** Settled **Thought** was a 39px empty card (`padding` stacked from `.run-content details` + `.run-thought` + `.think-aloud`). Shot: `docs/dogfood/forge-loop6.png`.

**Fix:** `.run-content details.run-thought:not([open])` is `padding: 4px 12px; margin: 0`. Tests: run.quiet-chrome 14/14.

**Re-check:** `docs/dogfood/THOUGHTFOLD.md` Allow once → `THOUGHTFOLD-OK`. Thought **h=27** vs 39. Shot: `docs/dogfood/forge-thought-compact.png`.

**Still noisy:** First shells fail when cwd is repo root. Figma MCP `AuthRequired`. SHA/welcome stay installer/first-run honesty.

### 2026-08-29 — File changes is one row, not a nested card
**Broke (live):** A Review write nested path + Accepted inside a second card, with **View diff** on its own line. Shot: `docs/dogfood/forge-thought-compact.png`.

**Fix:** Path details have no inner fill/border. View diff sits on the summary row. Accepted rows start collapsed. Tests: run.quiet-chrome 15/15, FileChangesSection 21/21.

**Re-check:** `docs/dogfood/FLAT.md` Allow once → `FLAT-OK`. File changes **h=92**, path · Accepted · View diff on one line. Shot: `docs/dogfood/forge-file-flat.png`.

**Still noisy:** First shells fail when cwd is repo root. Figma MCP `AuthRequired`. SHA/welcome stay installer/first-run honesty.

### 2026-08-29 — collapsed Thought sticks below You
**Broke (live):** KEEP-THIRTEEN keep-end hid **Thought** under the sticky You card (`thought y=161` vs You `134–192`). Geometry said contained, so `thoughtCoveredByYou` was false, but z-index 5 You fully covered the fold. Shot: `docs/dogfood/forge-keep-thirteen.png`.

**Fix:** Collapsed `.run-thought` is `position: sticky` at `--run-prompt-stick-below` (z-index 4, opaque `--bg`). File changes header uses `--run-file-stick-below`, bumped `+36px` when a collapsed Thought exists. Dogfood layout also reports `fileHeadBelowThought`. Tests: run.quiet-chrome 16/16.

**Re-check:** `docs/dogfood/STICK2.md` Allow once → `STICK2-OK`. View diff keep-end. Thought below You (`y=222` vs You bottom `192`), File changes header below Thought (`y=258`, `fileHeadCoveredByThought: false`). Shot: `docs/dogfood/forge-thought-stick2.png`.

**Still noisy:** One-line You is 58px while `--run-prompt-stick-below` is 88px (2-line clamp), so a gap sits between You and Thought. First shells fail when cwd is repo root. Figma MCP `AuthRequired`. SHA/welcome stay installer/first-run honesty.

### 2026-08-30 — File changes diff skips redundant --- / +++ headers
**Broke (live):** KEEP-FIFTEEN / KEEP-SIXTEEN keep-end + View diff hid `--- a/docs/dogfood/KEEP.md` under the sticky path row. First visible line was `+++ b/…`. Path is already on the row.

**Fix:** `fileChangesDiffLines` drops `---` / `+++` file headers. Hunk + minus/plus stay. Tests: diffUtil + FileChangesSection 24/24.

**Re-check:** `KEEP.md` → `KEEP-SEVENTEEN`. Hide diff shows `@@ -1,1 +1,1 @@` / `-KEEP-SIXTEEN` / `+KEEP-SEVENTEEN`. No `--- a/`. Shot: `docs/dogfood/forge-diff-clip.png`.

**Still noisy:** One-line You vs 88px stick-below gap. First shells fail when cwd is repo root. Figma MCP `AuthRequired`. SHA/welcome stay installer/first-run honesty.

### 2026-08-30 — one-line You no longer leaves a Thought gap
**Broke (live):** KEEP-TWENTYONE one-line You was 58px while `--run-prompt-stick-below` was a 2-line 88px, so Thought sat 30px below You (`y=222` vs You bottom `192`). Shot: `docs/dogfood/forge-keep-twentyone.png`.

**Fix:** ResizeObserver on the You card stamps `--run-prompt-stick-below` as height+12px (`runPromptStickBelowPx`). File-stick `:has` moved to `.run-content` so it follows the measured value. Tests: run.quiet-chrome 16/16, RunSurface You-card 3/3.

**Re-check:** `docs/dogfood/YOUGAP.md` Allow once → `YOUGAP-OK`. You h=58, Thought y=204 (12px gap). File changes header below Thought. Shot: `docs/dogfood/forge-you-gap.png`.

**Still noisy:** First shells fail when cwd is repo root. Figma MCP `AuthRequired`. SHA/welcome stay installer/first-run honesty.

### 2026-08-30 — tiny File changes diffs drop @@ hunk headers
**Broke (live):** YOUGAP keep-end + View diff still showed `@@ -0,0 +1,1 @@` above `+YOUGAP-OK`. Path is already on the row; the hunk header is noise on one-line writes. Shot: `docs/dogfood/forge-you-gap.png`.

**Fix:** `fileChangesDiffLines` also drops `@@` when there is one hunk and ≤12 changed lines. Larger diffs keep @@. Tests: diffUtil 5/5, FileChangesSection 21/21.

**Re-check:** `docs/dogfood/HUNK.md` Allow once → `HUNK-OK`. File changes is path · Accepted · Hide diff · `+HUNK-OK` only. Shot: `docs/dogfood/forge-hunk-quiet.png`.

**Still noisy:** First shells fail when cwd is repo root. Figma MCP `AuthRequired`. SHA/welcome stay installer/first-run honesty.

### 2026-08-30 — collapsed Thought is a chip, not a full-width empty bar
**Broke (live):** HUNK settled Thought was an 820px-wide empty card with just **Thought** on the left. Shot: `docs/dogfood/forge-hunk-quiet.png`.

**Fix:** Collapsed `.run-thought` is `justify-self: start; width: max-content`. Tests: run.quiet-chrome 17/17.

**Re-check:** `docs/dogfood/FOLDCHIP.md` Allow once → `FOLDCHIP-OK`. Thought is a left-aligned fold, File changes `+FOLDCHIP-OK`. Shot: `docs/dogfood/forge-fold-chip.png`.

**Still noisy:** First shells fail when cwd is repo root. Project instructions is still a glowing cyan pill. Figma MCP `AuthRequired`. SHA/welcome stay installer/first-run honesty.

### 2026-08-30 — Project instructions is quiet meta, not a glow pill
**Broke (live):** Composer footer **Project instructions · AGENTS.md** used a cyan fill + glow (`rgba(92, 225, 255)`), louder than Plan. Shot: `docs/dogfood/forge-fold-chip.png`.

**Fix:** Loaded chip is transparent, no border, no shadow. Error/empty states unchanged. Tests: run.quiet-chrome 18/18.

**Re-check:** `docs/dogfood/PICHIP.md` Allow once → `PICHIP-OK`. piChip bg transparent, shadow none. Footer matches Grok Code meta. Shot: `docs/dogfood/forge-pi-quiet.png`.

**Still noisy:** First shells fail when cwd is repo root. Figma MCP `AuthRequired`. SHA/welcome stay installer/first-run honesty.

### 2026-08-30 — File changes plus-lines hug the text
**Broke (live):** PICHIP View diff painted `+PICHIP-OK` as an 820px green bar. `.run-content details` padding also leaked into path details (card h=150). Shot: `docs/dogfood/forge-pi-quiet.png`.

**Fix:** `.run-content details.file-changes-path-details` wins padding 0. File changes `.diff-line` is `width: max-content`. Tests: run.quiet-chrome 18/18.

**Re-check:** `docs/dogfood/PLUSBAR.md` Allow once → `PLUSBAR-OK`. Plus highlight hugs `+PLUSBAR-OK`. File changes h=128. Shot: `docs/dogfood/forge-plus-bar.png`.

**Still noisy:** First shells fail when cwd is repo root. Figma MCP `AuthRequired`. SHA/welcome stay installer/first-run honesty.

### 2026-08-30 — answer does not repeat I'll-create then Created
**Broke (live):** PLUSBAR/ONESHOT answers stacked **Creating…** then **Created…** for the same path. Shot: `docs/dogfood/forge-plus-bar.png`.

**Fix:** `collapseIntentThenDoneParagraphs` drops a short I'll/Creating/Overwriting lead-in when a later paragraph names the same path. `cleanVendorAnswer` runs after reminder strip. Tests: vendorAnswerClean 6/6.

**Re-check:** `docs/dogfood/DUP.md` Allow once → `DUP-OK`. Answer is one sentence: Created … DUP-OK. Shot: `docs/dogfood/forge-dup-answer.png`.

**Still noisy:** First shells fail when cwd is repo root. Figma MCP `AuthRequired`. SHA/welcome stay installer/first-run honesty.

### 2026-08-30 — KEEP-THIRTYFIVE overwrite
**Live:** Review write `docs/dogfood/KEEP.md` → `KEEP-THIRTYFIVE`. Allow once · View diff · FILES · TOOLS. Hunk `-KEEP-THIRTYFOUR` / `+KEEP-THIRTYFIVE`. errorBanner empty. Shot: `docs/dogfood/forge-keep-thirtyfive.png`.

### 2026-08-30 — AGENTS.md heading via Code (read-only)
**Live:** “Read AGENTS.md and reply with only the first markdown heading.” FILES —, Tool activity `read file` Completed, answer **Spire OS — multi-provider workspace**. hideDiff null. Shot: `docs/dogfood/forge-agents-heading.png`.

### 2026-08-30 — @file picker + dim Send; quiet “Type a message to send”
**Broke (live):** Typing `@` lists workspace paths. Send plasma stayed on for `@` / `@path` with no message. Footer shouted red **Type a message to send**. Dogfood looked for `.skills-palette` so `palette` was 0; the menu is `.at-menu`.

**Fix:** `draftIsSendReady` rejects `/^@\S*$/`. `composerBlockReasonVisible` hides `EMPTY_DRAFT_SEND` under shortcuts (Send title still explains). Dogfood `FORGE_ATCLICK` clicks `.at-menu` then sends. `.at-menu` is a `listbox`. Tests: ComposerPane 10/10.

**Re-check:** click `@AGENTS.md` → draft `@AGENTS.md `, Send dim, no red helper. After the question, Send enables. Shot: `docs/dogfood/forge-atclick-pick.png`.

**Broke (live):** You dumped `[Attached file contents for @mentions]` plus the whole file into the sticky card (h=76, 2-line clamp). Shot: `docs/dogfood/forge-atclick.png`.

**Fix:** `visibleUserPrompt` strips the attach marker for You / retry. Model still gets the dump on ACP. Tests: expandMentions + RunSurface artifacts 21/21 with composer.

**Re-check:** `FORGE_ATCLICK=AGENTS.md` → You **h=58**, body is the typed `@AGENTS.md Quote…` only, answer **Spire OS — multi-provider workspace**, listbox 1, FILES —, TOOLS 0. Shot: `docs/dogfood/forge-atclick2.png`.

**Still noisy:** ArrowDown/Tab on `.at-menu` inserts the first path immediately (no highlight). First shells fail when cwd is repo root. Figma MCP `AuthRequired`. SHA/welcome stay installer/first-run honesty.

### 2026-08-30 — @file menu highlights, then Enter inserts
**Broke (live):** ArrowDown/Tab inserted the first `.at-menu` path immediately.

**Fix (Forge-started, finished after 300s timeout):** `atMenuKeyAction` — ArrowDown/Up move highlight, Enter/Tab insert, Escape closes. `.at-menu` is a 420px dropdown (`right: auto`), active row `.is-active`, paths ellipsize. Tests: ComposerPane 13/13, quiet-chrome 19/19.

**Re-check:** ArrowDown selects `@.gitignore` (not insert). Send still dim. Compact panel. Shot: `docs/dogfood/forge-atnav-compact.png`.


### 2026-08-30 — @file ArrowDown highlights, Enter inserts
**Broke (live):** ArrowDown/Tab on `.at-menu` inserted the first path immediately. No highlight.

**Fix:** `atMenuKeyAction` — ArrowDown/Up move, Tab/Enter insert the highlighted path, Escape closes. Listbox options use `aria-selected`. Tests: ComposerPane 13/13.

**Re-check:** `FORGE_ATKEY=1` type `@` → first option selected. ArrowDown keeps draft `@`, selects `.gitignore`. Enter → `@.gitignore `. Shot: `docs/dogfood/forge-atkey.png`.

**Still noisy:** First shells fail when cwd is repo root. Figma MCP `AuthRequired`. SHA/welcome stay installer/first-run honesty.

### 2026-08-30 — @file menu long paths ellipsize
**Broke (live):** Compact 420px `@` menu still wrapped `@apps/host/src/ac31-decision-boundary.integration.test.ts` onto two lines. Flex items default `min-width: auto`, so `ellipsis` never kicked in. Shot: `docs/dogfood/forge-atnav-compact.png`.

**Fix:** `.at-menu li` and `button` get `min-width: 0`; button `flex: 1 1 auto`. Tests: run.quiet-chrome 19/19.

**Re-check:** `FORGE_ATARROW=1` — all 8 buttons h=34 (one line). Long path ends in `…`. Shot: `docs/dogfood/forge-at-ellipsis.png`.

### 2026-08-30 — KEEP-THIRTYSIX via @file + file index cap
**Live:** `@docs/dogfood/KEEP.md` write KEEP-THIRTYSIX. Allow once. Hunk `-KEEP-THIRTYFIVE` / `+KEEP-THIRTYSIX`. You h=58, no attach dump. Shot: `docs/dogfood/forge-keep-thirtysix.png`. Scheduler also landed KEEP-THIRTYSEVEN.

**Broke (live):** Picker showed 0 hits for `docs/dogfood/KEEP.md`. `/api/workspace/files` capped at 800 during walk, so `docs/` never entered the index.

**Fix:** `listWorkspaceFiles` cap 20_000. `atFileSuggestions` ranks exact basename (`KEEP.md`) ahead of `forge-keep-*.png`. Tests: workspace-files 1/1, atFileQuery 2/2.

**Re-check:** index 2925 files includes KEEP.md. `@KEEP` lists `@docs/dogfood/KEEP.md` first (highlighted). Click inserts `@docs/dogfood/KEEP.md `. Quote first line → **KEEP-THIRTYSEVEN**, TOOLS 0, You h=58. Shot: `docs/dogfood/forge-keep-rank2.png`.

### 2026-08-30 — KEEP-THIRTYEIGHT via ranked @KEEP
**Live:** `@KEEP` → first hit `docs/dogfood/KEEP.md` → Allow once. Hunk `-KEEP-THIRTYSEVEN` / `+KEEP-THIRTYEIGHT`. You h=58. Shot: `docs/dogfood/forge-keep-thirtyeight.png`.

### 2026-08-30 — You renders @path as a quiet mention
**Broke (live):** You showed `@AGENTS.md` as plain prompt text after we hid the attach dump.

**Fix:** `splitUserPromptMentions` + `.run-prompt-mention` (inherit font, accent color, no fill/border). Tests: expandMentions + RunSurface artifacts.

**Re-check:** `@AGENTS.md` in You is cyan mention, rest of the line is body copy, heading **Spire OS — multi-provider workspace**. Shot: `docs/dogfood/forge-mention-chip.png`.

### 2026-08-30 — KEEP-THIRTYNINE via ranked @KEEP
**Live:** `@KEEP` → `docs/dogfood/KEEP.md` → Allow once. Hunk `-KEEP-THIRTYEIGHT` / `+KEEP-THIRTYNINE`. You mention chip + h=58. Shot: `docs/dogfood/forge-keep-thirtynine.png`.

### 2026-08-30 — KEEP-FORTY via ranked @KEEP
**Live:** `@KEEP` → Allow once. Hunk `-KEEP-THIRTYNINE` / `+KEEP-FORTY`. Shot: `docs/dogfood/forge-keep-forty.png`.

### 2026-08-30 — Ctrl+K palette listed nothing
**Broke (live):** ⌘K opened a dialog with “Type a command…” and a footer, and **zero** commands. RAC `ComboBox` never mounted the list inside the overlay. Shot: `docs/dogfood/forge-palette.png`.

**Fix:** `CommandPalette` renders an inline listbox (filter + ↑↓ + Enter). `.palette .overlay-dialog` is a column so the footer sits below the list. Tests: CommandPalette 2/2, copyInvariants 14/14, quiet-chrome palette stack.

**Re-check:** 24 commands visible (Open folder, Switch to Chat/Code, …). Query `export` shows diagnostics / Markdown / JSON only. Enter on **Focus composer** closes the palette. Shots: `docs/dogfood/forge-palette4.png`, `docs/dogfood/forge-palette-export.png`, `docs/dogfood/forge-palette-focus.png`.

### 2026-08-30 — slash Skills + dim Send on `/`
**Broke (live):** Typing `/` listed 103 skills in a full-width slab. Send plasma stayed on. Shot: `docs/dogfood/forge-slash.png`.

**Fix:** `draftIsSendReady` rejects `/^\/\S*$/` (same idea as bare `@`). `.skills-palette` is 480px, not `right: 100px`. Tests: ComposerPane + quiet-chrome.

**Re-check:** compact Skills card above composer, Send dim. Shot: `docs/dogfood/forge-slash2.png`.

**Still noisy:** Typing `/session-info` does not arm the skill (Send stays dim; palette can miss after a host recycle). First shells fail when cwd is repo root. Figma MCP `AuthRequired`. SHA/welcome stay installer/first-run honesty.

### 2026-08-30 — KEEP-FORTYONE via ranked @KEEP
**Live:** `@KEEP` → Allow once. Hunk `-KEEP-FORTY` / `+KEEP-FORTYONE`. You mention chip. Shot: `docs/dogfood/forge-keep-fortyone.png`.

### 2026-08-30 — `/session-info` from Skills
**Broke (live):** `/` opened no Skills list while host identity was vendor but `skillsCatalog` was `absent_non_vendor` (eager vendor stamp skipped `enterAwaiting`).

**Fix:** `eagerResolveCodeAgent` and vendor acquire reuse call `enterAwaiting` when catalog is absent. Wait for advertised rows before clicking a skill.

**Re-check:** `/session-info` runs. Answer lists Session ID, working directory `C:\Dev\grokforge`, model grok-4.6, Turn 0, context 1516/500000. Shot: `docs/dogfood/forge-session-info-arm.png`.

### 2026-08-30 — TOOLS jump no longer buries Your turn
**Broke (live):** After TOOLS on a 6-tool turn, Your turn sat at y=1276 under the composer (y=749). Shot: `docs/dogfood/forge-tools-jump3.png`.

**Fix:** `.transcript > .turn-delimiter` is `position: sticky; bottom: 0` with opaque `--bg`. Tests: run.quiet-chrome 23/23.

**Re-check:** TOOLS jump, Your turn y=677 above composer 749. Shot: `docs/dogfood/forge-tools-jump4.png`.

### 2026-08-30 — KEEP-FORTYTWO via ranked @KEEP
**Live:** `@KEEP` → Allow once. Hunk `-KEEP-FORTYONE` / `+KEEP-FORTYTWO`. Shot: `docs/dogfood/forge-keep-fortytwo.png`.

### 2026-08-30 — Skills list last row no longer clips
**Broke (live):** `/session-info` was cut off at the rounded palette fold. Inner list grew to 103 rows; the card `overflow: hidden` sliced the last row. Shot: `docs/dogfood/forge-slash-pad.png`.

**Fix:** Ready `.skills-palette` has a definite `height: min(360px, 45vh)`; `.skills-palette-list` is `flex: 1 1 auto; min-height: 0; overflow: auto`. Tests: run.quiet-chrome 23/23.

**Re-check:** last row `/writing-skills` fully visible, `clipped: false`. Shot: `docs/dogfood/forge-slash-h.png`.

### 2026-08-30 — KEEP-FORTYTHREE via ranked @KEEP
**Live:** `@KEEP` → Allow once. Hunk `-KEEP-FORTYTWO` / `+KEEP-FORTYTHREE`. Shot: `docs/dogfood/forge-keep-fortythree.png`.

### 2026-08-30 — KEEP-FORTYFOUR via ranked @KEEP
**Live:** `@KEEP` → Allow once. Hunk `-KEEP-FORTYTHREE` / `+KEEP-FORTYFOUR`. Your turn sticky shadow is a fade, not a solid plank. Shot: `docs/dogfood/forge-keep-fortyfour.png`.








### 2026-08-30 — first subdirectory shell is one command
**Broke (live):** "From apps/shell run … ComposerPane.test.tsx" used **3 Allow once** and **2 failed** first shells at repo root. Vendor grok `run_terminal_command` has no `workingDirectory`; the model ran the command at workspace root, then guessed `cd /d` (cmd) against a PowerShell session. Shot: `docs/dogfood/forge-shell-cwd2.png`. Long commands also ellipsized (`src/C…`).

**Fix:**
- Vendor spawn: grok `--cwd <workspace>` (global flag).
- Vendor `session/new` `_meta.rules` + CLI `--rules`: shell has no workingDirectory; change directory in the same command with **PowerShell `Set-Location DIR; command`** (not cmd `cd /d` — vendor shell is PowerShell; `cd /d` became a second Failed row).
- `.tool-row-head.is-command .tool-row-name-plain` wraps two lines instead of nowrap ellipsis.

Tests: client.vendor-acp + tool-run (no `_meta` on grok-acp), agents 7/7, spawn-grok-agent.acquire 8/8, run.quiet-chrome 21/21. Dist rebuilt; DEV host restarted.

**Re-check:** Same ComposerPane prompt. **One Allow once.** Tool row `Set-Location apps/shell; node … src/ComposerPane.test.tsx` **Completed**. Strip **TOOLS 1**. **13 pass / 0 fail**. Shot: `docs/dogfood/forge-shell-cwd3.png`.

**Still noisy:** Overview **SHELL Command Prompt (cmd.exe)** is Forge's grok-acp profile, not the vendor PowerShell. TOOLS jump can bury Answered / Your turn under the composer. Figma MCP `AuthRequired`. SHA/welcome stay installer/first-run honesty.

### 2026-08-30 — vendor SHELL is PowerShell; exact `/skill` sends
**Broke (live):** Overview **SHELL Command Prompt (cmd.exe)** on vendor Code. Vendor grok on Windows is PowerShell (`cd /d` → Set-Location error). Typing `/session-info` also left Send disabled: `draftIsSendReady` rejected every `/token`, so catalog skills could not run without extra args. Shot before: `docs/dogfood/forge-shell-cwd3.png`.

**Fix:**
- `overviewShellCaption` — vendor + Windows → **PowerShell** (title: not Forge Command Prompt). grok-acp fallback still cmd.exe.
- `draftIsSendReady(draft, catalogNames)` — exact catalog hit (`/session-info`) is sendable; `/` and `/sess` stay dim.
- TOOLS jump uses `block: nearest` so an already-visible Tool activity does not yank Your turn under the composer.

Tests: OverviewStrip 8/8, ComposerPane draftIsSendReady catalog case. Dogfood waits up to 15s for Send after catalog hydrate.

**Re-check:** `/session-info` Send enabled, answered session id + cwd. Strip **SHELL PowerShell**. No cmd.exe. Your turn above composer. Shot: `docs/dogfood/forge-shell-label.png`.

**Still noisy:** TOOLS jump on a tall answer can still cover Your turn. Figma MCP `AuthRequired`. SHA/welcome stay installer/first-run honesty.

### 2026-08-30 — Skills checking is a chip; palette is opaque
**Broke (live):** `/` on a fresh session painted a 480px empty **Checking skills…** slab. Ready list used 88% mix + blur so continuum sample prompts showed through `/compact`. Shot: `docs/dogfood/forge-slash-now.png`, `docs/dogfood/forge-slash-compact.png`. TOOLS jump on a short turn also needed keep-end so Your turn stayed above the composer.

**Fix:**
- `.skills-palette.is-compact` (`width: max-content`) for checking/empty/failed.
- Ready palette `background: var(--bg)` — no see-through, no glow wash.
- TOOLS jump: `block: nearest` then keep-end when tools still fit above the composer (`shouldKeepEndAfterToolsJump`).

Tests: OverviewStrip keep-end 1/1, SkillsPalette compact class, quiet-chrome 22/22.

**Re-check:** Failed/checking hug is a small **Couldn't load skills.** card (`forge-slash-opaque.png`). Ready 103 rows, no continuum text through `/compact` (`forge-slash-ready.png`). `echo FORGE-TOOLS-OK` TOOLS jump: **yourTurnCoveredByComposer false**. Shot: `docs/dogfood/forge-tools-keepend.png`.

**Still noisy:** Last skill row can clip at the palette fold. `/always-approve` is still advertised (Forge policy stays Review/Trusted/Bypass). Tall TOOLS jumps still cannot show both tools and Your turn. Figma MCP `AuthRequired`. SHA/welcome stay installer/first-run honesty.

### 2026-08-30 — last Skills row is a full row
**Broke (live):** Ready `/` list cut `/session-info` in half at the rounded fold. Title + options shared one `overflow: auto` box, so the last option sat in the radius. Shot: `docs/dogfood/forge-slash-ready.png`.

**Fix:** `.skills-palette` is a flex column (`overflow: hidden`). Options live in `.skills-palette-list` (`overflow: auto`, `padding-bottom: 12px`). Title stays put. Tests: SkillsPalette list wrapper, quiet-chrome 23/23.

**Re-check:** Scrolled to end. Last row `/writing-skills` fully visible (`clipped: false`, lastBottom 727 vs palBottom 744). Shot: `docs/dogfood/forge-slash-fold.png`.

**Still noisy:** `/always-approve` is vendor-advertised (Forge policy stays Review). Figma MCP `AuthRequired`. SHA/welcome stay installer/first-run honesty.

### 2026-08-30 — KEEP-FORTYFIVE via ranked @KEEP
**Live:** `@KEEP` → Allow once. Hunk `-KEEP-FORTYFOUR` / `+KEEP-FORTYFIVE`. Shot: `docs/dogfood/forge-keep-fortyfive.png`.

### 2026-08-30 — KEEP-FORTYSIX via ranked @KEEP
**Live:** `@KEEP` → Allow once. Hunk `-KEEP-FORTYFIVE` / `+KEEP-FORTYSIX`. Shot: `docs/dogfood/forge-keep-fortysix.png`.

### 2026-08-30 — KEEP-FORTYSEVEN via ranked @KEEP
**Live:** `@KEEP` → Allow once. Hunk `-KEEP-FORTYSIX` / `+KEEP-FORTYSEVEN`. Shot: `docs/dogfood/forge-keep-fortyseven.png`.


### 2026-08-30 — Skills palette hides Code continuum
**Broke (live):** Typing `/` on an empty Code session left **Code continuum** sample prompts peeking out from behind the Skills list (`Summarize this repo…` / `Find TODO…`). Shot: `docs/dogfood/forge-slash-fold.png`, `docs/dogfood/forge-elect.png`.

**Fix:** Ready empty-state is unmounted while the Skills palette or `@` menu is open. Unmatched `/not-a-listed-skill` stays Send-disabled (catalog-exact). Tests: App.slash-skills 17/17.

**Re-check:** `/` → Skills `/compact` highlighted, nebula only, no continuum card. Shot: `docs/dogfood/forge-slash-empty-top.png`.

**Still noisy:** `/always-approve` is vendor-advertised (Forge policy stays Review). A mid-list row can still sit on the scroll fold. Figma MCP `AuthRequired`. SHA/welcome stay installer/first-run honesty.

### 2026-08-30 — Your turn is a chip, not a black bar
**Broke (live):** Sticky Your turn used `align-self: stretch` + `box-shadow: 0 -12px 16px var(--bg)`, so the idle cue was a full-width black slab across the transcript. Shot: `docs/dogfood/forge-keep-fortyseven.png`.

**Fix:** `.transcript > .turn-delimiter` is `width: max-content`, centered, no shadow; delimiter lines hidden. Still `position: sticky; bottom: 0` so TOOLS jump cannot bury it. Tests: run.quiet-chrome 23/23.

**Re-check:** `echo FORGE-TURN-OK`. Your turn **w=85 h=25**, not covered. Shot: `docs/dogfood/forge-your-turn-chip.png`.

**Still noisy:** `/always-approve` is vendor-advertised (Forge policy stays Review). Figma MCP `AuthRequired`. SHA/welcome stay installer/first-run honesty.

### 2026-08-30 — Skills hides conversations-not-found
**Broke (live):** Typing `/` on a Playwright Code session (host `priorConversations: true`, empty browser store) left **Forge didn't find your earlier conversations** plus **Save troubleshooting file** / **Start a new conversation** peeking around the Skills card. Continuum empty-state was already unmounted; the AC12b not-found branch was not. Shot: `docs/dogfood/forge-slash-now-top.png`.

**Fix:** Render conversations-not-found only when Skills is closed and `@` has no suggestions (same gate as Code continuum). Escape restores the not-found card. Tests: App.slash-skills 18/18, App.notFound 9/9.

**Re-check:** `/` → 103 Skills rows, nebula only, no not-found copy. Last row `/writing-skills` unclipped. Shot: `docs/dogfood/forge-slash-notfound.png`.

**Still noisy:** `/always-approve` is vendor-advertised (Forge policy stays Review). A mid-list row can still sit on the scroll fold. Figma MCP `AuthRequired`. SHA/welcome stay installer/first-run honesty.

### 2026-08-30 — Skills first page does not radius-clip a mid row
**Broke (live):** With Skills scrolled to the top, `/session-info` sat in the palette's 16px radius (`padding: 8px 8px 0`). Last-row list padding did not inset the clip edge. Shot: `docs/dogfood/forge-slash-notfound-top.png`.

**Fix:** Ready palette `padding: 8px 8px 16px`. List padding is `0` (inset is the card, not extra content below the last skill). Tests: run.quiet-chrome 23/23.

**Re-check:** `/` first page shows five full rows (`/compact` … `/reload-plugins`) with a gap above the fold, no sliced `/session-info`. End still `/writing-skills` unclipped. Shot: `docs/dogfood/forge-slash-inset-top.png`.

**Still noisy:** `/always-approve` is vendor-advertised (Forge policy stays Review). Figma MCP `AuthRequired`. SHA/welcome stay installer/first-run honesty.

### 2026-08-30 — I'll-run does not stay in the answer
**Broke (live):** Echo turn stacked **I'll run that command…** then **FORGE-TURN-OK**. Shot: `docs/dogfood/forge-your-turn-chip.png`.

**Fix:** `collapseIntentThenDoneParagraphs` drops a short I'll/Let me run lead-in when a later paragraph has the output. Tests: vendorAnswerClean 8/8.

**Re-check:** Same echo. Answer is one line: FORGE-TURN-OK. Your turn chip. Shot: `docs/dogfood/forge-run-answer.png`.

**Still noisy:** `/always-approve` is vendor-advertised (Forge policy stays Review). Figma MCP `AuthRequired`. SHA/welcome stay installer/first-run honesty.

### 2026-08-30 — Your turn stays in flow after TOOLS jump
**Broke (live):** Forge Code ran `App.slash-skills.test.tsx` (18/18 from apps/shell). TOOLS jump + sticky Your turn painted the chip **on top of the answer** (y=669 vs Answered y=692). Shot: `docs/dogfood/forge-slash-tests.png`. First shell still missed apps/shell.

**Fix:** Drop `position: sticky` on `.transcript > .turn-delimiter`. Chip + `margin-top: auto` stay. TOOLS keep-end unchanged. Tests: run.quiet-chrome 23/23.

**Re-check:** Same slash-skills run. Answered y=634, Your turn y=671 (below the answer). 18 pass / 0 fail. Shot: `docs/dogfood/forge-turn-flow.png`.

**Still noisy:** First subdirectory shell can still miss at repo root. `/always-approve` is vendor-advertised (Forge policy stays Review). Figma MCP `AuthRequired`. SHA/welcome stay installer/first-run honesty.

### 2026-08-30 — first subdirectory shell is Set-Location
**Broke (live):** `App.slash-skills.test.tsx` still opened with a Failed root command, then `Set-Location apps/shell`. Answer also stacked **The first run started at the workspace root…**. Shot: `docs/dogfood/forge-turn-flow.png`.

**Fix:** Vendor `--rules` / `_meta.rules` now require the FIRST shell to be `Set-Location DIR; command` when the user names a subdirectory. Display drops a short first-run-at-root retry paragraph when a later paragraph has the result. Tests: vendor-acp session/new rule, vendorAnswerClean 9/9. Dist rebuilt; DEV host restarted.

**Re-check:** `vendorAnswerClean.test.ts` from apps/shell. **One Allow once.** TOOLS 1. Row `Set-Location apps/shell; …`. **9/9**. No root fail, no retry lead-in. Shot: `docs/dogfood/forge-shell-first.png`.

**Still noisy:** `/always-approve` is vendor-advertised (Forge policy stays Review). Figma MCP `AuthRequired`. SHA/welcome stay installer/first-run honesty.

### 2026-08-30 — Forge Code ran slash-skills 18/18
**Live:** Review Allow once. One PowerShell `Set-Location apps/shell; node … src/App.slash-skills.test.tsx`. Answer **18 pass, 0 fail**. TOOLS 2. Your turn chip above composer. Shot: `docs/dogfood/forge-slash-tests.png`.

**Still noisy:** Tool activity header **1 not run · get command or subagent output** for the vendor TUI poll (`Not in Forge` on the row). Figma MCP `AuthRequired`. SHA/welcome stay installer/first-run honesty.

### 2026-08-30 — Tool activity does not advertise a TUI poll
**Broke (live):** A background shell plus `get_command_or_subagent_output` painted **1 not run · get command or subagent output** on the group header. The row already says **Not in Forge**. Shot: `docs/dogfood/forge-slash-tests.png`.

**Fix:** `toolRunStats` counts unavailable vendor TUI tools separately. Group subtitle omits them from "not run" and from the name hint. One executable Completed row is enough. Tests: ToolActivity + messageBlocks 19/19.

**Re-check:** 12s `Start-Sleep` stayed in-process (TOOLS 1, no TUI poll). Header is **Tool activity** with the command row, no **1 not run**. Answer **FORGE-WAIT-OK**. Shot: `docs/dogfood/forge-wait-header.png`. Mixed TUI-poll header is covered by ToolActivity 19/19 against `forge-slash-tests.png`.

### 2026-08-30 — You card expands past the 2-line clamp
**Broke (live):** A long Code prompt (slash-skills test command) was sticky-You clamped to 2 lines with ellipsis. Hover `title` had the rest; click did nothing. Shot: `docs/dogfood/forge-slash-tests.png`.

**Fix:** You main row is a toggle (`aria-expanded`). Default stays `-webkit-line-clamp: 2`. Expanded uses `pre-wrap` and unset clamp. Tests: RunSurface artifacts + quiet-chrome 32/32.

**Re-check:** 4-line prompt. Closed **h=36**; click **h=73**, all four lines. Shots: `docs/dogfood/forge-you-clamp.png`, `docs/dogfood/forge-you-expand.png`.

### 2026-08-30 — Forge Code ran quiet-chrome 23/23
**Live:** Review Allow once. `Set-Location apps/shell; node … src/run.quiet-chrome.test.ts`. Answer **23 pass, 0 fail**. TOOLS 1. Header is the command, no TUI-poll subtitle. Shot: `docs/dogfood/forge-quiet-tests.png`.

### 2026-08-30 — Forge Code ran ComposerPane 14/14
**Live:** Review Allow once. `Set-Location apps/shell; node … src/ComposerPane.test.tsx`. Answer **14 pass, 0 fail**. TOOLS 1. Shot: `docs/dogfood/forge-composer-tests.png`.

### 2026-08-30 — Forge Code ran ToolActivity 13/13
**Live:** Review Allow once. `Set-Location apps/shell; node … src/ToolActivity.test.tsx`. Answer **13 pass, 0 fail** (includes unavailable-TUI subtitle omit). TOOLS 1. Shot: `docs/dogfood/forge-tool-tests.png`.

### 2026-08-30 — You card has Show more / Show less
**Broke (live):** Long You prompts clamped to 2 lines with no hint that click expands. Forge's Show-more turn timed out (5 Allow once, black shot) and left a `youPrompt` TDZ plus a chevron. Shot: `docs/dogfood/forge-show-more.png`.

**Fix:** Overflow (scrollHeight, ≥2 newlines, or length > 110) paints quiet **Show more** / **Show less** on the existing You toggle. `promptBodyRef` measures; runId no longer clobbers the latch. Tests: RunSurface artifacts 10/10, quiet-chrome 23/23.

**Re-check:** 4-line prompt. Closed **Show more** h=36; click **Show less** h=73. Shots: `docs/dogfood/forge-you-clamp.png`, `docs/dogfood/forge-you-expand.png`.

### 2026-08-30 — Forge Code ran You-card tests 10/10
**Live:** Review Allow once. `src/RunSurface.artifacts.test.tsx`. Answer **pass 10, fail 0**. Long You prompt shows **Show more**. Shot: `docs/dogfood/forge-you-tests.png`.

### 2026-08-30 — Show more live re-check after TDZ
**Broke (live):** The Forge-driven SHOWMORE turn timed out (5 Allow once) and blanked the DEV UI (`Cannot access 'youPrompt' before initialization`). Shot: `docs/dogfood/forge-show-more.png`.

**Fix (this pass):** One `youPrompt` before the overflow layout effect. `.run-prompt-body` measured via `promptBodyRef`. runId effect only collapses expand (does not wipe overflow on mount). Quiet **Show more** / **Show less** on the You toggle; chevron gone. Tests: RunSurface artifacts + quiet-chrome **33/33**.

**Re-check:** `LONG_PROMPT.txt`. Clamp **Show more**; click **Show less** with all four lines. Answer **FORGE-YOU-OK**. SHELL PowerShell. Your turn above composer. `youChevron` null. Shots: `docs/dogfood/forge-you-more-clamp.png`, `docs/dogfood/forge-you-more.png`.

**Still noisy (then elected):** Clamp shot painted **Loading browser work…** on a no-browser settled turn.

### 2026-08-30 — no Loading browser work on a settled empty run
**Broke (live):** After a no-browser Code turn, a **Loading browser work…** band sat between Thought and the answer (`forge-you-more-clamp.png`). Hooks already projected hydrating+empty+terminal as absent; browser work did not.

**Fix:** `projectBrowserWork` hydrating with no members on `parentTerminal` is absent. Live hydrating (in-flight, no prior) still shows Loading. Tests: browserWorkProjection hydrating-terminal-empty + existing hydrating-live cases. **40/40** with You-card artifacts.

**Re-check:** `NOBROWSER_PROMPT.txt`. Answer **FORGE-NO-BROWSER-OK**. `browserWork` null. Dump has no Loading browser work. Short You (no Show more). Shot: `docs/dogfood/forge-no-browser.png`.

**Still noisy:** `/always-approve` is vendor-advertised (Forge policy stays Review). Figma MCP `AuthRequired`. SHA/welcome stay installer/first-run honesty. MCP hydrating has the same empty-terminal flash class as browser had.

### 2026-08-30 — hydrating agent copy is quiet meta
**Broke (live):** Mid-turn You card painted **Confirming which agent ran…** as a bordered pill (`is-pending`). Shot: `docs/dogfood/forge-you-expand.png`.

**Fix:** Hydrating uses `is-pending is-quiet` (no border/fill), same as vendor Grok Code. Copy unchanged. Tests: CodeRunProvenanceChip 3/3.

**Re-check:** next streaming turn. Settled You-card tests already show quiet **Grok Code**.

### 2026-08-30 — Plan mode hangs after exit plan mode
**Broke (live):** Plan-on prompt for a 3-step typecheck plan. Vendor **enter plan mode** / **exit plan mode** completed, wrote `plan.md`, then the run stayed **Waiting for model** / **Run in progress** for 300s. No **Accept plan** dock (`run.decisions` plan pending is only stamped at terminal). Shot: `docs/dogfood/forge-plan-now.png`.

**Fix (host, needs restart):** Terminal vendor `exit_plan_mode` while Plan is engaged stamps the existing plan `decision_request` (same dock as grok-acp). Dogfood also clicks **Accept plan** / **Keep planning**. Tests: plan-record + plan-decision 14/14.

**Re-check:** After host restart, the same Plan prompt **answered in 43s** with a three-step typecheck plan and **Your turn** — the vendor did not call `enter_plan_mode` / `exit_plan_mode` this time (TOOLS 4 reads). Shot: `docs/dogfood/forge-plan-dock.png`. The hang path is still mapped for the next TUI plan-exit.

### 2026-08-30 — loose ordered lists number 1. 2. 3.
**Broke (live):** The typecheck plan painted **1. 1. 1.** because blank lines between `1.` items became three one-item `<ol>`s. Shot: `docs/dogfood/forge-plan-dock.png`.

**Fix:** Ordered and unordered list parsers skip blank lines and keep collecting. Tests: markdown.parse 12/12.

**Re-check:** Echo of three `1.` items with blank lines is **1. 2. 3.** Shot: `docs/dogfood/forge-ol-list.png`.

### 2026-08-30 — Forge Code ran markdown.parse 12/12
**Live:** Review Allow once. `src/markdown.parse.test.ts`. Answer **pass 12 / fail 0**. Shot: `docs/dogfood/forge-md-tests.png`.

### 2026-08-30 — apps/shell typecheck is green again
**Broke (live):** Forge `npx tsc -p tsconfig.json --noEmit` in `apps/shell` exit **2**. Fixture `kind: "edit"` is not a `MutationKind`. Shot: `docs/dogfood/forge-tsc.png`.

**Fix:** Read-file activity uses `kind: null`. `tsc --noEmit` exit 0. inspectable-run-changeset 22/22.

**Re-check:** Same command through Forge. **Exit code: 0**. Shot: `docs/dogfood/forge-tsc-green.png`.

### 2026-08-30 — failed node exit is Failed, not Completed
**Live:** `Set-Location apps/shell; node -e "process.exit(2)"`. Strip **TOOLS 1 · 1 fail**. Row **Failed**. Peek **Non-zero exit**. Shot: `docs/dogfood/forge-exit2.png`. The earlier tsc-fail **Completed** was vendor `completed` on that run, not this row chrome.
### 2026-08-30 — no Loading MCP on a settled empty run
**Broke (same class as Loading browser work / Loading hooks):** `projectMcpServers` hydrating with no members still painted **Loading MCP…** after the parent run was terminal. Child agents had the same empty-terminal flash.

**Fix:** Hydrating with no members on `parentTerminal` is absent for MCP and child agents. Live hydrating (in-flight, no prior) still shows Loading. Prior members still keep-visible. Tests: mcpServersProjection hydrating-terminal-empty **31/31**; childAgentsProjection same **23/23**.

**Re-check:** `NOMCP_PROMPT.txt`. Answer **FORGE-NO-MCP-OK**. `mcpServers` / `childAgents` / `browserWork` / `hooks` all null. Dump has no Loading MCP / Loading child agents. SHELL PowerShell. Your turn above composer. Shot: `docs/dogfood/forge-no-mcp.png`.

**Still noisy:** **New session** is a full-width outlined well above the active session (`forge-no-mcp.png`). `/always-approve` is vendor-advertised (Forge policy stays Review). Figma MCP `AuthRequired`. SHA/welcome stay installer/first-run honesty.

### 2026-08-30 — New session is a text control, not a well
**Broke (live):** With grokforge pinned, **New session** was a full-width `.btn` outline (`w=249`, radius 14, 1px border) above the active session. Shot: `docs/dogfood/forge-no-mcp.png`.

**Fix:** `.new-session-btn` is `width: max-content`, no border/fill/radius. Hover is text only. Tests: run.quiet-chrome 24/24.

**Re-check:** New session **w=102**, no well. Session card is the emphasis. Shot: `docs/dogfood/forge-new-session-text.png`.

**Still noisy:** `/always-approve` is vendor-advertised (Forge policy stays Review). Figma MCP `AuthRequired`. SHA/welcome stay installer/first-run honesty.

### 2026-08-30 — Forge Code ran quiet-chrome 24/24
**Live:** Review Allow once. `src/run.quiet-chrome.test.ts`. Answer **24 pass, 0 fail**. New session still **w=102**. Shot: `docs/dogfood/forge-quiet-24.png`.

### 2026-08-30 — Forge Code ran named-projects 5/5
**Live:** Review Allow once. `src/named-projects.component.test.tsx`. Answer **5 pass, 0 fail**. Shot: `docs/dogfood/forge-named-tests.png`.

### 2026-08-30 — Code New session is not titled New chat
**Broke (live):** Clicking **New session** under a Code folder still titled the row **New chat**. Shot: `docs/dogfood/forge-slash-catalog-top.png`.

**Fix:** `defaultSessionTitle` is **New session** for folder workspaces and **New chat** for `chat:` partitions. Tests: sessions.named-home 9/9, App.notFound 9/9.

**Re-check:** New session row title **New session**; **New chat** count 0. Shot: `docs/dogfood/forge-new-session-title.png`.

Rename/delete fallbacks on Code rows also use **New session** (not **New chat**).

### 2026-08-30 — Forge Code ran App.notFound 9/9
**Live:** Review Allow once. `src/App.notFound.test.tsx`. Answer **9 pass, 0 fail**. New session **w=102**. TUI poll row **Not in Forge** without a group “not run” subtitle. Shot: `docs/dogfood/forge-notfound-tests.png`.

### 2026-08-30 — vendor `_x.ai/exit_plan_mode` is the plan dock
**Broke (live):** After **exit plan mode** the vendor reverse-RPC `_x.ai/exit_plan_mode` was **Unmapped child ACP request**. Forge never answered, so the turn sat **Waiting for model** / **Run in progress** for 300s. Host tool_run settle was not the hang. Shot: `docs/dogfood/forge-plan-now.png`.

**Fix:** Map `_x.ai/exit_plan_mode` / `x.ai/exit_plan_mode` like permission: hold the JSON-RPC, stamp the existing plan dock from `planContent` (or accumulated answer). **Accept plan** replies `{ outcome: "approved" }`; **Keep planning** replies `{ outcome: "cancelled" }`. `current_mode_update` is a known no-op. Dist rebuilt; DEV host restarted. Tests: vendor-acp exit hold/answer, plan-record body helper, plan-decision 16/16.

**Re-check:** Plan-armed typecheck plan. **End Plan · no changes proposed** clicked (empty members — plan.md body arrived after the RPC). Turn idle in 53s. **exit plan mode** / **Plan mode exited**. No Unmapped child ACP. Answer has the three-step typecheck plan. **Your turn**. Shot: `docs/dogfood/forge-plan-exit.png`.

**Still noisy:** Empty-plan dock when `plan.md` actually has the plan. Tool activity **View diff** on the session `plan.md` write. `/always-approve` is vendor-advertised (Forge policy stays Review). Figma MCP `AuthRequired`. SHA/welcome stay installer/first-run honesty.

**Still noisy:** Answer kept **The test is still running; I'll wait…** above the counts.

### 2026-08-30 — still-running wait lead-in is dropped
**Broke (live):** notFound 9/9 answer stacked a wait paragraph then **9 pass, 0 fail**. Shot: `docs/dogfood/forge-notfound-tests.png`.

**Fix:** `collapseIntentThenDoneParagraphs` drops a short still-running / I'll-wait lead-in when a later paragraph has pass counts or an exit code. Tests: vendorAnswerClean 10/10.

**Re-check:** Forge ran `vendorAnswerClean.test.ts`. Answer **pass 10, fail 0** with no wait paragraph. Shot: `docs/dogfood/forge-clean-tests.png`.

### 2026-08-30 — empty Plan: Exit does not stamp End Plan
**Broke (live):** Vendor `_x.ai/exit_plan_mode` with `Plan: Exit` stamped a ready **0-member** dock (**End Plan · no changes proposed**) while `plan.md` / the answer had the real three-step plan. Shot: `docs/dogfood/forge-plan-exit.png`.

**Fix:** `planBodyFromVendorExit` empty → do **not** `settlePlanPhase`. Respond `approved` so the model can finish the plan text; prompt-done stamps from the accumulated answer. Tests: plan-record 8/8. DEV host restarted.

### 2026-08-30 — real plan.md is Review plan, not End Plan
**Broke (live):** Even with a three-step typecheck plan on disk, the dock was **End Plan · no changes proposed** because (1) early “I'll inspect…” accumulated answer beat `planContent` / `plan.md`, and (2) `empty` was `proposedMembers.length === 0`. Shot: `docs/dogfood/forge-plan-exit.png`.

**Fix:** Prefer usable `planContent`, then the vendor `plan.md` write (input or on-disk), then accumulated answer. `planReadyIsEmpty` is blank / nothing-to-change only. A real plan body is **Review plan** / **Accept plan** even with 0 file rows. Tests: plan-record 18/18, runPlanSection 10/10. Host restarted.

**Re-check:** Plan-armed typecheck plan. Click **Accept plan** (not End Plan). Idle 53s. Three-step plan in the answer. **Your turn**. Shot: `docs/dogfood/forge-plan-review.png`.

**Still noisy:** Tool activity **View diff** on the session `plan.md` write. I'll-inspect lead-in still in the answer. `/always-approve` is vendor-advertised (Forge policy stays Review). Figma MCP `AuthRequired`. SHA/welcome stay installer/first-run honesty.

### 2026-08-30 — session plan.md is not File changes / View diff
**Broke (live):** Vendor TUI write of `~/.grok/sessions/…/plan.md` listed **FILES plan.md** and a Tool activity **View diff**. File changes (workspace) was empty. Shot: `docs/dogfood/forge-plan-review.png`.

**Fix:** `activityIsVendorSessionPlan` (plan.md under `.grok/sessions` or `.grokforge`). Overview FILES and Activity View diff skip it. Workspace writes unchanged. Tests: activityWriteLike + inspectable-run-changeset **26/26**.

**Re-check:** Plan-armed typecheck plan. **Accept plan**. **FILES —**. `hideDiff` null. Write row still names the session path. Shot: `docs/dogfood/forge-plan-nodiff.png`.

**Still noisy:** Encoded `C:\Users\…\.grok\sessions\…\plan.md` on the write row. TOOLS jump can bury Your turn under the composer. `/always-approve` is vendor-advertised (Forge policy stays Review). Figma MCP `AuthRequired`. SHA/welcome stay installer/first-run honesty.

### 2026-08-30 — session plan.md write row is not an encoded path
**Broke (live):** Tool activity wrote `C:\Users\…\.grok\sessions\CK3A%5CDev%5Cgrokforge\…\plan.md`. Shot: `docs/dogfood/forge-plan-nodiff.png`.

**Fix:** `quietActivityPath` / `toolRowCaption` show **session plan.md**. Workspace paths unchanged. Tests: activityWriteLike + activityLabel **11/11**. Dogfood no longer clicks Keep planning after Accept plan.

**Re-check:** Plan-armed typecheck plan. **Accept plan** only. **FILES —**. Dump has no `CK3A` session path. **Your turn** above composer. Shot: `docs/dogfood/forge-plan-path.png`.

**Still noisy:** TOOLS jump can hide the tool list / Thought under You. `/always-approve` is vendor-advertised (Forge policy stays Review). Figma MCP `AuthRequired`. SHA/welcome stay installer/first-run honesty.

### 2026-08-30 — TOOLS jump clears the sticky You card
**Broke (live):** After TOOLS, Thought sat under You (`y=-44`) and Tool activity was off-screen. `block: nearest` aligned the header under the sticky You card. Shot: `docs/dogfood/forge-plan-path.png`.

**Fix:** `.tool-activity-head` `scroll-margin-top: var(--run-prompt-stick-below)`. If the header still sits under You, jump again with `block: start`. Tests: OverviewStrip toolsJumpNeedsStart + quiet-chrome **32/32**. Host was down (EADDRINUSE race) then `:8788` 200.

**Re-check:** Plan-armed typecheck plan. TOOLS jump. Tool activity header fully below You. Answer + Your turn on screen. Shot: `docs/dogfood/forge-tools-jump.png`.

**Still noisy:** `/always-approve` is vendor-advertised (Forge policy stays Review). Figma MCP `AuthRequired`. SHA/welcome stay installer/first-run honesty.

### 2026-08-30 — settled Tool activity collapses; Step 3 stays on screen
**Broke (live):** After TOOLS, a 9-row Tool activity list buried Step 3 / Your turn under the composer. Shot: `docs/dogfood/forge-plan-review.png`. Activity **View diff** on session `plan.md` was a quiet text control (`h=22`, no pill) — CSS live-verified there.

**Fix:** `run-tools:` group stays open while live, collapses after a clean settlement (failed / explicit-open stay open). TOOLS jump targets `.tool-activity-head` (`pickToolsJumpEl`) so nearest does not fill the viewport with rows. Dogfood restores `.turn-delimiter` after the jump. Tests: ToolActivity 21, OverviewStrip pick-header, vendorAnswerClean inspect lead-in.

**Re-check:** STEPS-VISIBLE-OK. Collapsed **▸ Tool activity**. Steps 1–3 and **Your turn** above the composer. Shot: `docs/dogfood/forge-steps-visible.png`.

### 2026-08-30 — I'll-inspect / I'll-read lead-in is dropped
**Broke (live):** The answer led with “I'll read the first line…” above STEPS-VISIBLE-OK. Shot: `docs/dogfood/forge-steps-visible.png`.

**Fix:** `INSPECT_PREAMBLE` drops I'll-inspect / I'll-read / I-have-the-layout when a later paragraph is the numbered plan. Tests: vendorAnswerClean **13/13**.

**Re-check:** Answer starts **STEPS-VISIBLE-OK**. Shot: `docs/dogfood/forge-steps-clean.png`.

### 2026-08-30 — Plan arm does not leak after the turn
**Broke (live):** Composer **Plan** stayed armed (`Explore and propose without applying edits`) on a new session that said do not enter plan mode. `planEngaged` is host-session. Shot: `docs/dogfood/forge-steps-clean.png`.

**Fix:** `releasePlanArmIfIdle` clears engagement when a turn finishes with no pending plan dock. **New session** POSTs plan-engagement false. Tests: plan-engagement **7/7**. DEV host restarted (`:8788` pid 63480). Dogfood clicks **New session** (not only empty-state Start a new conversation) and always sends.

**Re-check:** FORGE_PLAN=1 then STEPS. Idle Plan chip is default, no helper. Shot: `docs/dogfood/forge-plan-released.png`.

### 2026-08-30 — session agent badge is not AGENT
**Broke (live):** Code session rows shouted **AGENT** (`.badge` uppercase + border). Shot: `docs/dogfood/forge-steps-clean.png`.

**Fix:** `.badge` is `text-transform: none`, no border/fill. Tests: run.quiet-chrome **26/26**.

**Re-check:** Dump **agent** (not AGENT). Shot: `docs/dogfood/forge-plan-released.png`. Borderless badge lands on the next HMR shot.

### 2026-08-30 — Forge Code ran plan-engagement 7/7
**Live:** Review Allow once. `Set-Location apps/host; node --import tsx --test src/plan-engagement.test.ts`. Answer **pass 7 / fail 0**. Tool activity collapsed. Plan default. Session badge **agent**. Shot: `docs/dogfood/forge-host-tests.png`.

### 2026-08-30 — Forge Code ran quiet-chrome 26/26
**Live:** Review Allow once. `src/run.quiet-chrome.test.ts`. Answer **pass 26, fail 0**. Shot: `docs/dogfood/forge-quiet-26.png`.

### 2026-08-30 — Forge Code ran ToolActivity 16/16
**Live:** Review Allow once. `src/ToolActivity.test.tsx`. Answer **pass 16 / fail 0**. Shot: `docs/dogfood/forge-toolact-tests.png`.

### 2026-08-30 — Forge Code ran vendorAnswerClean 14/14
**Live:** Review Allow once. `src/vendorAnswerClean.test.ts`. Answer **pass 14, fail 0** with no Running-the-test lead-in. Shot: `docs/dogfood/forge-clean-14.png`.

### 2026-08-30 — one-tool Tool activity names the tool
**Broke (live):** A single completed tool left **▸ Tool activity** with an empty subtitle. Shot: `docs/dogfood/forge-quiet-26.png`.

**Fix:** Subtitle includes the tool name when `stats.total === 1` (still no extra **Completed** on the group header).

**Re-check:** `echo FORGE-SUBTITLE-OK`. Header **▸ Tool activity · run terminal command**. Answer **FORGE-SUBTITLE-OK**. Shot: `docs/dogfood/forge-tool-sub.png`.

### 2026-08-30 — Forge Code ran markdown.parse 12/12
**Live:** Review Allow once. `src/markdown.parse.test.ts`. Answer **pass 12, fail 0**. Plan default. Shot: `docs/dogfood/forge-md-parse.png`.

### 2026-08-30 — Forge Code ran OverviewStrip 6/6
**Live:** Review Allow once. `src/OverviewStrip.test.ts`. Answer **pass 6, fail 0**. Shot: `docs/dogfood/forge-overview-tests.png`.

### 2026-08-30 — Forge Code typecheck exit 0
**Live:** Review Allow once. `Set-Location apps/shell; npx tsc -p tsconfig.json --noEmit`. Answer **0**. Shot: `docs/dogfood/forge-tsc2.png`.

### 2026-08-30 — Forge Code ran vendorAnswerClean 15/15
**Live:** Review Allow once. `src/vendorAnswerClean.test.ts`. Answer **pass 15, fail 0**. Shot: `docs/dogfood/forge-clean-15.png`.

### 2026-08-30 — Skills first page does not radius-clip a row
**Broke (live):** Scheduler slash shot cut `/session-info` on the first page; **New session** looked like a well; Code row said **New chat** / **AGENT**. Shot: `docs/dogfood/forge-slash-empty-top.png`.

**Fix:** Skills padding `8px 8px 28px`. `.btn.ghost.new-session-btn` beats `.btn` / `.btn.ghost:hover` so New session stays text. `.badge.running` stays un-transformed. Tests: quiet-chrome **26/26**.

**Re-check:** `/compact` on nebula. Last first-page row `/reload-plugins` fully inside the radius. **New session** text, row title **New session**, badge **agent**. Last catalog row `/writing-skills` unclipped. Shots: `docs/dogfood/forge-slash-inset-top.png`, `docs/dogfood/forge-new-session-title.png`.

### 2026-08-30 — apps/host typecheck is green
**Broke (live):** Forge `npx tsc -b --noEmit` in `apps/host` exit **1**. Ingress tests read `payload.activity` off the union; `settlePlanPhase` wanted a UUID template; `ev.code` on done|error; `token` undefined vs null; acquire argv implicit any; failure?.code after asserting null. Shot: `docs/dogfood/forge-host-tsc.png`.

**Fix:** Narrow activity with `'activity' in payload`; `settlePlanPhase` requestId is `string`; error-code message only when `ev.type === "error"`; `token ?? null`; typed argv; capture failCode before the null assert. Host restarted `:8788` pid 106600.

**Re-check:** Same command through Forge. Answer **0**. TOOLS 1, no fail. Shot: `docs/dogfood/forge-host-tsc-green.png`.

### 2026-08-30 — scheduler Your-turn-chip was lag
**Live re-check:** `echo FORGE-TURN-OK`. Collapsed Tool activity, no I'll-run lead-in, New session text, badge **agent**, Your turn chip, Plan default. Shot: `docs/dogfood/forge-turn-now.png`. The lagged `forge-your-turn-chip.png` well/AGENT/expanded-tools is stale.

### 2026-08-30 — Forge Code typechecked acp-client
**Live:** Review Allow once. `Set-Location packages/acp-client; npx tsc -p tsconfig.json --noEmit`. Answer **0**. Shot: `docs/dogfood/forge-acp-tsc.png`.

### 2026-08-30 — Forge Code ran vendor-acp 7/7
**Live:** Review Allow once. `src/client.vendor-acp.test.ts`. Answer **pass 7, fail 0**. Shot: `docs/dogfood/forge-acp-vendor.png`.

### 2026-08-30 — Forge Code ran App.slash-skills 18/18
**Live:** Review Allow once. `src/App.slash-skills.test.tsx`. Answer **pass 18, fail 0**. Shot: `docs/dogfood/forge-slash-skills.png`. Scheduler I'll-run report was lag (`forge-turn-now.png` already clean).

### 2026-08-30 — Forge Code typechecked grok-acp
**Live:** Review Allow once. `Set-Location packages/grok-acp; npx tsc -p tsconfig.json --noEmit`. Answer **0**. Shot: `docs/dogfood/forge-grokacp-tsc.png`.

### 2026-08-30 — first subdirectory shell is Set-Location
**Broke (live):** Prompt named `apps/shell` without Set-Location. First tool ran at workspace root (`Could not find src/App.slash-skills.test.tsx`), then retried. TOOLS 2 · 1 fail. Shot: `docs/dogfood/forge-turn-flow.png`. Did not invent a cwd engine.

**Fix:** `VENDOR_ACP_SHELL_CWD_RULE` requires Set-Location DIR; then the command in the **same** invocation, with an example. Dist rebuilt; DEV host restarted (`:8788` pid 69480). Tests: agents **7/7**.

**Re-check:** `From apps/shell run: … markdown.parse.test.ts` (no Set-Location in the prompt). One tool: **Set-Location apps/shell; node …**. TOOLS 1, no fail. **12 tests, 0 failed**. Shot: `docs/dogfood/forge-subdir-first.png`. Scheduler Your-turn-flow / I'll-run reports were lag.

**Still noisy:** `/always-approve` is vendor-advertised (Forge policy stays Review). Figma MCP `AuthRequired`. SHA/welcome stay installer/first-run honesty.

### 2026-08-30 — collapsed shell header is the command
**Broke (live):** HOST_TEST_PROMPT (`pass 7, fail 0`) collapsed Tool activity to **run terminal command**. Shot: `docs/dogfood/forge-host-test.png`.

**Fix:** Single generic shell uses `toolRowCaption` (the command) as the group subtitle. Tests: ToolActivity **17/17**.

**Re-check:** Same host tests. Header **Set-Location apps/host; node --import tsx —…**. Answer **pass 7, fail 0**. Shot: `docs/dogfood/forge-host-cmd.png`.

**Still noisy:** `/always-approve` is vendor-advertised (Forge policy stays Review). Figma MCP `AuthRequired`. SHA/welcome stay installer/first-run honesty.

### 2026-08-30 — Forge Code ran ToolActivity 17/17
**Live:** Review Allow once. `src/ToolActivity.test.tsx`. Answer **pass 17, fail 0**. Collapsed header is the command. Shot: `docs/dogfood/forge-shell-tests.png`.

### 2026-08-30 — You prompt keeps newlines
**Broke (live):** Multi-line You prompts collapsed to one run-on (`test.tsx First shell command`). `.run-prompt-body` used line-clamp without `pre-wrap`. Shot: `docs/dogfood/forge-shell-tests.png`.

**Fix:** `.run-prompt-body` is `white-space: pre-wrap` (2-line clamp stays). Tests: run.quiet-chrome **26/26**.

**Re-check:** Four-line prompt. Expanded **Show less** keeps line breaks. Answer **FORGE-YOU-WRAP-OK**. Shot: `docs/dogfood/forge-you-wrap.png`.

**Still noisy:** `/always-approve` is vendor-advertised (Forge policy stays Review). Figma MCP `AuthRequired`. SHA/welcome stay installer/first-run honesty.

### 2026-08-30 — collapsed write header is the path
**Broke (live):** WRAP write collapsed Tool activity to **write** while File changes already listed `docs/dogfood/WRAP.md`. Shot: `docs/dogfood/forge-wrap-write.png`.

**Fix:** Single-tool subtitle prefers the shell command (`toolRowCaption` plain), else a path-like summary (`docs/dogfood/WRITEHEAD.md`, `Write \`path\``, or session plan.md). Generic-without-command still names the tool. Tests: ToolActivity **19/19**.

**Re-check:** Review write `docs/dogfood/WRITEHEAD.md`. Allow once → `WRITEHEAD-OK`. Collapsed header **▸ Tool activity docs/dogfood/WRITEHEAD.md** (not **write**). File changes Accepted · Hide diff `+WRITEHEAD-OK`. Thought chip below You. Answered / Your turn above composer. Shot: `docs/dogfood/forge-write-head2.png`. First attempt collided with a concurrent scheduler turn + host restart (`forge-write-head.png`, 500 / Pending) — not the chrome defect.

### 2026-08-30 — Forge Code ran App.notFound 9/9
**Live:** Review Allow once. `src/App.notFound.test.tsx`. First tool **Set-Location apps/shell; …**. Answer **pass 9, fail 0**. Shot: `docs/dogfood/forge-notfound-18.png`. Wrapper `run-host.mjs` exit 1 is not down — `:8788` pid **69480** health 200.

### 2026-08-30 — Forge Code ran named-projects 5/5
**Live:** Review Allow once. `src/named-projects.component.test.tsx`. Answer **pass 5, fail 0**. Shot: `docs/dogfood/forge-named-5.png`.

### 2026-08-30 — Forge Code ran ToolActivity 19/19
**Live:** Review Allow once. `Set-Location apps/shell; node --import tsx --import ./src/testEnv.ts --test --test-timeout=30000 src/ToolActivity.test.tsx`. Answer **19 passed, 0 failed**. Collapsed header is the command. Shot: `docs/dogfood/forge-toolact-19.png`.

### 2026-08-30 — Forge Code ran ComposerPane 14/14
**Live:** Review Allow once. `src/ComposerPane.test.tsx`. First tool **Set-Location apps/shell; …**. Answer **pass 14, fail 0**. Shot: `docs/dogfood/forge-composer-tests.png`. Scheduler Set-Location report was lag (`forge-subdir-first.png` already clean).

### 2026-08-30 — Forge Code ran planArm 16/16
**Live:** Review Allow once. `src/planArm.test.ts` + `src/PlanArmControl.test.tsx`. Answer **pass 16, fail 0**. Shot: `docs/dogfood/forge-planarm-tests.png`.

### 2026-08-30 — Forge Code ran mcpServersProjection 31/31
**Live:** Review Allow once. `src/mcpServersProjection.test.ts`. Answer **pass 31 / fail 0**. Settled `mcpServers` null (no Loading MCP). Shot: `docs/dogfood/forge-mcp-proj.png`. Scheduler Show-more / no-browser work is folded; MCP empty-terminal was already ABSENT.

### 2026-08-30 — Forge Code ran childAgentsProjection 23/23
**Live:** Review Allow once. `src/childAgentsProjection.test.ts`. Answer **pass 23, fail 0**. Settled `childAgents` null. Shot: `docs/dogfood/forge-child-proj.png`.

### 2026-08-30 — unlabeled test dump is not CODE · N LINES
**Broke (live):** ToolActivity **19/19** painted the checkmark list as **CODE · 19 LINES · Copy**. Shot: `docs/dogfood/forge-toolact-19.png`. Unlabeled one-line fences were already compact; unlabeled multi-line still invented **CODE**.

**Fix:** Unlabeled multi-line fences are `.is-plain` (Copy only — no lang bar, no line numbers). Typed fences keep the language bar. Tests: markdown.oneline + CodeBlock **16/16**.

**Re-check:** Echo of an unlabeled checkmark fence. Dump has **Copy** and the two ✔ lines — no **CODE**, no **2 LINES**. **19 passed, 0 failed.** visible. Shot: `docs/dogfood/forge-plain-fence.png`. LOOPNOW write still clean (`forge-elect-now.png`).

**Still noisy:** `/always-approve` is vendor-advertised (Forge policy stays Review). Figma MCP `AuthRequired`. SHA/welcome stay installer/first-run honesty.

### 2026-08-30 — production-loop J1–J6
**Web:** J1 Write Allow once → File changes `docs/dogfood/J1-WEB.md`. J2 first shell `Set-Location apps/shell; node -e process.exit(2)` Failed. J3 `Set-Location apps/shell; npx tsc` exit 0. J4 Accept plan + three-step body. J5 `/session-info` last row unclipped. J6 `@docs/dogfood/KEEP.md` mention, no dump.

**Broke (J4 live):** After Accept plan the Plan section dropped the three-step body.

**Fix:** Accepted `projectRunPlanSection` keeps `plan.body`; Plan section renders `.plan-body`. Tests: PlanSection accepted-body + runPlanSection.

**Broke (desktop live):** Forge Dev on `http://127.0.0.1:5174` painted “couldn't reach its engine” while `/api/health` was 200. Cause: `ensure_host` IPC denied (`Plugin not found`) when origin was 127.0.0.1 instead of `devUrl` localhost; `hostBase()` then returned null (N-3) so the shell refused the Vite proxy.

**Fix:** `isViteDevOrigin` + `hostBase()` same-origin `""` on Vite :5173/:5174 under Tauri when no published port. Packaged `tauri.localhost` still null. Tests: desktopBridge N-3 still null without Vite origin; Vite spellings match. `dev-vite` capability lists both origins.

**Broke (desktop J4 live):** `desktop-run1-J4.json` logged `Maximum update depth exceeded` after Accept plan. Cause: composer `skillsPalette` / Project-instructions / Code-agent projections were new objects every PublicState paint, so `useEffect([skillsPalette])` + `setSkillsActiveIndex(0)` nested 50+ passive updates. Overflow latch and Thought `onToggle` were not the remaining loop.

**Fix:** Memoize composer projections on primitive fields; skills effects depend on `skillsPalette.state`; terminal chrome on `ownedAllTerminal`. Thought `nextThoughtOpen` (user click wins). J4 reveal pins plan below You. Tests: overflow 60-step latch, Thought no force-open, slash-skills 18/18.

**Re-check:** Desktop run1+run2 J1–J6 PASS. J4 planBody y=306 below You y=132; consoles have no max-update-depth. Shots: `docs/dogfood/goal-desktop-run{1,2}-J{n}.png`.

**Still noisy:** `/always-approve` is vendor-advertised (Forge policy stays Review). Figma MCP `AuthRequired`. SHA/welcome stay installer/first-run honesty.

