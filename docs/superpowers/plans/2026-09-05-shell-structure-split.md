# Shell Structure Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Break `apps/shell/src/App.tsx` (6,084 lines, one component, 283 hook calls) into focused hooks and view components, then reorganize `apps/shell/src` (305 flat files) into a domain layout — without changing a single user-visible behavior.

**Architecture:** Pure refactor. Every extraction is behavior-preserving: the same hooks run in the same order, with the same dependencies, against the same state. The domain logic already lives in tested pure modules (`runReducer.ts`, `runChangeList.ts`, `derivedLivePhase.ts`, …); this plan only reorganizes the React glue in `App()` that wires them, plus the directory layout around them. No new features, no API changes, no copy changes.

**Tech Stack:** React 19, TypeScript 5.8, Vite 6, zustand, tinykeys, node:test + @testing-library/react, biome.

## Global Constraints

- **Behavior-preserving.** No rendered text changes, no new props on user-facing components, no timing changes. If a task cannot preserve behavior, it stops and reports rather than "improving" something.
- **The test suite is the oracle.** Baseline at the branch point: `apps/shell` has **9 pre-existing failures** out of 1,645 (`npm test` from `apps/shell`). A task must not add a failure beyond that list, and every test touching the code it moved must pass. Record the real counts in the task report — a printed "passed" is not green; read the exit code.
- **`npm run typecheck` from the repo root must exit 0** after every task. For a pure move, typecheck is the primary proof that no import was missed.
- **Hook order is load-bearing.** React requires hooks to run unconditionally in a stable order. When extracting a hook, it must be called from `App()` at the same relative position its state/effects occupied. Never move a hook call across a conditional or an early return.
- **Dependency arrays are load-bearing and currently wrong in at least one place** (see Task 1). Never "clean up" a dependency array as a side effect of a move. If a move requires changing one, that is its own step with its own test.
- **Refs used as latest-value mirrors are load-bearing.** Some are written during render, some in an effect (see Task 2). Preserve the *timing* of each unless a task explicitly changes it.
- No path aliases exist; all imports are relative. Moving a file rewrites its importers — that is expected and typecheck catches every miss.
- Line numbers in this plan are from commit `4249540`. **Re-locate by symbol name, not by line number** — the file will shift as tasks land. Every task names the symbols it moves.
- Commit messages: conventional prefix (`refactor(shell):`, `fix(shell):`, `chore(shell):`), ending with the trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. Never push; never commit to `master`.
- Work on a branch off `master`: `refactor/shell-structure`.

---

## Phase 0 · Defuse the landmines

These four are latent bugs *and* tripwires: each would be silently broken by a naive extraction, with no error and no failing test. They are small, independently valuable, and make every later task safer. **Do them first.**

### Task 1: Fix the socket effect's incomplete dependency array

**The bug:** the `HostSocket` connect effect calls `restoreOwnedRuns("disconnect_restore")` and `toast.push(...)`, but its dependency array is only `[boot, markDisconnectedActivity]`. `restoreOwnedRuns` is *declared later in the file* and works today only because its dependency chain happens to be referentially stable (`restoreOwnedRuns` ← `restoreOwnedRunJournal` deps `[commitRunProjection]` ← `commitRunProjection` deps `[]`). Nothing enforces that. If any later task changes that chain's stability, the socket keeps calling the mount-time closure forever — the app silently stops restoring runs after a reconnect, and no test fails.

**Files:**
- Modify: `apps/shell/src/App.tsx` (the `useEffect` that constructs `HostSocket`; find it by searching for `new HostSocket` / `disconnect_restore`)
- Test: `apps/shell/src/App.socketRestore.test.tsx` (new)

- [ ] **Step 1: Write the failing test.** Prove the socket calls the *current* `restoreOwnedRuns`, not a stale one. Render `<App/>` against the fake host, let it connect, force a state change that would rebuild `restoreOwnedRuns` if its deps were unstable, then drop and restore the socket connection and assert a restore was attempted. Use `apps/shell/src/testFakeHost.ts` (`createFakeHost`, `FakeWebSocket`, `installTauriGlobal`, `readyStatus`) — read an existing socket test such as `apps/shell/src/hostSocket.resume.test.ts` for the established setup.

