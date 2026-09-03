# Voidglass Refined (Direction A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Forge desktop shell (`apps/shell`) to the approved "Direction A · Voidglass, refined" design: one palette, a spine thread with receipts, an amber gate above a one-row composer, a Changes dock and Review surface, a Home screen, a frameless Windows window, and restrained motion.

**Architecture:** Presentation-layer rebuild on top of the existing state model (`runReducer.ts` projections, `sessions.ts` store, `api.ts` host calls). New surfaces are new focused components (`Gate`, `Receipts`, `ChangesDock`, `ReviewSurface`, `HomeScreen`, `WindowControls`, `ui/Chip`) wired where the old ones were; stylesheets are cut over to tokens. Engine/host changes are limited to one additive event (context usage).

**Tech Stack:** React 19, Vite 6, TypeScript 5.8, zustand, react-aria-components, react-resizable-panels, lucide-react, shiki, Tauri 2 (Rust config only), vitest + node:test + @testing-library/react, biome.

**Design source of truth:** the canvas `docs/design/forge-next/*.dc.html` (Main = Code screen, Chat, Review, Home, Components) and the brief `docs/design/forge-next/Research.dc.html`. Read the relevant artboard for any task that touches a screen; copy exact values from it.

## Global Constraints

- Tokens: void `#050508`; glass `rgba(255,255,255,0.04)` / raised `rgba(255,255,255,0.07)`; floating `rgba(14,16,22,0.92)` + `backdrop-filter: blur(20px)`; stroke `rgba(255,255,255,0.08)`; text `#f2f4f8`; secondary `rgba(242,244,248,0.78)`; muted `#8b93a7`; accent (cyan, actions and live) `#5ce1ff`; accent2 (violet, thought and plan) `#a78bfa`; accent3 (amber, ONLY "needs you") `#f0b45a`; danger `#ff7a90`; success `#5ee4a8`.
- One palette: no `rgba(125, 255, 232, …)` or `rgba(196, 181, 253, …)` literals remain in `apps/shell/src/styles/*.css`; use `color-mix(in srgb, var(--accent) N%, transparent)` / `var(--accent2)`.
- Radii: controls `10px`, cards `12px`–`14px`, composer and floating layers `16px`, chips `999px`.
- Control heights: `28px` (sm), `32px` (md), `36px` (lg); icon buttons `30px`; nothing interactive under `28px`.
- Type: Geist (bundled via `@fontsource-variable/geist`, keep); prose `15px / 1.62` at a `640px` measure; UI `13px`; labels `11px` uppercase `0.08em`; mono `12px` only for paths, commands, counts.
- Motion tokens stay: `--dur-fast 120ms`, `--dur 200ms`, `--dur-slow 360ms`, `--ease-out cubic-bezier(0.22,1,0.36,1)`, `--ease-spring cubic-bezier(0.34,1.4,0.64,1)`. Every animation is disabled under `prefers-reduced-motion: reduce` and `html[data-motion="calm"]`.
- Shortcuts are Windows style in UI text: `Ctrl+K` (palette), `Ctrl+P` (search sessions), `Ctrl+N` (new session), `Ctrl+O` (open folder), `Ctrl+Shift+N` (new chat). Gate keys: `⏎` allow once, `S` allow for session, `esc` deny; `Y` and `N` remain aliases. Review keys: `A`/`R` hunk in focus, `⇧A`/`⇧R` file, `Ctrl+⇧A` all.
- Copy: sentence case, plain verbs. Banned in rendered text: "Speak into the continuum", "YOUR TURN", "Tool activity" as a group title, "Answered" as a strip, "Attention required". The five surfaces covered by `apps/shell/src/copyInvariants.test.tsx` must keep passing (banned developer tokens such as "host", "npm", "port" must not appear in those surfaces).
- The house/guest split stays: Forge shows what the engine reports; it never invents tool catalogs, usage numbers, or git state. Anything the engine does not report is omitted, not faked.
- Test commands (run from `apps/shell`): `npm run typecheck`; most test files are `node:test` files, run one with `node --import tsx --import ./src/testEnv.ts --test <file>`; only `*.vitest.ts(x)` files run under `npx vitest run <file>`; `npm test` runs both suites; `npm run lint` (biome) from the repo root. 13 tests already fail on the baseline commit 1341742 (listed in `.superpowers/sdd/task-1-report.md`); a task must not add a failing test beyond that list, and everything it touches must pass.
- Commit messages: conventional prefix (`feat(shell):`, `refactor(shell):`, `test(shell):`), ending with the trailer line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Never push.
- Work on branch `redesign/voidglass-refined`. Never commit to `master`.

---

## Phase 1 · Tokens and chrome

### Task 1: One palette and the new tokens

**Files:**
- Modify: `apps/shell/src/styles/tokens.css`
- Modify: `apps/shell/src/styles/chrome.css`, `apps/shell/src/styles/run.css`, `apps/shell/src/styles/dock.css`, `apps/shell/src/styles/settings.css`, `apps/shell/src/styles/motion.css`
- Create: `apps/shell/scripts/unify-palette.mjs` (one-off codemod, kept for the record)
- Test: `apps/shell/src/styles.tokens.test.ts` (new, `node:test`)

