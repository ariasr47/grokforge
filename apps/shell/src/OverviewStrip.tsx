export interface RunOverview {
  tools: number;
  toolFails: number;
  filesTouched: string[];
  lastError: string | null;
  userTurns: number;
}
import type { CodeAgentFact, ShellCapabilityView } from "./api";

interface Props {
  overview: RunOverview;
  workspaceName: string | null;
  /** Chat must never be labelled a Code "workspace" (SPEC §4). */
  mode?: "chat" | "code";
  shellCapability?: ShellCapabilityView;
  /** Vendor grok agent runs its own shell — not Forge cmd.exe. */
  codeAgentIdentity?: CodeAgentFact["identity"];
  onJumpToFiles?: () => void;
  onJumpToTools?: () => void;
}

/** Prefer the compact header so nearest-jump does not fill the viewport with rows. */
export function pickToolsJumpEl(root: ParentNode = document): HTMLElement | null {
  return (
    root.querySelector<HTMLElement>(".tool-activity-head") ??
    root.querySelector<HTMLElement>("[data-tool-activity]") ??
    root.querySelector<HTMLElement>(".activity-output")
  );
}

/** TOOLS/FILES jump landed under the sticky You card. */
export function jumpLandedUnderYou(g: { targetTop: number; youBottom: number }): boolean {
  return g.targetTop + 1 < g.youBottom;
}

/** TOOLS jump landed under the sticky You card — align to start (scroll-margin). */
export function toolsJumpNeedsStart(g: { toolsTop: number; youBottom: number }): boolean {
  return jumpLandedUnderYou({ targetTop: g.toolsTop, youBottom: g.youBottom });
}

/** FILES jump landed under the sticky You card — nudge below You. */
export function filesJumpNeedsStart(g: {
  filesTop: number;
  youBottom: number;
  thoughtTop?: number | null;
  thoughtBottom?: number | null;
}): boolean {
  if (g.thoughtTop != null && g.thoughtTop + 1 < g.youBottom) return true;
  const floor = Math.max(g.youBottom, g.thoughtBottom ?? 0);
  return jumpLandedUnderYou({ targetTop: g.filesTop, youBottom: floor });
}

/** Scroll delta so a section's top sits just below the sticky You card. */
export function scrollDeltaBelowYou(g: {
  targetTop: number;
  youBottom: number;
  gap?: number;
  thoughtTop?: number | null;
  thoughtBottom?: number | null;
}): number {
  const gap = g.gap ?? 8;
  const floor = Math.max(g.youBottom, g.thoughtBottom ?? 0) + gap;
  const targetDelta = g.targetTop - floor;
  if (g.thoughtTop == null || g.thoughtTop + 1 >= g.youBottom) return targetDelta;
  return Math.min(targetDelta, g.thoughtTop - (g.youBottom + gap));
}

/** After View diff: never jump the transcript to the end (that tucks File changes
 *  beside compact Thought). Nudge the card below You/Thought even when near the end. */
export function transcriptScrollAfterOpenFileDiff(g: {
  nearEnd: boolean;
  fileTop: number;
  youBottom: number;
  thoughtBottom?: number | null;
  thoughtTop?: number | null;
  gap?: number;
}): number {
  void g.nearEnd;
  return scrollDeltaBelowYou({
    targetTop: g.fileTop,
    youBottom: g.youBottom,
    thoughtTop: g.thoughtTop,
    thoughtBottom: g.thoughtBottom,
    gap: g.gap,
  });
}

/** Transcript nudge after sticky You grows over File changes / tools / Thought.
 *  Highest dock under You is scrolled just below the card. */
export function scrollDeltaToClearStickyYou(g: {
  youBottom: number;
  tops: Array<number | null | undefined>;
  gap?: number;
}): number {
  const tops = g.tops.filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  if (!tops.length) return 0;
  const highest = Math.min(...tops);
  if (highest + 1 >= g.youBottom) return 0;
  return highest - (g.youBottom + (g.gap ?? 8));
}

/** Shrink expanded You so Your turn stays above the composer. */
export function youHeightToKeepCueVisible(g: {
  youHeight: number;
  cueBottom: number;
  composerTop: number;
  minYouHeight?: number;
  gap?: number;
}): number {
  const minH = g.minYouHeight ?? 81;
  if (!Number.isFinite(g.youHeight) || g.youHeight <= 0) return minH;
  const over = g.cueBottom + (g.gap ?? 8) - g.composerTop;
  if (over <= 0) return g.youHeight;
  return Math.max(minH, Math.round(g.youHeight - over));
}

/** After expand clamp, scroll Your turn above the composer if File changes still clears You. */
export function scrollDeltaToKeepCueAboveComposer(g: {
  cueBottom: number;
  composerTop: number;
  youBottom: number;
  filesTop?: number | null;
  gap?: number;
}): number {
  const gap = g.gap ?? 8;
  const over = g.cueBottom + gap - g.composerTop;
  if (over <= 0) return 0;
  if (g.filesTop == null || !Number.isFinite(g.filesTop)) return Math.round(over);
  const maxUp = g.filesTop - (g.youBottom + gap);
  if (maxUp <= 0) return 0;
  return Math.round(Math.min(over, maxUp));
}