```tsx
// The point of this test is the SECOND connect: it must use the live
// restoreOwnedRuns, not the closure captured at mount.
assert.equal(restoreCallsAfterReconnect > restoreCallsAfterFirstConnect, true);
```

- [ ] **Step 2: Run it** — `node --import tsx --import ./src/testEnv.ts --test src/App.socketRestore.test.tsx` from `apps/shell`. It should pass today (the accidental stability holds). That is expected: this test is a **regression guard for the later tasks**, not a red-green cycle. Record in the report that it passed before the change.
- [ ] **Step 3: Make the dependency honest.** Rather than adding `restoreOwnedRuns` to the array (which would re-create the socket on every change and reconnect constantly — a real behavior change), give the effect a ref mirror, matching the pattern the file already uses for `applyRailEvidence`:
  - add `const restoreOwnedRunsRef = useRef(restoreOwnedRuns);`
  - keep it current in an effect: `useEffect(() => { restoreOwnedRunsRef.current = restoreOwnedRuns; });`
  - call `restoreOwnedRunsRef.current("disconnect_restore")` inside the socket effect
  - leave the socket effect's dependency array otherwise unchanged, and add a comment saying the socket is deliberately built once and reads the latest restore through the ref.
- [ ] **Step 4: Run** the new test, `src/hostSocket.resume.test.ts`, `src/App.engineDeath.test.tsx`, `src/reliable-autonomous-runs.integration.test.tsx`, then `npm run typecheck` and the full `npm test`. All must pass with no new failures.
- [ ] **Step 5: Commit** — `fix(shell): read the live run-restore from the socket effect`

### Task 2: Normalize the latest-value refs

**The problem:** three refs are written **synchronously during render** (`sessionIdRef.current = sessionId`, `applyRailEvidenceRef.current = applyRailEvidence`, `paintEnvelopeActivityRef.current = paintEnvelopeActivity`, and `busyRef.current = busy`) while two others (`stateRef`, `messagesRef`) are written **in an effect**. Both work today, but they differ in *when* the value becomes visible, and a split that moves one group without knowing which kind it is will change behavior invisibly.

Render-time ref writes are unsafe under React's concurrent rendering (a render can be discarded, leaving the ref set from work that never committed). The effect form is correct.

**Files:**
- Modify: `apps/shell/src/App.tsx`
- Test: `apps/shell/src/App.refMirrors.test.tsx` (new)

- [ ] **Step 1: Inventory.** In the report, list every `SomethingRef.current = something` assignment in `App.tsx`, its line, and whether it is in render or in an effect. This inventory goes in the task report so later tasks can consult it.
- [ ] **Step 2: Write a characterization test** proving the two behaviors that depend on `sessionIdRef` being current: (a) a run event arriving for the *previous* session after a fast session switch is not painted into the new session's rail; (b) `sendText` admits against the session that is current at send time. Look at `apps/shell/src/App.storedHistory.test.tsx` and `src/named-projects.app.test.tsx` for how session switching is driven in tests.
- [ ] **Step 3: Move the render-time writes into effects**, one at a time, running the test after each: `sessionIdRef`, then `busyRef`, then the two callback mirrors. If any of them genuinely requires the render-time timing (a consumer reads it during the same render), **stop and leave that one alone with a comment explaining why** — and say so in the report. Do not force all four.
- [ ] **Step 4: Run** the new test plus `src/App.flows.test.tsx`, `src/live-turn-attention.app.test.tsx`, `src/acp-live-streams.app.test.tsx`, `npm run typecheck`, and the full `npm test`.
- [ ] **Step 5: Commit** — `fix(shell): write latest-value refs in effects, not during render`

### Task 3: Memoize `activeHome`

**The problem:** `const activeHome = sessionId ? loadSession(sessionPartition, sessionId) : null;` runs a **synchronous `localStorage` read in the render body on every render**, and its result feeds six JSX consumers (`ReviewSurface`, `ThreadHeader`, `ChatHomeName` ×2 props, `MessageList`, `ArtifactPanel`, `RunSurface`). It is also a fresh object identity every render, so every memoized child receiving it re-renders.

