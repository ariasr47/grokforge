#!/usr/bin/env node
// Task 16 — move manifest for `apps/shell/src` domain reorg.
//
// Classifies every top-level file in `apps/shell/src` into one of the nine
// new domain directories named in `.superpowers/sdd/task-16-brief.md`, or
// into one of the four pre-existing directories (`state/`, `styles/`, `ui/`,
// `test-support/`) for the small number of files whose sole subject already
// lives there, or leaves it at the src root when moving it would break a
// path hardcoded outside this repo's TypeScript graph (see ROOT_STAYS below).
//
// Classification order for each real file found directly under `src/`:
//   1. Exact-filename override (OVERRIDES) — for files whose own name does
//      not share a "base name" with the module/component they belong to
//      (compound feature-test files like `acp-live-streams.app.test.tsx`,
//      or files like `styles.css` with no test-suffix grammar at all).
//   2. Base-name match (BASE_TO_DIR) — the filename with its extension and
//      every `.foo.test`/`.foo.vitest`-style suffix stripped back to the
//      first remaining dot. This is what puts `App.ac12g.test.tsx` beside
//      `App.tsx` and `Sidebar.chatHomes.test.tsx` beside `Sidebar.tsx`
//      automatically, without listing every test file by hand.
//   3. Anything left over is UNCLASSIFIED and the script exits non-zero
//      rather than defaulting it into `lib/` — see task-16-brief.md Step 2.
//
// Usage:
//   node apps/shell/scripts/reorg-src.mjs            # print the plan only
//   node apps/shell/scripts/reorg-src.mjs --move      # git mv every entry
import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SHELL_ROOT = join(SCRIPT_DIR, ".."); // apps/shell
const SRC = join(SHELL_ROOT, "src");