**Interfaces:**
- Produces CSS custom properties used by every later task: `--surface-1: rgba(255,255,255,0.04)`, `--surface-2: rgba(255,255,255,0.07)`, `--surface-float: rgba(14,16,22,0.92)`, `--stroke: rgba(255,255,255,0.08)`, `--stroke-live: color-mix(in srgb, var(--accent) 35%, transparent)`, `--r-control: 10px`, `--r-card: 12px`, `--r-float: 16px`, `--h-sm: 28px`, `--h-md: 32px`, `--h-lg: 36px`, `--h-icon: 30px`, `--measure: 640px`, `--attention: var(--accent3)`.

- [ ] **Step 1: Write the failing test** — `apps/shell/src/styles.tokens.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const stylesDir = path.join(here, "styles");
const read = (f: string) => fs.readFileSync(path.join(stylesDir, f), "utf8");
const ALL = ["tokens.css", "chrome.css", "run.css", "dock.css", "settings.css", "motion.css"];

describe("Voidglass tokens", () => {
  it("declares the surface, radius and height tokens", () => {
    const t = read("tokens.css");
    for (const name of ["--surface-1", "--surface-2", "--surface-float", "--stroke", "--stroke-live", "--r-control", "--r-card", "--r-float", "--h-sm", "--h-md", "--h-lg", "--h-icon", "--measure", "--attention"]) {
      assert.ok(t.includes(`${name}:`), `${name} missing`);
    }
  });
  it("has no Aeon hardcodes left", () => {
    for (const f of ALL) {
      const css = read(f);
      assert.equal(/rgba\(\s*125\s*,\s*255\s*,\s*232/.test(css), false, `${f} still has mint`);
      assert.equal(/rgba\(\s*196\s*,\s*181\s*,\s*253/.test(css), false, `${f} still has lilac`);
    }
  });
});
```

- [ ] **Step 2: Run it** — `node --import tsx --import ./src/testEnv.ts --test src/styles.tokens.test.ts` → FAIL (tokens missing, hardcodes present).
- [ ] **Step 3: Add tokens** to `:root` in `tokens.css` (after `--dur-slow`), exactly the names and values in Interfaces. Keep every existing token.
- [ ] **Step 4: Write and run the codemod** `apps/shell/scripts/unify-palette.mjs`: for each stylesheet replace `rgba(125, 255, 232, A)` (any spacing) with `color-mix(in srgb, var(--accent) P%, transparent)` where `P = Math.round(A * 100)`, and `rgba(196, 181, 253, A)` with `color-mix(in srgb, var(--accent2) P%, transparent)`. Run it once: `node scripts/unify-palette.mjs`. Inspect `git diff --stat`.
- [ ] **Step 5: Run the test and typecheck** — test PASS; `npm run typecheck` PASS. Also run `npx vitest run src/codeHighlight.lightCss.test.ts` (light theme still resolves).
- [ ] **Step 6: Commit** — `feat(shell): unify palette on Voidglass tokens and add surface/radius/height tokens`.

### Task 2: Button sizes, Chip primitive, vector brand mark

**Files:**
- Modify: `apps/shell/src/ui/Button.tsx`, `apps/shell/src/ui/Button.test.tsx`, `apps/shell/src/buttonVariants.vitest.ts`
- Create: `apps/shell/src/ui/Chip.tsx`, `apps/shell/src/ui/Chip.test.tsx`
- Modify: `apps/shell/src/BrandMark.tsx` (inline SVG from `apps/shell/public/brand-mark.svg`, sizes 18 / 28 / 44)
- Modify: `apps/shell/src/styles/chrome.css` (`.btn` sizes, `.chip` rewrite)

**Interfaces:**
- `buttonVariants` gains `size: { sm: "btn-sm", md: "", lg: "btn-lg" }` (default `md`) and `variant` gains `accent` (solid `var(--accent)`, ink `#041016`) and `danger`. `.btn` = `height: var(--h-md); padding: 0 12px; border-radius: var(--r-control); font: 500 13px`. `.btn-sm` = `height: var(--h-sm); padding: 0 10px; font-size: 12.5px; border-radius: 8px`. `.btn-lg` = `height: var(--h-lg); padding: 0 14px; font-size: 13.5px; border-radius: 12px`. `.btn.icon-only` = `width: var(--h-icon); height: var(--h-icon); padding: 0`.
- `Chip` props: `{ tone?: "default" | "quiet" | "on" | "attention"; icon?: ReactNode; trailing?: ReactNode; children; onPress?; title?; className? }` renders `<span|button class="chip chip-<tone>">`; height 28px, pill, 12.5px. `attention` uses `--attention` stroke and tint.
- `BrandMark` props `{ size?: 18 | 28 | 44 }`.