**Files:**
- Modify: `apps/shell/src/App.tsx`
- Test: `apps/shell/src/App.activeHome.test.tsx` (new)

- [ ] **Step 1: Write the failing test.** Assert `loadSession` is called at most once per session change across several unrelated re-renders. Spy by wrapping the module import, or count reads via a fake `localStorage` in `testEnv`. Keep the assertion behavioral (the same title still renders) as well as count-based.
- [ ] **Step 2: Run it** — expect FAIL (called on every render).
- [ ] **Step 3: Wrap in `useMemo`** keyed on `[sessionPartition, sessionId, sessionList]` — `sessionList` is included because a rename must refresh the title. Verify a rename still updates every consumer; if it does not, key on whatever the rename path actually bumps and say so in the report.
- [ ] **Step 4: Run** the new test, `src/ChatHomeName.test.tsx`, `src/named-projects.component.test.tsx`, `npm run typecheck`, full `npm test`.
- [ ] **Step 5: Commit** — `perf(shell): memoize the active chat home`

### Task 4: Unify the duplicated policy-control wiring

**The problem:** the `PermissionPolicyControl` + `BypassPermissionsControl` block, with its `onSave` / `onActiveChange` closures, is written twice, nearly verbatim: once for the composer's policy popover and once inside the Settings view. Two copies of the same trust-critical wiring will drift — and the Settings-view extraction in Task 6 would otherwise move one copy and orphan the other.

There is a second, smaller instance of the same smell: Settings has a "Restart engine" button doing `restartDesktopHost().then(() => bootApp())` while the rest of the app routes recovery through `retryHost`. Reconcile these two as part of this task, or record explicitly why they must differ.

**Files:**
- Create: `apps/shell/src/PolicyControls.tsx` (+ `PolicyControls.test.tsx`)
- Modify: `apps/shell/src/App.tsx` (both call sites)

- [ ] **Step 1: Read both copies** and diff them by hand. Record every difference in the report — if they have already drifted, the differences are the interesting part, and the unified component must preserve whichever behavior is correct (say which you chose and why).
- [ ] **Step 2: Write the test** for the extracted component: saving a policy calls the save callback with the chosen policy; the bypass control's active-change fires; a save failure surfaces the existing notice copy.
- [ ] **Step 3: Extract** `PolicyControls` taking `{ state, sessionId, onApplyState, onError }` (match the real shapes in `App.tsx`), and use it at both call sites.
- [ ] **Step 4: Run** the new test, `src/App.reliable-settings.test.tsx`, `src/trusted-command-classes.integration.test.tsx`, `src/App.tool-run-trust.test.tsx`, `npm run typecheck`, full `npm test`.
- [ ] **Step 5: Commit** — `refactor(shell): one policy-control component for both call sites`

---

## Phase 1 · Split the JSX tail

The returned JSX is ~1,025 lines with three mutually-exclusive views. Extracting them is the largest line reduction for the least logic risk, because the views mostly *pass props through*.

### Task 5: Extract `SettingsView`

The Settings view is ~456 lines and self-contained once Task 4 removes the duplicated policy wiring.

**Files:**
- Create: `apps/shell/src/SettingsView.tsx` (+ `SettingsView.test.tsx`)
- Modify: `apps/shell/src/App.tsx`

**Interfaces:**
- `SettingsView` receives exactly what the JSX block reads today. Derive the prop list mechanically: take the extracted JSX, let typecheck name every unresolved identifier, and make each one a prop. Do not invent a "settings state object" — pass the individual values so the diff stays reviewable.

- [ ] **Step 1: Write the test** covering what the Settings view must still render: the auth section, the policy controls (from Task 4), trusted command classes, model presets, appearance (theme / density / motion / background), the shortcuts help list, app update, and export/import. Assert on visible copy, not structure.
- [ ] **Step 2: Run it** against the current `App` (it should pass — this is a characterization test that must keep passing across the move).
- [ ] **Step 3: Move the JSX** into `SettingsView.tsx` verbatim. Let typecheck drive the prop list. Change no copy and no class names.
- [ ] **Step 4: Run** the new test, `src/App.reliable-settings.test.tsx`, `src/copyInvariants.test.tsx`, `npm run typecheck`, full `npm test`.
- [ ] **Step 5: Commit** — `refactor(shell): extract SettingsView`