// ---------------------------------------------------------------------------
// 1. Base-name -> new directory. Covers a source file and every test variant
//    that shares its base name (see stripToBaseName below).
// ---------------------------------------------------------------------------
const BASE_TO_DIR = {
  // app/ — App.tsx, main.tsx, verifyGrokUi.tsx, the extracted hooks, App's
  // own test double.
  App: "app",
  main: "app",
  verifyGrokUi: "app",
  useArtifactBinding: "app",
  useSkillsPalette: "app",
  useHomeScreenData: "app",
  useChangesProjections: "app",
  useDecisions: "app",
  useComposerSend: "app",
  useRunEventStream: "app",
  useEngineHealth: "app",
  testFakeHost: "app",

  // surfaces/
  HomeScreen: "surfaces",
  ReviewSurface: "surfaces",
  RunSurface: "surfaces",
  MessageList: "surfaces",
  SettingsView: "surfaces",
  ChatView: "surfaces",
  TranscriptBody: "surfaces",
  EmptyStates: "surfaces",
  Onboarding: "surfaces",
  BootScreen: "surfaces",
  LaunchFailureCard: "surfaces",
  ConnectorsPanel: "surfaces",
  OverviewStrip: "surfaces",

  // chrome/
  AppTopbar: "chrome",
  WindowControls: "chrome",
  BrandMark: "chrome",
  ModeSwitch: "chrome",
  Sidebar: "chrome",
  ThreadHeader: "chrome",
  AppBanners: "chrome",
  FieldLayer: "chrome",

  // dock/
  ActionDock: "dock",
  Gate: "dock",
  ChangesDock: "dock",
  ArtifactPanel: "dock",

  // composer/ — the named composer pieces, plus PermissionPolicyControl /
  // BypassPermissionsControl / TrustedCommandClassesControl (see report:
  // all three are rendered by/alongside PolicyControls in the same
  // permission-policy family, confirmed by import).
  ComposerPane: "composer",
  CommandPalette: "composer",
  SkillsPalette: "composer",
  EffortControl: "composer",
  PolicyChip: "composer",
  PolicyControls: "composer",
  PlanArmControl: "composer",
  ContextRing: "composer",
  composerSend: "composer",
  atFileQuery: "composer",
  expandMentions: "composer",
  contextAttach: "composer",
  promptHistory: "composer",
  promptSendHistory: "composer",
  attachBusy: "composer",
  PermissionPolicyControl: "composer",
  BypassPermissionsControl: "composer",
  TrustedCommandClassesControl: "composer",

  // thread/
  Receipts: "thread",
  receiptVerb: "thread",
  RichBlocks: "thread",
  richUi: "thread",
  markdown: "thread",
  markdownParse: "thread",
  messageBlocks: "thread",
  codeHighlight: "thread",
  codeHighlightAsync: "thread",
  parseCache: "thread",
  streamBuffer: "thread",
  VirtualList: "thread",
  Toast: "thread",

  // sections/ — the named sections, plus the status/provenance chip family.
  // ChatHomeName / ChatPackInventory are grouped with the other chatPack*
  // UI pieces (ChatPackStatus / ChatPackTurnChip) rather than surfaces/,
  // since all four are mid-level widgets rendered inside ChatView, not
  // standalone surfaces themselves — see report.
  PlanSection: "sections",
  ChildAgentsSection: "sections",
  HooksSection: "sections",
  McpServersSection: "sections",
  BrowserSection: "sections",
  RunTerminalNotice: "sections",
  ChatPackStatus: "sections",
  ChatPackTurnChip: "sections",
  CodeAgentStatus: "sections",
  CodeRunProvenanceChip: "sections",
  ProjectInstructionsStatus: "sections",
  ProjectInstructionsTurnChip: "sections",
  SkillArmedChip: "sections",
  SkillHandoffProvenanceChip: "sections",
  ChatHomeName: "sections",
  ChatPackInventory: "sections",

  // projections/ — the named projections, activity*, *Projection, *Composer,
  // artifact*, plus chatPackTurn / projectInstructionsTurn / codeRunProvenance
  // (the pure-logic siblings of the *Composer files, imported by RunSurface
  // and by the matching *Chip component — same family as *Composer, not
  // named individually in the brief's wildcard list but same shape).
  runReducer: "projections",
  runEventSchema: "projections",
  runChangeList: "projections",
  runVerifyList: "projections",
  runGitReviewList: "projections",
  runPlanSection: "projections",
  derivedLivePhase: "projections",
  catchUpWindows: "projections",
  activityLabel: "projections",
  activityMembership: "projections",
  activityRun: "projections",
  activityWriteLike: "projections",
  browserWorkProjection: "projections",
  childAgentsProjection: "projections",
  hooksProjection: "projections",
  mcpServersProjection: "projections",
  chatPackComposer: "projections",
  codeAgentComposer: "projections",
  projectInstructionsComposer: "projections",
  skillsCatalogComposer: "projections",
  planArm: "projections",
  artifactEligibility: "projections",
  artifactOpenBinding: "projections",
  stalePermissionDecision: "projections",
  trustedCommandProvenance: "projections",
  launchState: "projections",
  failureCard: "projections",
  diffUtil: "projections",
  toolFormat: "projections",
  vendorAnswerClean: "projections",
  chatPackTurn: "projections",
  projectInstructionsTurn: "projections",
  codeRunProvenance: "projections",

  // lib/ — the named lib pieces, desktop*, export*, plus hostSocket.resume
  // (tests the HostSocket class exported from api.ts, not a separate module).
  api: "lib",
  sessions: "lib",
  sessionIO: "lib",
  prefs: "lib",
  desktopBridge: "lib",
  desktopNotify: "lib",
  desktopUpdate: "lib",
  crashSink: "lib",
  csp: "lib",
  exportChat: "lib",
  exportDiagnostics: "lib",
  copyClipboard: "lib",
  copyDock: "lib",
  timeAgo: "lib",
  fonts: "lib",
  firstRun: "lib",
  inEditable: "lib",
  installerHonesty: "lib",
  healthPollTestClock: "lib",
  hostSocket: "lib",
};