- [ ] **Step 1: Tests** — extend `Button.test.tsx` (size classes present; `accent` variant class), create `Chip.test.tsx` (renders button when `onPress`, span otherwise; tone class), extend `buttonVariants.vitest.ts` for the new variants. Run → FAIL.
- [ ] **Step 2: Implement** the three files and CSS. Replace the eight `!important` size overrides in the stylesheets (`.msg-action`, `.md-copy-btn`, `.tool-peek-btn`, `.sess-op`, `.toast-x`, `.new-session-btn`, `.file-changes-actions .btn.ghost`, `.open-folder-btn-compact`) with `size="sm"` at the call sites (grep for each class in `*.tsx`).
- [ ] **Step 3: Run** the two test files, `npm run typecheck`, and `npx vitest run` → PASS.
- [ ] **Step 4: Commit** — `feat(shell): button sizes, Chip primitive, vector brand mark`.

### Task 3: Static aurora by default; stars behind a preference

**Files:**
- Modify: `apps/shell/src/prefs.ts` (add `field: "aurora" | "stars"`, default `"aurora"`, migrate missing → `"aurora"`), `apps/shell/src/prefs.test.ts`
- Modify: `apps/shell/src/FieldLayer.tsx` (draw only the two nebula gradients unless `prefs.field === "stars"`; observe pref changes), `apps/shell/src/styles/tokens.css` (body background = the two radial gradients from the canvas: `radial-gradient(900px 480px at 8% -12%, color-mix(in srgb, var(--accent) 7%, transparent), transparent 58%), radial-gradient(760px 420px at 100% -6%, color-mix(in srgb, var(--accent2) 8%, transparent), transparent 55%), var(--void)`)
- Modify: the Settings appearance section in `apps/shell/src/App.tsx` (add a "Background: Aurora / Stars" switch beside Motion)

- [ ] **Step 1: Test** in `prefs.test.ts`: `loadPrefs()` on an empty store yields `field: "aurora"`; a stored `{...}` without `field` migrates to `"aurora"`. Run → FAIL.
- [ ] **Step 2: Implement** prefs + FieldLayer + Settings switch.
- [ ] **Step 3: Run** `npx vitest run src/prefs.test.ts`, `npm run typecheck`, `npx vitest run src/App.reliable-settings.test.tsx` → PASS.
- [ ] **Step 4: Commit** — `feat(shell): static aurora background; stars become a preference`.

### Task 4: Topbar with six things, frameless window, caption buttons