### Task 6: Extract `ChatView` and `TranscriptBody`

The chat view is ~382 lines, and inside it the transcript's five mutually-exclusive empty/loading states form a natural nested component.

**Files:**
- Create: `apps/shell/src/ChatView.tsx`, `apps/shell/src/TranscriptBody.tsx` (+ tests for each)
- Modify: `apps/shell/src/App.tsx`

**Interfaces:**
- `TranscriptBody` owns the ladder: conversations-not-found → onboarding → signed-out/Home → host-offline → the run stream + `MessageList`. Its props are the flags that select a branch plus the data each branch needs.
- `ChatView` composes `ThreadHeader`, the optional `ChatHomeName`, the run footer, `TranscriptBody`, `ArtifactPanel`, `ActionDock` and `ComposerPane`.

- [ ] **Step 1: Write `TranscriptBody.test.tsx`** asserting the ladder: exactly one branch renders for each combination, and the precedence order matches today's. This is the highest-value test in the phase — the ladder is easy to reorder by accident.
- [ ] **Step 2: Run it** against the current `App` (characterization; must pass before and after).
- [ ] **Step 3: Extract `TranscriptBody`**, then `ChatView` around it. Typecheck drives the props.
- [ ] **Step 4: Run** both new tests, `src/journeys.unit.test.tsx`, `src/chat.journeys.unit.test.tsx`, `src/App.launch.test.tsx`, `src/App.notFound.test.tsx`, `src/App.signin.test.tsx`, `npm run typecheck`, full `npm test`.
- [ ] **Step 5: Commit** — `refactor(shell): extract ChatView and TranscriptBody`

---

## Phase 2 · Extract the clean-cut hooks

These four have narrow inputs and few cross-domain reads. Each is one commit. After each, `App.tsx` shrinks and the next is easier.

### Task 7: `useArtifactBinding`

The cleanest candidate in the file — narrow, self-contained.

**Files:**
- Create: `apps/shell/src/useArtifactBinding.ts` (+ `useArtifactBinding.test.ts`)
- Modify: `apps/shell/src/App.tsx`

**Interfaces:**
- Moves: `artifactOpenBinding` state, `closeArtifact`, `openRunArtifact`, `openMessageArtifact`, `boundArtifact` memo, and the two clearing effects.
- `useArtifactBinding({ sessionId, runProjection, messages })` → `{ artifactOpenBinding, boundArtifact, artifactAnnounce, closeArtifact, openRunArtifact, openMessageArtifact }`.

- [ ] **Step 1: Write the hook test** with `renderHook`: opening a run artifact binds it; opening a message artifact binds it; a session change clears the binding; `closeArtifact` sets the announce string and clears the binding.
- [ ] **Step 2: Run it** — FAIL (hook does not exist).
- [ ] **Step 3: Move** the state, callbacks, memo and both effects into the hook, preserving their relative order. Call it from `App()` at the position the state currently occupies.
- [ ] **Step 4: Run** the new test, `src/App.artifacts-panel.test.tsx`, `src/MessageList.artifacts.test.tsx`, `src/RunSurface.artifacts.test.tsx`, `src/ArtifactPanel.test.tsx`, `npm run typecheck`, full `npm test`.
- [ ] **Step 5: Commit** — `refactor(shell): extract useArtifactBinding`

### Task 8: `useSkillsPalette`

**Files:**
- Create: `apps/shell/src/useSkillsPalette.ts` (+ test)
- Modify: `apps/shell/src/App.tsx`

**Interfaces:**
- Moves: skills-palette state, its projection memo and four effects, and `armSkill` (currently a plain function recreated every render — keep it a plain function or make it a `useCallback`, but say which and why in the report).
- `useSkillsPalette({ productMode, codeAgent, skillsCatalog, draft, composerRef, sessionId })` → `{ skillsPalette, skillsOpen, skillsRows, skillsIndex, effectiveArmedName, armSkill, setSkillsActiveIndex }`.