// ---------------------------------------------------------------------------
// 2. Exact-filename overrides — compound feature-test files whose own name
//    is not a module base name, plus a few files with no test-suffix
//    grammar at all. Every entry here is a deliberate call recorded in
//    task-16-report.md, not a default.
// ---------------------------------------------------------------------------
const OVERRIDES = {
  // "*.app.test.tsx" / "*.integration.test.tsx" / the one "*.flow.test.tsx"
  // all mount the real `<App/>` (confirmed: every one of these imports
  // "./App" directly) -> app/, beside App.tsx.
  "acp-live-streams.app.test.tsx": "app",
  "gate-keyboard-trust.integration.test.tsx": "app",
  "git-review-surface.app.test.tsx": "app",
  "git-review-surface.integration.test.tsx": "app",
  "inspectable-run-changeset.app.test.tsx": "app",
  "live-turn-attention.app.test.tsx": "app",
  "live-turn-attention.integration.test.tsx": "app",
  "named-projects.app.test.tsx": "app",
  "named-projects.component.test.tsx": "app", // imports ./App despite ".component" suffix
  "pdf-extract.flow.test.tsx": "app",
  "plan-mode.app.test.tsx": "app",
  "project-instructions.app.test.tsx": "app",
  "project-instructions.component.test.tsx": "app", // imports ./App despite ".component" suffix
  "reliable-autonomous-runs.integration.test.tsx": "app",
  "structured-test-panel.app.test.tsx": "app",
  "trusted-command-classes.integration.test.tsx": "app",
  "trusted-deletes-renames.app.test.tsx": "app",
  "copyInvariants.test.tsx": "app", // dominant import is ./App
  "styles.css": "app", // sole importers are main.tsx and verifyGrokUi.tsx

  // "*.component.test.tsx" files that do NOT import ./App anchor on
  // ./RunSurface instead (confirmed: every one of these imports it) ->
  // surfaces/, beside RunSurface.tsx.
  "acp-live-streams.component.test.tsx": "surfaces",
  "chat.journeys.unit.test.tsx": "surfaces", // reads ./RunSurface.tsx by relative path
  "git-review-surface.component.test.tsx": "surfaces",
  "inspectable-run-changeset.component.test.tsx": "surfaces",
  "live-turn-attention.component.test.tsx": "surfaces",
  "plan-mode.component.test.tsx": "surfaces",
  "reliable-autonomous-runs.component.test.tsx": "surfaces",
  "trusted-command-classes.component.test.tsx": "surfaces",
  "trusted-deletes-renames.component.test.tsx": "surfaces",

  // Cross-cutting "journeys" test with no App import and no single
  // component anchor; imports ActionDock/ChangesDock (dock/) for 4 of its
  // 6 journeys (J1/J2/J3/J4), ComposerPane/atFileQuery/expandMentions
  // (composer/) for the other 2 (J5/J6) -> dock/ by majority, a judgment
  // call recorded in the report.
  "journeys.unit.test.tsx": "dock",

  // Pure projection/reducer logic tests, no component imports at all.
  "acp-live-streams.phase.test.ts": "projections",
  "acp-live-streams.projection.test.ts": "projections",
  "live-turn-attention.projection.test.ts": "projections",

  // Packaging/repo-infra checks, no relation to any UI domain.
  "dev-package-isolation.test.ts": "lib", // apps/shell/src-tauri config isolation
  "dogfood-probes.test.ts": "lib", // repo-wide script/package consistency
  "vite-env.d.ts": "lib", // ambient env types, no direct references anywhere

  // Their entire subject is a file already inside a "keeps its contents"
  // directory (styles/*.css or ui/Button.tsx) -- see report for why this
  // is read as an addition, not a violation, of "keep their contents".
  "codeHighlight.lightCss.test.ts": "styles",
  "motion.test.ts": "styles",
  "run.quiet-chrome.test.ts": "styles",
  "styles.amberException.test.ts": "styles",
  "styles.lightThemeTokens.test.ts": "styles",
  "styles.tokens.test.ts": "styles",
  "buttonVariants.vitest.ts": "ui",
};