/** After TOOLS nearest-jump, keep Your turn above the composer when tools still fit. */
export function shouldKeepEndAfterToolsJump(g: {
  toolsTop: number;
  toolsBottom: number;
  transcriptTop: number;
  composerTop: number;
  cueBottom: number;
  hiddenBelow: number;
  fileHeadTop?: number | null;
  youBottom?: number | null;
  thoughtBottom?: number | null;
}): boolean {
  if (g.cueBottom <= g.composerTop) return false;
  const top = g.toolsTop - g.hiddenBelow;
  const bottom = g.toolsBottom - g.hiddenBelow;
  if (!(top >= g.transcriptTop && bottom <= g.composerTop)) return false;
  if (g.fileHeadTop != null && Number.isFinite(g.fileHeadTop)) {
    const floor = Math.max(g.youBottom ?? 0, g.thoughtBottom ?? 0);
    if (g.fileHeadTop - g.hiddenBelow + 1 < floor) return false;
  }
  return true;
}

/** Host cmd.exe is grok-acp only. Vendor Windows grok uses PowerShell (live Set-Location). */
export function overviewShellCaption(
  cap: ShellCapabilityView,
  codeAgentIdentity?: CodeAgentFact["identity"],
): { text: string; title: string; unavailable: boolean } | null {
  if (cap.status === "unavailable") {
    return {
      text: "Shell unavailable. Structured repository tools are still available.",
      title: cap.reason,
      unavailable: true,
    };
  }
  if (cap.status !== "available") return null;
  if (codeAgentIdentity === "vendor" && cap.osFamily === "windows") {
    return {
      text: "PowerShell",
      title: "Vendor grok agent shell — not Forge Command Prompt",
      unavailable: false,
    };
  }
  return { text: cap.displayName, title: cap.executable, unavailable: false };
}

export function OverviewStrip({ overview, workspaceName, mode = "code", shellCapability, codeAgentIdentity, onJumpToFiles, onJumpToTools }: Props) {
  if (!workspaceName) return null;
  const shell = shellCapability ? overviewShellCaption(shellCapability, codeAgentIdentity) : null;
  return (
    <div className="overview-strip" role="status" aria-label="Run overview">
      <span className="ov-item">
        <em>{mode === "chat" ? "files" : "ws"}</em> {workspaceName}
      </span>
      {shell ? (
        <span className={`ov-item${shell.unavailable ? " ov-err" : ""}`} title={shell.title}>
          <em>shell</em> {shell.text}
        </span>
      ) : null}
      <span className="ov-item">
        <em>turns</em> {overview.userTurns}
      </span>
      {overview.tools > 0 && onJumpToTools ? (
        <button
          type="button"
          className="ov-item ov-files"
          onClick={onJumpToTools}
        >
          <em>tools</em> {overview.tools}
          {overview.toolFails > 0 ? (
            <span className="ov-fail"> · {overview.toolFails} fail</span>
          ) : null}
        </button>
      ) : (
        <span className="ov-item">
          <em>tools</em> {overview.tools}
          {overview.toolFails > 0 ? (
            <span className="ov-fail"> · {overview.toolFails} fail</span>
          ) : null}
        </span>
      )}
      {overview.filesTouched.length > 0 && onJumpToFiles ? (
        <button
          type="button"
          className="ov-item ov-files"
          title={overview.filesTouched.join(", ")}
          onClick={onJumpToFiles}
        >
          <em>files</em>{" "}
          {overview.filesTouched
            .slice(0, 3)
            .map((f) => f.split(/[/\\]/).pop())
            .join(", ") +
            (overview.filesTouched.length > 3
              ? ` +${overview.filesTouched.length - 3}`
              : "")}
        </button>
      ) : (
        <span className="ov-item" title={overview.filesTouched.join(", ") || "none"}>
          <em>files</em>{" "}
          {overview.filesTouched.length
            ? overview.filesTouched
                .slice(0, 3)
                .map((f) => f.split(/[/\\]/).pop())
                .join(", ") +
              (overview.filesTouched.length > 3
                ? ` +${overview.filesTouched.length - 3}`
                : "")
            : "—"}
        </span>
      )}
      {overview.lastError && (
        <span className="ov-item ov-err" title={overview.lastError}>
          <em>err</em> {overview.lastError.slice(0, 48)}
          {overview.lastError.length > 48 ? "…" : ""}
        </span>
      )}
    </div>
  );
}

export function computeOverview(
  messages: Array<{
    role: string;
    content: string;
    toolMeta?: { ok?: boolean; name?: string };
  }>,
  diffPaths: string[],
  runTools?: { count: number; fails: number },
): RunOverview {
  let tools = 0;
  let toolFails = 0;
  let lastError: string | null = null;
  let userTurns = 0;
  const files = new Set<string>(diffPaths);

  for (const m of messages) {
    if (m.role === "user") userTurns += 1;
    if (m.role === "tool") {
      tools += 1;
      if (m.toolMeta?.ok === false) toolFails += 1;
    }
    if (m.role === "system" && m.content.startsWith("Error")) {
      lastError = m.content.replace(/^Error\s*(\([^)]*\))?:\s*/, "");
    }
    if (m.role === "system" && m.content.startsWith("Diff ")) {
      const path = m.content.replace(/^Diff \w+:\s*/, "").trim();
      if (path) files.add(path);
    }
  }

  if (runTools && runTools.count > 0) {
    tools = runTools.count;
    toolFails = runTools.fails;
  }

  return {
    tools,
    toolFails,
    filesTouched: [...files],
    lastError,
    userTurns,
  };
}