- [ ] **Step 1: Write the test**: the palette only opens in Code mode with a vendor agent; a session change clears the armed skill; arming fills the composer per today's behavior.
- [ ] **Step 2: Run it** — FAIL. - [ ] **Step 3: Extract.** - [ ] **Step 4: Run** the new test, `src/App.slash-skills.test.tsx`, `src/SkillsPalette.test.tsx`, `src/SkillArmedChip.test.tsx`, typecheck, full suite. - [ ] **Step 5: Commit** — `refactor(shell): extract useSkillsPalette`

### Task 9: `useHomeScreenData`

**Files:**
- Create: `apps/shell/src/useHomeScreenData.ts` (+ test)
- Modify: `apps/shell/src/App.tsx`

**Interfaces:**
- Moves: `treeWorkspaces`, `chatSessions`, `homeChatPartition`, `needsYouReasonsKey`, `homeNeedsYou`, `homeRecentWorkspaces`, `paletteSessions`, `homeChatHomes`, `homeFooter`, the branch-refresh effect, and the `homeOn*` wrapper callbacks.
- `useHomeScreenData({ sessionList, expandTick, chatRoot, needsYouReasons, buildInfo, authLabel, ... })` → the nine memos plus the wrappers.

- [ ] **Step 1: Write the test**: needs-you ordering, recent-workspace grouping, and that the footer omits facts it does not have (the house/guest rule — a missing version or channel is omitted, never faked).
- [ ] **Step 2: Run it** — FAIL. - [ ] **Step 3: Extract.** - [ ] **Step 4: Run** the new test, `src/HomeScreen.test.tsx`, `src/named-projects.component.test.tsx`, `src/sessions.needsYou.test.ts`, typecheck, full suite. - [ ] **Step 5: Commit** — `refactor(shell): extract useHomeScreenData`

### Task 10: `useChangesProjections`

**Files:**
- Create: `apps/shell/src/useChangesProjections.ts` (+ test)
- Modify: `apps/shell/src/App.tsx`

**Interfaces:**
- Moves: `sessionRuns` through `reviewCommitDraft` (the three dock projections, the activity status/lifecycle/output maps, `changesAvailable`/`changesVisible`), `recoverChangeMember`, and the diff-settlement callbacks (`settleOwnedDiff`, `acceptDiff`, `rejectDiff`, the dock wrappers, `acceptAllDiffs`, `rejectAllDiffs`).
- `useChangesProjections({ runProjection, catchUpByRunId, productMode, sessionId, onError, toast })` → `{ changesDockFiles, changesDockVerify, changesDockGit, changesActivityStatusById, changesActivityLifecycleById, changesActivityOutputById, changesAvailable, reviewCommitDraft, diffQueue, acceptDiff, rejectDiff, recoverChangeMember, acceptAllDiffs, rejectAllDiffs }`.
- **Note:** both `ChangesDock` and `ReviewSurface` consume this same object. Keep it one object so the two surfaces cannot drift.
- **Carry the `runLive` contract:** `changesDockVerify` must keep its `runLive` field (any run still in flight keeps the whole set live) — `apps/shell/src/ReviewSurface.tsx` gates its "all green" claim on it.

- [ ] **Step 1: Write the test**: the three projections flatten several runs; `runLive` is true when any run is live; accept/reject route to the same settle path.
- [ ] **Step 2: Run it** — FAIL. - [ ] **Step 3: Extract.** - [ ] **Step 4: Run** the new test, `src/ChangesDock.test.tsx`, `src/ReviewSurface.test.tsx`, `src/inspectable-run-changeset.app.test.tsx`, `src/git-review-surface.integration.test.tsx`, `src/trusted-deletes-renames.app.test.tsx`, typecheck, full suite. - [ ] **Step 5: Commit** — `refactor(shell): extract useChangesProjections`

---

## Phase 3 · Extract the hard hooks

These carry the coupling. Each is one commit, and each must be reviewed on its own. **If any of these cannot be made behavior-preserving, stop and report rather than pushing through** — a partial Phase 3 is a fine resting place.

### Task 11: `useDecisions`

**Files:** Create `apps/shell/src/useDecisions.ts` (+ test); modify `App.tsx`.