// Files that deliberately do NOT move — see task-16-report.md.
// testEnv.ts: named literally (not by glob) in knip.json's entry list and in
// apps/shell/package.json's test/test:coverage scripts, and its exact path
// `./src/testEnv.ts` is hardcoded in `.superpowers/sdd/structure/AGENT-PREAMBLE.md`
// as the standard single-file test invocation for this whole task series.
// testEnv.domAssert.test.tsx is its test and stays beside it.
const ROOT_STAYS = new Set(["testEnv.ts", "testEnv.domAssert.test.tsx"]);

const NEW_DIRS = [
  "app",
  "surfaces",
  "chrome",
  "dock",
  "composer",
  "thread",
  "sections",
  "projections",
  "lib",
];
const KEPT_DIRS = ["state", "styles", "ui", "test-support"];

function stripToBaseName(filename) {
  // "App.ac12g.test.tsx" -> "App"; "Sidebar.chatHomes.test.tsx" -> "Sidebar";
  // "richUi.yakiniku-dump.test.ts" -> "richUi"; "OverviewStrip.test.ts" -> "OverviewStrip".
  const noExt = filename.replace(/\.(tsx|ts)$/, "");
  const firstDot = noExt.indexOf(".");
  return firstDot === -1 ? noExt : noExt.slice(0, firstDot);
}

function buildManifest() {
  const entries = readdirSync(SRC).filter((f) => statSync(join(SRC, f)).isFile());
  const manifest = [];
  const unclassified = [];

  for (const filename of entries) {
    if (ROOT_STAYS.has(filename)) continue; // deliberate no-op, not a move

    let targetDir = null;
    if (Object.prototype.hasOwnProperty.call(OVERRIDES, filename)) {
      targetDir = OVERRIDES[filename];
    } else {
      const base = stripToBaseName(filename);
      targetDir = BASE_TO_DIR[base] ?? null;
    }

    if (!targetDir) {
      unclassified.push(filename);
      continue;
    }

    manifest.push({
      from: `src/${filename}`,
      to: `src/${targetDir}/${filename}`,
    });
  }

  return { manifest, unclassified, totalRealFiles: entries.length };
}

function main() {
  const { manifest, unclassified, totalRealFiles } = buildManifest();

  if (unclassified.length > 0) {
    console.error(`UNCLASSIFIED (${unclassified.length}) — fix BASE_TO_DIR/OVERRIDES before moving anything:`);
    for (const f of unclassified) console.error(`  ${f}`);
    process.exitCode = 1;
    return;
  }

  const byDir = {};
  for (const { to } of manifest) {
    const dir = to.split("/")[1];
    byDir[dir] = (byDir[dir] ?? 0) + 1;
  }

  console.log(`Real files directly under src/: ${totalRealFiles}`);
  console.log(`Staying in place (ROOT_STAYS): ${ROOT_STAYS.size}`);
  console.log(`Planned moves: ${manifest.length}`);
  console.log(`(${totalRealFiles} = ${manifest.length} moved + ${ROOT_STAYS.size} stayed — should match)`);
  console.log("");
  console.log("Counts per destination:");
  for (const dir of [...NEW_DIRS, ...KEPT_DIRS]) {
    if (byDir[dir]) console.log(`  ${dir.padEnd(14)} ${byDir[dir]}`);
  }
  console.log("");

  const doMove = process.argv.includes("--move");
  if (!doMove) {
    console.log("Dry run only (pass --move to actually git mv). Full manifest:");
    for (const { from, to } of manifest) console.log(`  ${from}  ->  ${to}`);
    return;
  }

  const REPO_ROOT = join(SHELL_ROOT, "..", ".."); // apps/shell -> apps -> repo root
  for (const { from, to } of manifest) {
    const fromRepoRel = `apps/shell/${from}`;
    const toRepoRel = `apps/shell/${to}`;
    console.log(`git mv ${fromRepoRel} ${toRepoRel}`);
    execFileSync("git", ["mv", "--", fromRepoRel, toRepoRel], {
      cwd: REPO_ROOT,
      stdio: "inherit",
    });
  }
  console.log(`\nMoved ${manifest.length} files.`);
}

main();