**Files:**
- Modify: `apps/shell/src/AppTopbar.tsx` (brand mark 18 + "FORGE" wordmark, workspace switcher button `[folder] name · branch ⌄`, `ModeSwitch`, spacer, engine dot pill `Grok · live` / `Grok · reconnecting`, `Ctrl+K` kbd button, Settings icon button, then `WindowControls`)
- Create: `apps/shell/src/WindowControls.tsx` (+ `WindowControls.test.tsx`): renders minimize / maximize / close (46×52 hit areas, 10px stroke SVGs, close hover `#c42b1c`) only when `isTauri()`; uses `getCurrentWindow()` from `@tauri-apps/api/window` (`minimize()`, `toggleMaximize()`, `close()`); the topbar gets `data-tauri-drag-region`.
- Modify: `apps/shell/src-tauri/tauri.conf.json` and `apps/shell/src-tauri/tauri.conf.dev.json` → `"decorations": false`; confirm `@tauri-apps/api` window API is allowed in `src-tauri/capabilities/*.json` (add `core:window:allow-minimize`, `core:window:allow-toggle-maximize`, `core:window:allow-close`, `core:window:allow-start-dragging` if missing).
- Modify: `apps/shell/src/styles/chrome.css` (`.topbar` 52px, `padding: 0 0 0 14px`, tokens; delete `.brand-mode`, `.workspace-label`, `.channel-badge`, auth chips from the topbar). Channel badge and auth source move to the Settings header line (Task 3's section) and the Home footer (Task 13).
- Tests: `apps/shell/src/App.launch.test.tsx`, `App.signin.test.tsx` (fix assertions that looked for topbar chips), new `WindowControls.test.tsx`.

- [ ] **Step 1: Tests** — `WindowControls.test.tsx`: renders nothing when not Tauri (`installTauriGlobal` absent); renders three buttons with `aria-label`s "Minimize", "Maximize", "Close" when Tauri is installed. Run → FAIL.
- [ ] **Step 2: Implement.** Keep the `Reconnect` button and engine states. Keyboard: the workspace switcher opens the command palette filtered to workspaces (reuse `useChromeStore().setPaletteOpen(true)`).
- [ ] **Step 3: Run** the affected tests, `npm run typecheck`, `npx vitest run` → PASS.
- [ ] **Step 4: Commit** — `feat(shell): six-item topbar, frameless window with caption buttons`.

### Task 5: Sessions rail one level deep, with a Needs-you group

**Files:**
- Modify: `apps/shell/src/sessions.ts` (add `needsYou?: boolean` on `ChatSession`; `setSessionNeedsYou(workspace, id, needsYou)`; `listNeedsYou(workspace): ChatSession[]`), `apps/shell/src/sessions.named-home.test.ts` or new `sessions.needsYou.test.ts`
- Modify: `apps/shell/src/App.tsx`: when the active run projection has a pending `DecisionRequest` (`runReducer.ts:98`, status `"pending"`) call `setSessionNeedsYou(ws, sessionId, true)`; clear when it settles or the run ends.
- Modify: `apps/shell/src/Sidebar.tsx` (Code branch): order = gradient CTA `New session` (36px) → search field with `Ctrl+P` kbd → `Needs you` group (label + amber count; rows: amber breathing dot, title, `approve` / `question` word) → workspaces as collapsible headers (`chevron · name · branch mono · live dot if any session busy · count`) with session rows (dot idle/live/done, title ellipsis, time-ago). Remove `.side-mode-banner`, `.nav-tabs`, `.side-foot` help text and the path-paste row (Open folder lives in Home and `Ctrl+O`). Footer: avatar + `Grok · subscription|API key` + version mono.
- Modify: `apps/shell/src/styles/run.css` / `chrome.css` sidebar rules to the canvas values (`.row` 34px, 9px radius; `.wshead` 30px; labels 11px caps).
- Tests: `apps/shell/src/named-projects.component.test.tsx`, `sessions.partition.test.ts` (update), new `Sidebar.needsYou.test.tsx`.

- [ ] **Step 1: Tests** — `sessions.needsYou.test.ts`: `setSessionNeedsYou` flips the flag and `listNeedsYou` returns those sessions first by `updatedAt`. `Sidebar.needsYou.test.tsx`: renders a "Needs you" group with count when a session has `needsYou`. Run → FAIL.
- [ ] **Step 2: Implement** store + App wiring + Sidebar.
- [ ] **Step 3: Run** the tests plus `npx vitest run` and `node --import tsx --import ./src/testEnv.ts --test src/named-projects.component.test.tsx` → PASS; fix any journey test that asserted removed sidebar copy ("Sessions nest under pinned folders", "Messages", "Settings" tabs).
- [ ] **Step 4: Commit** — `feat(shell): one-level sessions rail with Needs-you group`.

## Phase 2 · The thread

### Task 6: Receipts replace tool activity

**Files:**
- Create: `apps/shell/src/receiptVerb.ts` (+ `receiptVerb.test.ts`): `receiptVerb(record: ActivityRecord): { verb: "Read" | "Ran" | "Edited" | "Searched" | "Fetched" | "Listed" | "Skipped" | "Waiting for you" | "Did"; what: string; tail: string; tone: "ok" | "fail" | "pending" | "waiting" | "muted" }`. Mapping: names matching `/read|cat|open/` → Read; `/list|ls|dir/` → Listed; `/grep|search|find/` → Searched; `/fetch|http|browse/` → Fetched; `/write|edit|patch|create|replace/` → Edited; shell/bash/execute/command or a raw command caption (`activityLabel.ts` `toolRowCaption(...).plain`) → Ran; `isForgeUnavailableVendorTool` → Skipped with tail `not available in Forge`; pending decision → Waiting for you with tail `needs approval`; else Did. `what` = command or path list; `tail` = `exit N · M errors` / `clean · 4.1s` / `+6 −2` / `+N` (extra paths count) / `trusted class · no prompt` when `ToolRunEvent` says automatic.
- Create: `apps/shell/src/Receipts.tsx` (+ `Receipts.test.tsx`): group card (`.receipts`, 12px radius, header `N actions · Ns` with a chevron that toggles), rows 30px (`icon 16 · verb · what mono 12px ellipsis · tail mono 11.5px right`), an expanded row shows `.rout` (mono 11.5px, up to 48 lines then `… (N more lines)`, actions `Copy output` and `Open <path>:<line>` as 28px buttons). Keep the open/close intent semantics of `ToolActivity.tsx` (`automatic_open | explicit_open | explicit_closed`, auto-close on clean settle, stay open on failure).
- Modify: `apps/shell/src/RunSurface.tsx` and `MessageList.tsx` to render `Receipts` where `ToolActivityGroup` was; delete `ToolActivity.tsx` when no longer imported; move its tests' intent into `Receipts.test.tsx` (`ToolActivity.test.tsx` cases: failure opens, running spinner, not-run vendor tool, trusted-class note).
- Modify: `apps/shell/src/styles/run.css` (delete `.tool-activity*`, add `.receipts*` from the canvas).

- [ ] **Step 1: Tests first** for `receiptVerb` (8 cases: read, list, grep, shell command with exit code, write with ±, vendor-unavailable, pending decision, generic) and `Receipts` (header count and duration; failed row expanded by default; expanded row shows truncated output and the two actions). Run → FAIL.
- [ ] **Step 2: Implement** and wire. The header count excludes the "Waiting for you" row.
- [ ] **Step 3: Run** `npx vitest run src/receiptVerb.test.ts src/Receipts.test.tsx`, then `npm test` → PASS (update `ToolActivity.test.tsx`, `App.tool-run-trust.test.tsx`, `App.vendor-*.test.tsx` expectations from "Tool activity" to the new header text; keep their intent).
- [ ] **Step 4: Commit** — `feat(shell): receipts replace tool activity groups`.

### Task 7: Spine, prompt block, thought line, prose; chat bubbles

**Files:**
- Modify: `apps/shell/src/RunSurface.tsx`: turn anatomy = `<article class="turn">` with `<i class="node ...">` (hollow for You; filled cyan while running; amber breathing while `waiting_for_decision`; rose on `failed`; muted when `answered`), then `.you` block (14px radius, `color-mix(accent 3%)` fill, 10% stroke, header `You · HH:MM`, `@path` mentions rendered as `.mention` chips), then `.thought` one-line summary `Thought for Ns — <first 120 chars>` (violet, chevron opens the full `think-aloud`), then `Receipts`, then `.prose` (15px / 1.62, max-width `var(--measure)`). Delete the sticky `.run-prompt` behaviour, the `.run-provenance` chip row (fold `model · effort · policy` into the thread header meta, Task 9), the `Answered` strip and the `Your turn` delimiter (`MessageList.tsx:38`).
- Modify: `apps/shell/src/MessageList.tsx` (Chat mode): user = right-aligned `.bubble` (16/16/6/16 radius, `color-mix(accent 6%)`), timestamp below; assistant = `.who` line (`gradient dot · Grok · <reads summary>`) + `.prose`; remove the `Grok · presence` label and the message card border/blur for assistant text.
- Modify: `apps/shell/src/styles/run.css`, `chrome.css` (thread column: `.stream` padding `24px 28px 8px 24px`, `.spine` 1px rail at `left: 39px`, `.turn` `padding-left: 40px`).
- Tests: update `live-turn-attention.component.test.tsx`, `journeys.unit.test.tsx`, `chat.journeys.unit.test.tsx`, `MessageList.idle.test.tsx`, `run.quiet-chrome.test.ts` for the removed copy; add `RunSurface.spine.test.tsx` (node state per run state).

- [ ] **Step 1: Test** `RunSurface.spine.test.tsx`: for a projection in `waiting_for_decision` the turn node has class `node--amber`; in `terminal/answered` it has `node--done`; the DOM contains no text "Your turn" or "Answered". Run → FAIL.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Run** `npm test` → PASS after updating the listed tests.
- [ ] **Step 4: Commit** — `feat(shell): spine thread anatomy and chat bubbles`.

## Phase 3 · Trust surfaces

### Task 8: The gate

**Files:**
- Create: `apps/shell/src/Gate.tsx` (+ `Gate.test.tsx`) replacing `PermissionCard.tsx`: tiers by `DecisionRequest.kind` and policy: shell → amber `Grok wants to run a command` with `$ cmd` block and cwd, `.why` = `detail`; write → amber `Grok wants to write a file` with path + `±` and a 2-line snippet when the request carries a diff; plan → violet `Plan ready · N files would change` (members list) with `Accept plan ⏎`, `Keep planning`; recovery_confirmation → cyan question card with numbered options. Header right shows the asking policy (`Review policy · asks before shell`). Actions: `Allow ⏎`, `Allow <class> for this session S` (label uses the matched trusted command class from `trustedCommandProvenance.ts` / `TrustedCommandClassesView`; falls back to `Allow for this session`), `Deny esc`, and `Edit command` (ghost, prefills the composer with the command text). Keys: `⏎`, `S`, `esc`, plus `Y`/`N` aliases (`App.tsx:3799-3880` handlers).
- Modify: `apps/shell/src/ActionDock.tsx` (render `Gate`; drop the "Attention required" label; the dock is a normal flex child above the composer, not `position: sticky` with `--composer-height`), `apps/shell/src/copyDock.ts` (strings), `apps/shell/src/styles/dock.css` (canvas `.gate` styles; amber tint gradient; `rise` animation).
- Tests: `Gate.test.tsx` (tier per kind, keys shown, class label), update `App.tool-run-trust.test.tsx`, `trusted-command-classes.*.test.tsx`, `plan-mode.*.test.tsx` expectations.

- [ ] **Step 1: Tests** → FAIL. - [ ] **Step 2: Implement.** - [ ] **Step 3:** `npm test` → PASS. - [ ] **Step 4: Commit** — `feat(shell): tiered gate with keyboard hints replaces the permission card`.

### Task 9: Changes dock and thread header

**Files:**
- Create: `apps/shell/src/ChangesDock.tsx` (+ `ChangesDock.test.tsx`): right panel (380px, `react-resizable-panels` Panel, min 300 max 560) with header `Changes · N files · +a −b`, tabs `Files (N)` / `Verify` / `Git`, file rows (path with muted dir, `±`, `Accept` / `Reject` 28px minis for pending, `Accepted` check), a hunk preview of the selected file (first hunk from `diffUtil.ts`), `Verify` rows from `runVerifyList.ts`, `Git` row from `runGitReviewList.ts`, footer `Review & commit…` (opens Task 10's surface). Data: `runChangeList.ts` + the diff queue that `DiffPanel.tsx` reads; accept/reject call the same `api` functions `DiffPanel` uses.
- Create: `apps/shell/src/ThreadHeader.tsx`: 44px bar = session title, meta `model · effort · N min`, a live status (`amber dot · Waiting for you · Ns` / `cyan dot · Running · Ns`, from `derivedLivePhase.ts`), then Overview, Export (moved out of the composer), `Changes N` toggle chip. Wire in `App.tsx` above the transcript; remove `RunStatusBar` and `OverviewStrip` from the stage (Overview becomes the header button opening the strip as a popover).
- Modify: `apps/shell/src/App.tsx` layout: `PanelGroup` = sidebar | main | changes (dock hidden when the toggle is off or there are no changes and no verify rows).
- Modify: `apps/shell/src/DiffPanel.tsx` (no longer rendered in the dock; keep its accept/reject helpers exported), `FileChangesSection.tsx`, `VerifySection.tsx`, `GitReviewSection.tsx` (no longer rendered in the stream — the dock owns them; delete when unreferenced).
- Tests: `ChangesDock.test.tsx`, update `inspectable-run-changeset.*.test.tsx`, `git-review-surface.*.test.tsx`, `structured-test-panel.*.test.tsx`, `OverviewStrip.*` to the dock.

- [ ] **Step 1: Tests** → FAIL. - [ ] **Step 2: Implement.** - [ ] **Step 3:** `npm test` → PASS. - [ ] **Step 4: Commit** — `feat(shell): changes dock and thread header`.

### Task 10: Review surface with line comments

**Files:**
- Create: `apps/shell/src/ReviewSurface.tsx` (+ `ReviewSurface.test.tsx`): full-width center view (`Thread` back button, title `Review changes`, meta, `1 of N accepted` progress) with three columns 250 / flex / 300: file list; hunks (`@@` header, `Accept hunk A` / `Reject R` when the engine reports per-hunk acceptance is possible, else per-file `Accept file ⇧A` / `Reject file ⇧R`; accepted hunks get a mint stroke and `Undo`); a line-comment card that opens under any line on click (`Comment on line N`, textarea, `Send to Grok Ctrl+⏎` → sends `In <path> line N: <comment>` to the composer send path with the hunk as context, `Discard`); footer `Ask Grok to change this file…` field. Right column: Verify rows + raw test output block labeled `npm test · raw output`, Git block with the commit message draft (from the engine's git review evidence when present, else empty) and `Commit accepted files Ctrl+⇧⏎` which sends the prompt `Commit the accepted files with this message:` to Grok (Forge does not run git itself). Footer: `Reject all`, `Accept all Ctrl+⇧A`.
- Modify: `apps/shell/src/App.tsx` (`view === "review"` state; open from the dock footer and `Ctrl+Shift+R`), keyboard handlers.
- Tests: `ReviewSurface.test.tsx` (keys, comment prefill text, commit prompt text).

- [ ] **Step 1: Tests** → FAIL. - [ ] **Step 2: Implement.** - [ ] **Step 3:** `npm test` → PASS. - [ ] **Step 4: Commit** — `feat(shell): review surface with per-file accept and line comments`.

## Phase 4 · Composer and Home

### Task 11: One-row composer that grows; chips; Queue and Stop

**Files:**
- Modify: `apps/shell/src/ComposerPane.tsx`: idle = one row 46px (`attach icon-btn · textarea rows=1 · Plan chip (quiet, PlanArmControl) · Expert ⌄ chip (EffortControl becomes a popover menu) · Review ⌄ chip (policy popover: Review / Trusted workspace / Bypass, from PermissionPolicyControl + BypassPermissionsControl) · context ring (Task 12, hidden until data) · send 32px circle`); when the draft has a newline or exceeds one line the textarea grows (max 200px) and the chips drop to a second row. Placeholder Code: `Ask Grok to change something… @ file · / command`; while a run waits on you: `Reply or steer Grok… @ file · / command`; Chat: `Message <home>… paste text, drop a PDF`. While busy: the row shows `Queue ⇧⏎` (client-side queue: send when the run ends; show `Queued · 1` chip) and `Stop esc` (cancel); `Steer ⏎` only when `PublicState` reports `capabilities.steer === true` (not today). Remove `Export` from the composer (it lives in the thread header). Meta line (one line, mono 11px): `<policy sentence> · <model> · AGENTS.md loaded` and right `⏎ send · ⇧⏎ line · Ctrl+K commands`.
- Modify: `apps/shell/src/composerSend.ts` (queue), `App.tsx` footer (`App.tsx:5216-5292` block → the single meta line), `styles/dock.css`, `styles/chrome.css` (`.composer` one-row, `.chip` usage).
- Tests: `ComposerPane.test.tsx` (placeholders; grows on newline; Queue/Stop while busy; no Export), `composerSend.test.ts` (queued message sends after `busy` flips false), update `App.ac*.test.tsx` that assert the old footer.

- [ ] **Step 1: Tests** → FAIL. - [ ] **Step 2: Implement.** - [ ] **Step 3:** `npm test` → PASS. - [ ] **Step 4: Commit** — `feat(shell): one-row composer with chips, queue and stop`.

### Task 12: Context ring (engine → host → shell)

**Files:**
- Modify: `packages/grok-acp/src/xai.ts` (or wherever responses are consumed): after each model response with `usage`, emit a session update `{ kind: "usage", promptTokens, contextWindow }` where `contextWindow` comes from `packages/model-catalog` for the active model (add the field there if absent; leave `null` when unknown).
- Modify: `apps/host/src/index.ts` (forward as a run event `kind: "usage"`), `apps/shell/src/runReducer.ts` (`RunProjectionRun.usage?: { promptTokens: number; contextWindow: number | null }`), `apps/shell/src/runEventSchema.ts`.
- Create: `apps/shell/src/ContextRing.tsx` (+ test): 18px SVG ring (`r=7.5`, `stroke-dasharray 47.1`, offset = `47.1 × (1 − pct)`), label `NN%`, title `NN% of context used · compacts at 80%`; renders `null` when usage or window is unknown; turns amber at ≥ 80%.
- Tests: `packages/grok-acp` test for the usage event; `runReducer.test.ts` for the new field; `ContextRing.test.tsx`.

- [ ] **Step 1: Tests** → FAIL. - [ ] **Step 2: Implement** across the three packages. - [ ] **Step 3:** `npm test` at the repo root → PASS. - [ ] **Step 4: Commit** — `feat: context usage event and composer ring`.

### Task 13: Home screen

**Files:**
- Create: `apps/shell/src/HomeScreen.tsx` (+ `HomeScreen.test.tsx`): shown when no session is open (replaces `EmptyStates` kinds `ready` and `no-workspace`; `signed-out`, `host-offline`, `conversations-not-found` stay). Layout from the canvas: mark 44 + `Good <morning|afternoon|evening>, <first name from the OS user or "there">.` + `<N> sessions need you. <M> others finished while you were away.` (omit clauses that are zero) → 760px field `Open a folder, jump to a session, or ask Grok…` (typing opens the palette with the query) → hints row (`Ctrl+O open folder · Ctrl+N new session · Ctrl+Shift+N new chat · @ file · / command`) → two columns: `Needs you` items (44px, amber, first item focused with `⏎`), `Recent` workspaces (folder icon, name, branch mono, `N sessions · <last session title>`, time-ago; `All sessions` link), `Chat homes` (swatch, name, last chat, time), `Start` rows (`Open a folder as a Code workspace Ctrl+O`, `New session in the last workspace Ctrl+N`, `New chat in a home Ctrl+Shift+N`) → footer: `Forge <version> · Windows`, the installer honesty line (`installerHonesty.ts`), `Grok · <auth source>`, and the dev-channel fact (`channelBadge()`) when non-prod. Arrow keys move focus between items; `⏎` opens.
- Modify: `apps/shell/src/App.tsx` (render `HomeScreen`), `EmptyStates.tsx` (remove `ready`/`no-workspace` sample prompts), `copyInvariants.test.tsx` (Home is a launch surface: it must pass the banned-token check — so the footer says `data folder` not the path with a port; `channelBadge()` text must not contain "host").
- Tests: `HomeScreen.test.tsx` (greeting counts, focus + Enter opens the first needs-you session, footer facts), update `App.launch.test.tsx`.

- [ ] **Step 1: Tests** → FAIL. - [ ] **Step 2: Implement.** - [ ] **Step 3:** `npm test` → PASS including `copyInvariants.test.tsx`. - [ ] **Step 4: Commit** — `feat(shell): home screen opens on what needs you`.

### Task 14: Palette and anchored menus on the floating surface

**Files:**
- Modify: `apps/shell/src/CommandPalette.tsx`, `SkillsPalette.tsx`, the `@` menu in `ComposerPane.tsx`, `Toast.tsx`, `ui/Tooltip.tsx`; styles in `chrome.css` / `run.css` / `dock.css`: floating surface `var(--surface-float)` + `blur(20px)`, `--r-float`, shadow `0 28px 80px rgba(0,0,0,0.55)`; palette input 48px with a 2px cyan caret; rows 36px; footer `↑↓ move · ⏎ run · esc close`; command rows show a right-aligned `.src` (`vendor` / `skill` / `Forge`) and the header `N of M match` while filtering. Add `Ctrl+P` = palette in "sessions" mode (search sessions across workspaces). Toasts: 40px, `dot · text · optional Jump button · ×` (Task 5's needs-you toast: `<session> needs you` with `Jump`).
- Tests: `CommandPalette.test.tsx` (Ctrl+P mode filter), `Toast.test.ts` (jump action), `SkillsPalette.test.tsx` (header count text).

- [ ] **Step 1: Tests** → FAIL. - [ ] **Step 2: Implement.** - [ ] **Step 3:** `npm test` → PASS. - [ ] **Step 4: Commit** — `feat(shell): floating surfaces for palette, menus, toasts`.

## Phase 5 · Chat and motion

### Task 15: Chat homes, pack, citations, Beside

**Files:**
- Modify: `apps/shell/src/Sidebar.tsx` (Chat branch): `New chat` CTA, search, `Homes` label with rows (swatch from a stable hash of the id into `[#a78bfa, #5ce1ff, #8b93a7]`, name, count), chats under the active home, `Pack` section (`Add` action, file rows with page/size from `ChatPackView`), footer with version. Remove the `Local files` panel copy block (folder choice moves to the `Add` menu).
- Modify: `apps/shell/src/RichBlocks.tsx` `file` block → `.cite` chip style (`<name> · p.N` when the block carries a page); `apps/shell/src/ArtifactPanel.tsx` → `Beside` panel (380px, header `BESIDE · <title>`, tabs when the artifact has sections, footer `Copy · Export .md · vN · HH:MM`), the in-thread `.beside` card (`icon · title · sub · Open`), and the header `Beside` chip with an `on` state while open.
- Tests: `MessageList.artifacts.test.tsx`, `ArtifactPanel.test.tsx`, `ChatPackInventory.test.tsx`, `richUi.render.test.tsx` updates; new assertions for the swatch hash and the cite chip.

- [ ] **Step 1: Tests** → FAIL. - [ ] **Step 2: Implement.** - [ ] **Step 3:** `npm test` → PASS. - [ ] **Step 4: Commit** — `feat(shell): chat homes, pack section, citations, Beside panel`.

### Task 16: Motion

**Files:**
- Modify: `apps/shell/src/styles/motion.css` (single home for keyframes): `pulse` (live dot ring 1.8s), `breathe` (amber 2.4s), `rise` (gate 360ms ease-out), `check-draw` (receipt check stroke 160ms), `shimmer` (running verb 1.8s), `caret-blink` (1s steps(2)), `dock-slide` (changes dock 360ms), `mint-sweep` (accepted hunk 240ms spring). Streaming text uses the existing `streamBuffer.ts` at a steady 40ms per word cadence. Delete `aeon-breathe`, `aeon-pulse`, `aeon-rise`, `aeon-fade-in`, `side-mode-in` and their users. One `@media (prefers-reduced-motion: reduce)` block and one `html[data-motion="calm"]` block cover every animation name.
- Tests: `motion.test.ts` (node): every `@keyframes NAME` in `motion.css` appears in both the reduced-motion and calm blocks; no `aeon-` keyframes remain in any stylesheet.

- [ ] **Step 1: Test** → FAIL. - [ ] **Step 2: Implement.** - [ ] **Step 3:** run the test, `npm test` → PASS. - [ ] **Step 4: Commit** — `feat(shell): motion system for the redesign`.

### Task 17: Cleanup, canon amendments, full verify

**Files:**
- Delete dead CSS and components no longer referenced (`ToolActivity.tsx`, `PermissionCard.tsx`, `RunStatusBar.tsx`, `OverviewStrip.tsx` if fully replaced, `ChatSidebar.tsx` stub); run `npm run knip` and remove what it flags in `apps/shell`.
- Modify: `.spire/clusters/tech/context/DESIGN_SYSTEM.md` → add an Amendments row dated 2026-09-01: radius scale 16 / 12–14 / 10, one palette (Aeon hardcodes retired), stars behind a preference, receipts replace "Tool activity", composer one row in flow, SVG brand mark, one Chip and Button sizes; `docs/brand/README.md` → note the SVG mark is now the in-app mark.
- Run from the repo root: `npm run verify` (typecheck + lint + tests) → PASS; `npm run desktop:dev` smoke: open a folder, send a prompt, approve a gate, open Review, open Home — record what was seen in the task report.

- [ ] **Step 1:** knip + deletions. - [ ] **Step 2:** docs. - [ ] **Step 3:** `npm run verify` → PASS. - [ ] **Step 4: Commit** — `chore(shell): remove replaced surfaces; record canon amendments`.

---

## Self-review notes

- Spec coverage: canvas screens → Tasks 4–5 (chrome), 6–7 (thread), 8–10 (trust), 11–14 (composer, ring, home, floating), 15 (chat), 16 (motion); brief's system changes → Tasks 1–3, 17. Steer is deliberately gated on an engine capability (host returns `409 run_active` today); per-hunk accept is gated the same way; git commit is a prompt to Grok, not a Forge git call.
- Type consistency: `needsYou` (Task 5) is read by Tasks 13 and 14; `receiptVerb` (Task 6) is used by Task 7's thread; `Gate` (Task 8) is rendered by `ActionDock`; `ChangesDock` (Task 9) opens `ReviewSurface` (Task 10); `ContextRing` (Task 12) is mounted by Task 11's composer (hidden until data).