**Interfaces:**
- Moves: `permissions`/`diffQueue`/`oauth` state, `pendingPlanDecision` + its reset effect, `pendingRecoveryDecision`, `planArm`, `decidePermission`, `trustFolder`, `settlePlan`, `recoverFromDock`, `chooseAskOption`.
- Returns those, **plus a derived `anyDecisionPending`** — today `oauth || permissions.length || diffQueue.length || pendingPlanDecision` is re-derived in four places (`sendDisabledReason`, the tinykeys effect, `ComposerPane`'s `lockedReason`, `ThreadHeader`'s `decisionPending`). One field, four consumers.
- **Trust-critical:** `decidePermission("allow_session")` sets session-wide write/shell flags. The guard that a bare `S`/`Y`/`N` only settles a permission when the dock owns focus (`dockOwnsFocus` in `inEditable.ts`) must keep working — it is covered by existing tests; do not weaken them.

- [ ] **Step 1: Write the test**: each decision kind settles through the right path; `anyDecisionPending` matches the four current derivations exactly (assert against each). - [ ] **Step 2: Run** — FAIL. - [ ] **Step 3: Extract.** - [ ] **Step 4: Run** the new test, `src/Gate.test.tsx`, `src/ActionDock.test.tsx`, `src/App.tool-run-trust.test.tsx`, `src/plan-mode.app.test.tsx`, `src/trusted-command-classes.integration.test.tsx`, `src/stalePermissionDecision.test.ts`, typecheck, full suite. - [ ] **Step 5: Commit** — `refactor(shell): extract useDecisions`

### Task 12: `useComposerSend`

**Files:** Create `apps/shell/src/useComposerSend.ts` (+ test); modify `App.tsx`.

**Interfaces:**
- Moves: draft/queue state, `sendText` (~300 lines, the largest callback in the file), `send`, `queueCurrentDraft`, `cancelQueuedDraft`, the queue-flush effect, `onReviewSendToGrok`.
- Returns `{ draft, setDraft, queuedDraft, sendText, send, queueCurrentDraft, cancelQueuedDraft }`.
- **Preserve the session binding:** a queued draft is bound to the session it was queued against and must not flush into a different session, and must survive an offline flush attempt rather than being dropped. This is covered by existing tests — read them before you move anything.
- `sendText` reads roughly a dozen domains. Pass them as one options object rather than a dozen positional parameters, and keep the parameter names identical to today's variable names so the diff reads as a move.

- [ ] **Step 1: Write the test** for the queue contract above (session binding, offline retention) at the hook level. - [ ] **Step 2: Run** — FAIL. - [ ] **Step 3: Extract.** - [ ] **Step 4: Run** the new test, `src/composerSend.test.ts`, `src/ComposerPane.test.tsx`, `src/App.flows.test.tsx`, `src/App.ac12g.test.tsx`, `src/chat.journeys.unit.test.tsx`, typecheck, full suite. - [ ] **Step 5: Commit** — `refactor(shell): extract useComposerSend`

### Task 13: `useRunEventStream`

**The highest-value and highest-risk extraction.** It owns `messages`, which nearly every other region reads, so its return shape becomes the app-wide contract.

**Files:** Create `apps/shell/src/useRunEventStream.ts` (+ test); modify `App.tsx`.

**Interfaces:**
- Moves: the streaming engine (`discardTranscriptStream`, `beginStreamRun`, `bindNormalizedRun`, the batched projection-flush effect, the `StreamBuffer` token-accumulation effect), the activity/rail identity helpers (`stampActivity`, `applyRailEvidence`, `paintEnvelopeActivity`, `markDisconnectedActivity` and their ref mirrors), `onServerEvent`, and the journal restore/reconcile trio.
- Returns `{ runProjection, runProjectionRef, commitRunProjection, catchUpByRunId, onServerEvent, restoreOwnedRuns, reconcileOwnedRuns, messages, setMessages, streamBufRef }`.
- **The ref-mirror handoff must survive the boundary.** `onServerEvent` deliberately excludes `applyRailEvidence`/`paintEnvelopeActivity` from its dependency array and reads them through refs. Task 2 will have normalized *when* those refs are written; this task must keep the *indirection* — do not "simplify" the refs away.
- **Referential stability is a contract here**, because Task 1's socket effect depends on `restoreOwnedRuns` being stable. If extraction changes that, Task 1's test catches it — run it.

- [ ] **Step 1: Write the test** at the hook level: a `text_delta` sequence accumulates into one message; a run envelope reduces into the projection; a restore after a disconnect rehydrates owned runs. - [ ] **Step 2: Run** — FAIL. - [ ] **Step 3: Extract**, moving the pieces in the order they appear so hook order is preserved. - [ ] **Step 4: Run** the new test, `src/App.socketRestore.test.tsx` (Task 1), `src/acp-live-streams.app.test.tsx`, `src/acp-live-streams.component.test.tsx`, `src/live-turn-attention.app.test.tsx`, `src/reliable-autonomous-runs.integration.test.tsx`, `src/App.engineDeath.test.tsx`, `src/streamBuffer.test.ts`, typecheck, full suite. - [ ] **Step 5: Commit** — `refactor(shell): extract useRunEventStream`

### Task 14: `useEngineHealth`

**Files:** Create `apps/shell/src/useEngineHealth.ts` (+ test); modify `App.tsx`.

**Interfaces:**
- Moves: boot/launch state, `clearBootTimers`, `refreshBuildInfo`, `bootApp`, the mount-boot effect, the socket connect/reconnect effect, the health-poll effect, `retryHost`.
- Returns `{ boot, bootMsg, slowStart, diagRevealed, launchStatus, hostOk, wsOk, healthFailStreak, buildInfo, engineRetryAllowed, retryHost, refreshBuildInfo, socketRef }`.
- **This hook needs a back-reference into the run domain** (`restoreOwnedRuns`, `markDisconnectedActivity`, `onServerEvent`). Take them as parameters from `useRunEventStream`'s return — which means Task 13 must land first. Do not create a circular import between the two hooks.
- Health-poll timing is testable through `apps/shell/src/healthPollTestClock.ts`; keep using it.

- [ ] **Step 1: Write the test**: boot reaches ready; a health failure streak flips `hostOk`; `retryHost` re-boots and re-hydrates. - [ ] **Step 2: Run** — FAIL. - [ ] **Step 3: Extract.** - [ ] **Step 4: Run** the new test, `src/App.launch.test.tsx`, `src/App.engineDeath.test.tsx`, `src/App.failure.test.tsx`, `src/hostSocket.resume.test.ts`, `src/launchState.test.ts`, typecheck, full suite. - [ ] **Step 5: Commit** — `refactor(shell): extract useEngineHealth`

### Task 15: `useShortcuts` and `useCommandPalette` — decide, then act

**Read this before doing it.** Both of these have a fan-in equal to their current dependency array (~20-25 entries each). Extracting them **relocates** the coupling; it does not reduce it. The hook's parameter list will be as long as the dependency array is now.

- [ ] **Step 1: Decide and record.** Extract only if `App.tsx` reads better with a 25-parameter hook call than with the effect inline. Write the decision and its reasoning in the report. **Not extracting is an acceptable, defensible outcome** — say so plainly rather than doing it because the plan listed it.
- [ ] **Step 2: If extracting**, move the tinykeys effect to `apps/shell/src/useShortcuts.ts` and `paletteActions` to `apps/shell/src/useCommandPalette.ts`, taking one options object each. Preserve every guard, especially `inEditable` / `dockOwnsFocus`.
- [ ] **Step 3: Run** `src/App.ac6.test.tsx`, `src/CommandPalette.test.tsx`, `src/App.tool-run-trust.test.tsx`, typecheck, full suite.
- [ ] **Step 4: Commit** — `refactor(shell): extract useShortcuts and useCommandPalette` (or record the decision not to, with no commit).

---

## Phase 4 · The directory move

**Do this last, and only in a quiet window** — it touches ~305 files and will conflict with any concurrent work. Confirm with the operator before starting.

### Task 16: Reorganize `apps/shell/src`

**Target layout** (tests stay beside their subject; `state/`, `styles/`, `ui/`, `test-support/` already exist and keep their contents):

```
apps/shell/src/
  app/          App.tsx, main.tsx, verifyGrokUi.tsx, the extracted hooks
  surfaces/     HomeScreen, ReviewSurface, RunSurface, MessageList, SettingsView,
                ChatView, TranscriptBody, EmptyStates, Onboarding, BootScreen,
                LaunchFailureCard, ConnectorsPanel, OverviewStrip
  chrome/       AppTopbar, WindowControls, BrandMark, ModeSwitch, Sidebar,
                ThreadHeader, AppBanners, FieldLayer
  dock/         ActionDock, Gate, ChangesDock, ArtifactPanel
  composer/     ComposerPane, CommandPalette, SkillsPalette, EffortControl,
                PolicyChip, PolicyControls, PlanArmControl, ContextRing,
                composerSend, atFileQuery, expandMentions, contextAttach,
                promptHistory, promptSendHistory, attachBusy
  thread/       Receipts, receiptVerb, RichBlocks, richUi, markdown, markdownParse,
                messageBlocks, codeHighlight, codeHighlightAsync, parseCache,
                streamBuffer, VirtualList, Toast
  sections/     PlanSection, ChildAgentsSection, HooksSection, McpServersSection,
                BrowserSection, RunTerminalNotice, and the status/provenance chips
  projections/  runReducer, runEventSchema, runChangeList, runVerifyList,
                runGitReviewList, runPlanSection, derivedLivePhase, catchUpWindows,
                activity*, *Projection, *Composer, planArm, artifact*,
                stalePermissionDecision, trustedCommandProvenance, launchState,
                failureCard, diffUtil, toolFormat, vendorAnswerClean
  lib/          api, sessions, sessionIO, prefs, desktop*, crashSink, csp,
                export*, copyClipboard, copyDock, timeAgo, fonts, firstRun,
                inEditable, installerHonesty, healthPollTestClock
```

- [ ] **Step 1: Write the move manifest** as a script at `apps/shell/scripts/reorg-src.mjs`: an explicit `{ from, to }` list for every file, derived from the layout above. Print the list and the count; move nothing yet. Review it before running.
- [ ] **Step 2: Confirm the taxonomy** against the real file list — anything the manifest does not classify must be listed and decided deliberately, not defaulted into `lib/`.
- [ ] **Step 3: Move with `git mv`** so history follows, then rewrite relative imports across the whole tree. Do the rewrite by resolving each import to an absolute path against the OLD layout and re-relativizing against the NEW one — never by string-replacing `"./x"` patterns, which breaks on same-name files in different directories.
- [ ] **Step 4: Typecheck is the oracle** — `npm run typecheck` from the repo root must exit 0. Then run the full `npm test` and compare the failure list to the baseline exactly.
- [ ] **Step 5: Check the non-TS references** that typecheck cannot see: `apps/shell/index.html` and `verify-grok-ui.html` (entry script paths), `apps/shell/vite.config.ts`, `apps/shell/vitest.config.ts`, `knip.json` (entry globs), and any `scripts/*.mjs` that names a shell path. Grep for `src/` across those files.
- [ ] **Step 6: Commit** — `refactor(shell): group src by domain` (one commit; a partial move is worse than none).

---

## Self-review notes

- **Coverage of the analysis.** Every region the map identified has a home: rows 1-9 → Tasks 13/14; rows 10-13 → Tasks 9/10/11; rows 14-24 → Tasks 9/11 and what remains in `App()`; rows 25-31 → Task 12; rows 32/34 → Task 15; rows 35-36 → Tasks 5/6. The four landmines are Phase 0.
- **What this plan deliberately does not do:** it does not introduce a state-management library, a context provider, or a path alias. Each would be a larger architectural bet than a refactor should make unasked. If prop-threading after Phase 3 proves painful, that is the moment to propose one — with evidence from the finished split, not before it.
- **Stopping points.** After Phase 0 the app is strictly better (four real bugs fixed) with no structural churn. After Phase 2 `App.tsx` is materially smaller with low risk. Phase 3 and Phase 4 are each independently abandonable. There is no point in this plan where stopping leaves the tree in a worse state than it started.
- **Expected outcome.** `App.tsx` goes from 6,084 lines to roughly 800-1,200 (the remaining wiring plus the top-level tree), with ~10 focused hooks and 4 view components beside it, and `src/` goes from 305 flat files to nine labelled directories.
