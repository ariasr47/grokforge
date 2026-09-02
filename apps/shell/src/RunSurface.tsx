import React from "react";
void React;
import type { ActivityRecord, RunProjectionRun } from "./runReducer";
import { RunTerminalNotice } from "./RunTerminalNotice";
import { api, type BrowserWorkMembershipFact, type ChildAgentsMembershipFact, type CodeAgentFact, type HooksMembershipFact, type McpServersMembershipFact, type ProductMode } from "./api";
import { ChildAgentsSection } from "./ChildAgentsSection";
import { projectChildAgents } from "./childAgentsProjection";
import { BrowserSection } from "./BrowserSection";
import { projectBrowserWork } from "./browserWorkProjection";
import { McpServersSection } from "./McpServersSection";
import { projectMcpServers } from "./mcpServersProjection";
import { HooksSection } from "./HooksSection";
import { projectHooks } from "./hooksProjection";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { writeClipboard } from "./copyClipboard";
import { scrollDeltaToClearStickyYou, scrollDeltaToKeepCueAboveComposer, transcriptScrollAfterOpenFileDiff, youHeightToKeepCueVisible } from "./OverviewStrip";
import { isListAutoExecuted } from "./trustedCommandProvenance";
import { changeListCoversActivity, projectRunChangeList, type CatchUpSignal, type RunChangeMember } from "./runChangeList";
import { FileChangesSection } from "./FileChangesSection";
import { projectRunVerifyList } from "./runVerifyList";
import { VerifySection } from "./VerifySection";
import { projectRunGitReviewList } from "./runGitReviewList";
import { GitReviewSection } from "./GitReviewSection";
import { projectRunPlanSection } from "./runPlanSection";
import { PlanSection } from "./PlanSection";
import { projectProjectInstructionsTurn } from "./projectInstructionsTurn";
import { ProjectInstructionsTurnChip } from "./ProjectInstructionsTurnChip";
import { projectChatPackTurn } from "./chatPackTurn";
import { ChatPackTurnChip } from "./ChatPackTurnChip";
import { codeRunProvenanceCopy, projectCodeRunProvenance } from "./codeRunProvenance";
import { CodeRunProvenanceChip } from "./CodeRunProvenanceChip";
import { SkillHandoffProvenanceChip } from "./SkillHandoffProvenanceChip";
import { MarkdownBody } from "./markdown";
import { Button } from "./ui/Button";
import { elevateArtifact } from "./artifactEligibility";
import { SETTLE_IN_DOCK } from "./copyDock";
import { Receipts } from "./Receipts";
import type { ChatMessage } from "./messageBlocks";
import { formatToolInput, formatToolOutput } from "./toolFormat";
import { cleanVendorAnswer } from "./vendorAnswerClean";
import { activityIsVendorSessionPlan, activityLooksLikeWrite } from "./activityWriteLike";
import { splitUserPromptMentions, visibleUserPrompt } from "./expandMentions";

function activityToToolMessage(activity: ActivityRecord): ChatMessage {
  const body = activity.error
    || (activity.output != null
      ? formatToolOutput(activity.output)
      : activity.input != null
        ? formatToolInput(activity.input)
        : "");
  return {
    id: activity.activityId,
    role: "tool",
    content: body,
    activityIdentity: activity.activityId,
    toolMeta: {
      activityId: activity.activityId,
      toolCallId: activity.invocationId,
      name: activity.name,
      title: (activity.kind || activity.editId ? activity.path : null) ?? activity.title ?? null,
      summary: (activity.kind || activity.editId ? activity.path : null) ?? activity.summary ?? activity.command ?? undefined,
      ok: activity.execution === "executed" ? activity.status === "succeeded" : undefined,
      done: activity.lifecycle === "terminal",
      lifecycle: activity.lifecycle,
      execution: activity.execution,
      status: activity.status,
      command: activity.command,
      // Passed through verbatim so receiptVerb can read them — never derived/invented here.
      input: activity.input,
      output: activity.output,
      error: activity.error,
      diff: activity.diff,
      path: activity.path,
      kind: activity.kind ?? null,
      fromPath: activity.fromPath ?? null,
      toPath: activity.toPath ?? null,
      automaticEligibility: activity.automaticEligibility,
      autoApplied: activity.autoApplied,
    },
  };
}

const LIST_AUTO_CHIP = "Ran without asking · Trusted command class";
const LIST_AUTO_TOOLTIP = "Matched a saved class for this workspace. The process is not sandboxed.";

function ActivityProvenance({ activity, hideCommand = false }: { activity: ActivityRecord; hideCommand?: boolean }) {
  // Policy line is omitted when File changes already owns the write.
  const command = hideCommand ? null : activity.command;
  const listAuto = isListAutoExecuted(activity);
  const trustedSuffix = !listAuto && Boolean(activity.autoApplied);
  const showPolicy = !hideCommand || trustedSuffix || listAuto;
  return (
    <>
      {command ? <p className="activity-command"><code>{command}</code></p> : null}
      {showPolicy ? (
        <p>
          Policy: {activity.policy?.effectiveMode ? String(activity.policy.effectiveMode) : "unspecified"}
          {trustedSuffix ? " · Applied automatically · Trusted workspace" : ""}
        </p>
      ) : null}
      {listAuto ? (
        <p>
          <span className="chip" title={LIST_AUTO_TOOLTIP}>{LIST_AUTO_CHIP}</span>
        </p>
      ) : null}
    </>
  );
}
export interface RunSurfaceProps {
  run: RunProjectionRun;
  catchUp?: CatchUpSignal;
  offline?: boolean;
  productMode?: ProductMode | string | null;
  codeAgent?: CodeAgentFact | null;
  childAgents?: ChildAgentsMembershipFact | null;
  browserWork?: BrowserWorkMembershipFact | null;
  mcpServers?: McpServersMembershipFact | null;
  hooks?: HooksMembershipFact | null;
  /** ACP-parent-global observe facts may paint only on the live owned parent that produced them. */
  hostRosterEligible?: boolean;
  ownershipLost?: boolean;
  onRetryPrompt?: (prompt: string) => void;
  onReconnect?: () => void;
  onOpenSettings?: () => void;
  onExportDiagnostics?: () => void;
  onFocusDiffRequest?: (requestId: string) => void;
  onChoose?: (label: string, meta?: string) => void;
  artifactOpen?: boolean;
  onOpenArtifact?: (runId: string) => void;
}
const OPEN_TOOLTIP =
  "Show this turn’s document beside the transcript. Closing hides the panel without deleting the turn.";

/** Collapse markdown ticks and whitespace so live vendor copies still match. */
function foldKey(s: string): string {
  return s.replace(/`/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Hide yielded Earlier when the vouched answer already contains that narration
 * (including exact copies). Unique mid-turn paragraphs stay visible.
 */
export function midturnFoldedIntoAnswer(
  midturn: string,
  answer: string | null | undefined,
  vouched: boolean,
): boolean {
  if (!vouched || !answer) return false;
  const mid = foldKey(midturn);
  const ans = foldKey(answer);
  if (!mid) return false;
  if (ans.includes(mid)) return true;
  const paras = midturn
    .trim()
    .split(/\n\s*\n/)
    .map((p) => foldKey(p))
    .filter(Boolean);
  return paras.length > 0 && paras.every((p) => ans.includes(p));
}

/** Sticky Thought offset: measured You height plus the run-content gap. */
export function runPromptStickBelowPx(promptHeight: number): number {
  if (!Number.isFinite(promptHeight) || promptHeight <= 0) return 88;
  return Math.round(promptHeight) + 12;
}

/** File changes stick-below: You, plus collapsed Thought so FILES jump does not cover it. */
export function runFileStickBelowPx(promptHeight: number, collapsedThoughtHeight: number): number {
  const you = runPromptStickBelowPx(promptHeight);
  if (!Number.isFinite(collapsedThoughtHeight) || collapsedThoughtHeight <= 0) return you;
  return you + Math.round(collapsedThoughtHeight) + 12;
}

/** Collapsed Thought box height. Uses the details `.open` property — `:not([open])` misses
 *  a closed details that still carries the attribute, and then File changes sticks under Thought. */
export function collapsedThoughtHeightPx(thought: HTMLElement | null): number {
  if (!thought) return 0;
  const open = thought instanceof HTMLDetailsElement ? thought.open : thought.hasAttribute("open");
  if (open) return 0;
  const h = thought.getBoundingClientRect().height;
  return Number.isFinite(h) && h > 0 ? Math.round(h) : 0;
}

/** Latch Show more so a later tighter measure cannot drop it (WebView2
 *  scrollHeight/clientHeight can oscillate when the button itself appears). */
export function nextPromptOverflow(prev: boolean, measured: boolean, promptChanged: boolean): boolean {
  if (promptChanged) return measured;
  return prev || measured;
}

/** Thought disclosure: user click wins; terminal closes; live reasoning must
 *  not force-open (controlled `open` + `onToggle` ping-pongs on WebView2). */
export function nextThoughtOpen(
  prev: boolean,
  input: { runState: string; toggleTo?: boolean },
): boolean {
  if (input.toggleTo !== undefined) return input.toggleTo;
  if (input.runState === "terminal") return false;
  return prev;
}

export function promptBodyMeasuresOverflow(input: {
  scrollHeight: number;
  clientHeight: number;
  text: string;
}): boolean {
  return (
    input.scrollHeight > input.clientHeight + 1 ||
    (input.text.match(/\n/g)?.length ?? 0) >= 2 ||
    input.text.length > 180
  );
}

export const RunSurface = memo(function RunSurface({ run, catchUp = { phase: "closed" }, offline = false, productMode, codeAgent = null, childAgents = null, browserWork = null, mcpServers = null, hooks = null, hostRosterEligible = true, ownershipLost = false, onRetryPrompt, onReconnect, onOpenSettings, onExportDiagnostics, onFocusDiffRequest, onChoose, artifactOpen = false, onOpenArtifact }: RunSurfaceProps) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openDiff, setOpenDiff] = useState<string | null>(null);
  const [openChangeDiff, setOpenChangeDiff] = useState<string | null>(null);
  const nearTranscriptEndRef = useRef(true);
  useEffect(() => {
    const el = document.querySelector<HTMLElement>(".transcript");
    if (!el) return;
    const onScroll = () => {
      nearTranscriptEndRef.current =
        el.scrollHeight - el.scrollTop - el.clientHeight < 96;
    };
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);
  useLayoutEffect(() => {
    if (!openChangeDiff) return;
    const transcript = document.querySelector<HTMLElement>(".transcript");
    const files = document.querySelector<HTMLElement>(".file-changes");
    const you = document.querySelector<HTMLElement>(".run-prompt");
    if (!transcript || !files || !you) return;
    const thought = document.querySelector<HTMLElement>(".run-thought");
    const thoughtOpen =
      thought instanceof HTMLDetailsElement
        ? thought.open
        : Boolean(thought?.hasAttribute("open"));
    const thoughtR = !thoughtOpen ? thought?.getBoundingClientRect() : undefined;
    const delta = transcriptScrollAfterOpenFileDiff({
      nearEnd: nearTranscriptEndRef.current,
      fileTop: files.getBoundingClientRect().top,
      youBottom: you.getBoundingClientRect().bottom,
      thoughtTop: thoughtR?.top ?? null,
      thoughtBottom: thoughtR?.bottom ?? null,
    });
    if (delta) transcript.scrollTop += delta;
  }, [openChangeDiff]);
  const [recoveryResult, setRecoveryResult] = useState<Record<string, "reverted" | "conflict">>({});
  const [focusActivityId, setFocusActivityId] = useState<string | null>(null);
  const [thoughtOpen, setThoughtOpen] = useState(() => run.state !== "terminal");
  const youPrompt = visibleUserPrompt(run.acceptedPrompt);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [promptOverflows, setPromptOverflows] = useState(false);
  const promptOverflowTextRef = useRef(youPrompt);
  const promptRef = useRef<HTMLDivElement>(null);
  const promptBodyRef = useRef<HTMLSpanElement>(null);
  const runRootRef = useRef<HTMLElement>(null);
  useEffect(() => {
    setPromptExpanded(false);
    setThoughtOpen(run.state !== "terminal");
  }, [run.runId]);
  useLayoutEffect(() => {
    const prompt = promptRef.current;
    const root = runRootRef.current;
    if (!prompt || !root) return;
    const apply = () => {
      const promptH = prompt.getBoundingClientRect().height;
      const youPx = `${runPromptStickBelowPx(promptH)}px`;
      const thoughtH = collapsedThoughtHeightPx(root.querySelector<HTMLElement>(".run-thought"));
      const filePx = `${runFileStickBelowPx(promptH, thoughtH)}px`;
      const transcript = document.querySelector<HTMLElement>(".transcript");
      if (root.style.getPropertyValue("--run-prompt-stick-below") !== youPx) {
        root.style.setProperty("--run-prompt-stick-below", youPx);
        transcript?.style.setProperty("--run-prompt-stick-below", youPx);
      }
      if (root.style.getPropertyValue("--run-file-stick-below") !== filePx) {
        root.style.setProperty("--run-file-stick-below", filePx);
      }
    };
    const ro = new ResizeObserver(apply);
    ro.observe(prompt);
    const thought = root.querySelector(".run-thought");
    if (thought) ro.observe(thought);
    apply();
    return () => ro.disconnect();
  }, [run.acceptedPrompt, thoughtOpen, promptExpanded, openChangeDiff]);
  useLayoutEffect(() => {
    const prompt = promptRef.current;
    if (!prompt) return;
    if (!promptExpanded) {
      prompt.style.removeProperty("max-height");
      return;
    }
    const root = runRootRef.current;
    const transcript = document.querySelector<HTMLElement>(".transcript");
    const composer = document.querySelector<HTMLElement>(".composer-wrap");
    const cue = document.querySelector<HTMLElement>(".turn-delimiter");
    if (!root || !transcript) return;
    const nudge = () => {
      const files = root.querySelector<HTMLElement>(".file-changes");
      const tools = root.querySelector<HTMLElement>(".rhead");
      const thought = root.querySelector<HTMLElement>(".run-thought:not([open])");
      const delta = scrollDeltaToClearStickyYou({
        youBottom: prompt.getBoundingClientRect().bottom,
        tops: [
          thought?.getBoundingClientRect().top,
          files?.getBoundingClientRect().top,
          tools?.getBoundingClientRect().top,
        ],
      });
      if (delta) transcript.scrollTop += delta;
    };
    // Clear docks first — cue often still fits before that scroll, then sits under the composer.
    nudge();
    if (cue && composer) {
      const youHeight = prompt.getBoundingClientRect().height;
      const nextH = youHeightToKeepCueVisible({
        youHeight,
        cueBottom: cue.getBoundingClientRect().bottom,
        composerTop: composer.getBoundingClientRect().top,
        gap: 40,
      });
      if (nextH < youHeight - 1) prompt.style.maxHeight = `${nextH}px`;
      const files = root.querySelector<HTMLElement>(".file-changes");
      const keep = scrollDeltaToKeepCueAboveComposer({
        cueBottom: cue.getBoundingClientRect().bottom,
        composerTop: composer.getBoundingClientRect().top,
        youBottom: prompt.getBoundingClientRect().bottom,
        filesTop: files?.getBoundingClientRect().top,
      });
      if (keep) transcript.scrollTop += keep;
    }
  }, [promptExpanded]);
  const textOverflows = promptBodyMeasuresOverflow({
    scrollHeight: 0,
    clientHeight: 0,
    text: youPrompt,
  });
  useLayoutEffect(() => {
    const el = promptBodyRef.current;
    if (!el) return;
    const promptChanged = promptOverflowTextRef.current !== youPrompt;
    promptOverflowTextRef.current = youPrompt;
    // Long You text already overflows; skip WebView2 scrollHeight measure
    // (Show more appearing tightens clientHeight and nested-updates).
    if (textOverflows) {
      setPromptOverflows((prev) => (promptChanged || !prev ? true : prev));
      return;
    }
    const measure = (changed: boolean) => {
      if (el.closest(".run-prompt")?.classList.contains("is-expanded")) return;
      const measured = promptBodyMeasuresOverflow({
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        text: el.textContent || "",
      });
      setPromptOverflows((prev) => {
        const next = nextPromptOverflow(prev, measured, changed);
        return next === prev ? prev : next;
      });
    };
    measure(promptChanged);
    const ro = new ResizeObserver(() => measure(false));
    ro.observe(el);
    return () => ro.disconnect();
  }, [youPrompt, promptExpanded, textOverflows]);
  useEffect(() => {
    setThoughtOpen((open) => nextThoughtOpen(open, { runState: run.state }));
  }, [run.state]);
  useEffect(() => {
    if (!pending) return;
    const decision = run.decisions[pending];
    const activity = Object.values(run.activities).find(a => a.editId === pending);
    if (decision && decision.status !== "pending") setPending(null);
    else if (activity && activity.recovery && activity.recovery.status !== "available") setPending(null);
  }, [pending, run.decisions, run.activities]);
  async function submitDecision(d: RunProjectionRun["decisions"][string], decision: "allow_once" | "deny") {
    setPending(d.requestId); setError(null);
    try {
      if (d.kind === "diff") {
        const activity = Object.values(run.activities).find(a => a.invocationId === d.invocationId);
        if (!activity?.editId) throw new Error("Edit details unavailable");
        await api.runDiff({ sessionId: run.sessionId, runId: run.runId, requestId: d.requestId, invocationId: d.invocationId, editId: activity.editId, action: decision === "allow_once" ? "accept" : "reject" });
      } else if (d.kind === "recovery_confirmation") {
        const activity = Object.values(run.activities).find(a => a.invocationId === d.invocationId);
        if (!activity?.editId) throw new Error("Recovery details unavailable");
        await api.editRecovery({ sessionId: run.sessionId, runId: run.runId, editId: activity.editId });
      } else {
        await api.runPermission({ sessionId: run.sessionId, runId: run.runId, requestId: d.requestId, invocationId: d.invocationId, decision });
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Decision failed"); setPending(null); }
    // Keep the control disabled until the authoritative WS event changes the
    // pending decision; clearing here permits a second click race.
  }
  async function recover(activity: RunProjectionRun["activities"][string]) {
    if (!activity.editId) return;
    setPending(activity.editId); setError(null);
    try {
      await api.editRecovery({ sessionId: run.sessionId, runId: run.runId, editId: activity.editId });
      setRecoveryResult((prev) => ({
        ...prev,
        [activity.activityId]: "reverted",
        ...(activity.editId ? { [activity.editId]: "reverted" } : {}),
      }));
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "recovery_conflict") {
        setRecoveryResult((prev) => ({
          ...prev,
          [activity.activityId]: "conflict",
          ...(activity.editId ? { [activity.editId]: "conflict" } : {}),
        }));
      }
      else setError(e instanceof Error ? e.message : "Recovery failed");
    } finally { setPending(null); }
  }
  async function recoverByMember(member: RunChangeMember) {
    const activity = run.activities[member.activityId]
      ?? Object.values(run.activities).find((a) => a.editId === member.editId);
    if (activity) await recover(activity);
  }
  const changeList = projectRunChangeList(run, catchUp);
  const verifyList = projectRunVerifyList(run, catchUp);
  const gitReviewList = projectRunGitReviewList(run, catchUp);
  const activityStatusById = new Map(
    Object.values(run.activities).map((a) => [a.activityId, a.status] as const),
  );
  const activityLifecycleById = new Map(
    Object.values(run.activities).map((a) => [a.activityId, a.lifecycle] as const),
  );
  const planSection = projectRunPlanSection(run, catchUp, { connected: !offline });
  const projectInstructionsTurn = projectProjectInstructionsTurn(run, catchUp, { mode: productMode });
  const chatPackTurn = projectChatPackTurn(run, catchUp, { mode: productMode });
  const journalMembers = Object.values(run.childAgents ?? {}).sort((a, b) => a.firstEventSeq - b.firstEventSeq);
  const childProjection = projectChildAgents({
    mode: productMode,
    codeAgent,
    childAgents,
    journalMembers,
    connected: !offline,
    parentTerminal: run.state === "terminal",
    ownershipLost,
    runNonTerminal: run.state !== "terminal",
    hostRosterEligible,
  });
  const browserProjection = projectBrowserWork({
    mode: productMode,
    codeAgent,
    browserWork,
    connected: !offline,
    parentTerminal: run.state === "terminal",
    ownershipLost,
    runNonTerminal: run.state !== "terminal",
    hostRosterEligible,
  });
  const mcpProjection = projectMcpServers({
    mode: productMode,
    codeAgent,
    mcpServers,
    connected: !offline,
    parentTerminal: run.state === "terminal",
    ownershipLost,
    runNonTerminal: run.state !== "terminal",
    hostRosterEligible,
  });
  const hooksProjection = projectHooks({
    mode: productMode,
    codeAgent,
    hooks,
    connected: !offline,
    parentTerminal: run.state === "terminal",
    ownershipLost,
    runNonTerminal: run.state !== "terminal",
    hostRosterEligible,
  });
  const reasoning = Object.values(run.reasoning).join("");
  const midturn = Object.values(run.message ?? {}).join("");
  const answer = run.finalAnswer;
  const vouchedAnswer = Boolean(run.terminalKind === "answered" && run.answerVouched && answer?.trim());
  const [copied, setCopied] = useState(false);
  const [copyErr, setCopyErr] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );
  const onCopyAnswer = useCallback(() => {
    const text = answer ? cleanVendorAnswer(answer) : "";
    if (!text.trim()) return;
    void writeClipboard(text)
      .then(() => {
        setCopied(true);
        setCopyErr(false);
        if (copyTimer.current) clearTimeout(copyTimer.current);
        copyTimer.current = setTimeout(() => setCopied(false), 1200);
      })
      .catch(() => {
        setCopyErr(true);
        if (copyTimer.current) clearTimeout(copyTimer.current);
        copyTimer.current = setTimeout(() => setCopyErr(false), 1500);
      });
  }, [answer]);
  const elevate = useMemo(
    () => (vouchedAnswer && answer ? elevateArtifact(answer) : { kind: "none" as const, body: null }),
    [vouchedAnswer, answer],
  );
  const answerElevatable = elevate.kind !== "none";
  const openTitle =
    elevate.kind === "long-markdown" || (answer?.length ?? 0) >= 1500
      ? "Open in panel"
      : OPEN_TOOLTIP;
  const thoughtStreaming = run.state !== "terminal";
  const toolMessages = useMemo(
    () => Object.values(run.activities).map(activityToToolMessage),
    [run.activities],
  );
  // Legacy answer_delta: non-final received output only when the message store
  // is empty and the answer is not vouched (old-journal hydrate). Never Thought,
  // never vouched Answer.
  const receivedLegacy = Object.values(run.answer).join("");
  const showLegacyPartial = Boolean(receivedLegacy.trim()) && !midturn.trim() && !vouchedAnswer;
  const policy = run.policy as { effectiveMode?: string; source?: string; revision?: string };
  const model = run.model as { requestedModel?: string; appliedModel?: string; selectionProvenance?: string };
  const codeRunProvenance = projectCodeRunProvenance({
    mode: productMode,
    run,
    catchUp,
    sessionIdentity: codeAgent?.identity ?? null,
  });
  return <article ref={runRootRef} className="run-content" data-run-id={run.runId} aria-label={`Run ${youPrompt}`}>
    <div
      ref={promptRef}
      className={`run-prompt${promptExpanded ? " is-expanded" : ""}`}
      title={youPrompt}
    >
      <button
        type="button"
        className="run-prompt-main"
        aria-expanded={promptExpanded}
        onClick={() => setPromptExpanded((open) => !open)}
      >
        <strong className="run-prompt-role">You</strong>
        <span ref={promptBodyRef} className="run-prompt-body">
          {splitUserPromptMentions(youPrompt).map((part, i) =>
            part.kind === "mention" ? (
              <code key={i} className="run-prompt-mention">
                {part.value}
              </code>
            ) : (
              part.value
            ),
          )}
        </span>
        {promptOverflows ? (
          <span className="run-prompt-more">{promptExpanded ? "Show less" : "Show more"}</span>
        ) : null}
      </button>
      <div
        className="run-provenance"
        aria-label={[
          codeRunProvenance.state === "absent" ? null : codeRunProvenanceCopy(codeRunProvenance),
          `Model: ${model.appliedModel || model.requestedModel || "unspecified"}`,
          `Policy: ${policy.effectiveMode || "unspecified"}`,
        ]
          .filter(Boolean)
          .join(" · ")}
      >
        <CodeRunProvenanceChip projection={codeRunProvenance} />
        <SkillHandoffProvenanceChip provenance={run.skillHandoffProvenance} />
        <span>Model: {model.appliedModel || model.requestedModel || "unspecified"}</span>
        {model.selectionProvenance && model.selectionProvenance !== "inherited" ? <span>Selection: {model.selectionProvenance}</span> : null}
        <span>Policy: {policy.effectiveMode || "unspecified"}</span>
        {policy.source && policy.source !== "fallback" ? <span>Policy source: {policy.source}</span> : null}
        <ProjectInstructionsTurnChip projection={projectInstructionsTurn} />
        <ChatPackTurnChip projection={chatPackTurn} />
      </div>
    </div>
    {reasoning.trim() ? (
      <details
        className="run-thought think-aloud"
        open={thoughtOpen}
      >
        <summary
          onClick={(e) => {
            e.preventDefault();
            setThoughtOpen((open) => nextThoughtOpen(open, { runState: run.state, toggleTo: !open }));
          }}
        >
          {thoughtStreaming ? "Thought…" : "Thought"}
        </summary>
        <pre className="run-thought-body think-aloud-body">{reasoning}</pre>
      </details>
    ) : null}
    {midturn.trim() && !midturnFoldedIntoAnswer(midturn, answer, vouchedAnswer) ? (
      vouchedAnswer ? (
        <details className="run-midturn run-midturn-yielded" aria-label="Mid-turn narration">
          <summary>Earlier</summary>
          <pre className="run-midturn-body">{midturn}</pre>
        </details>
      ) : (
        <div
          className={`run-midturn${thoughtStreaming ? " streaming" : ""}`}
          aria-label="Mid-turn narration"
        >
          <pre className="run-midturn-body">{midturn}</pre>
          {thoughtStreaming ? <span className="md-caret" aria-hidden /> : null}
        </div>
      )
    ) : null}
    {productMode !== "chat" ? (
      <PlanSection projection={planSection} preserved={run.plan ?? null} offline={offline} />
    ) : null}
    {productMode !== "chat" ? (
    <FileChangesSection
      projection={changeList}
      runNonTerminal={run.state !== "terminal"}
      offline={offline}
      openEditId={openChangeDiff}
      onViewDiff={(member) => setOpenChangeDiff(member.editId)}
      onHideDiff={() => setOpenChangeDiff(null)}
      onRevert={(member) => void recoverByMember(member)}
      revertPendingEditId={pending}
      recoveryFlash={recoveryResult}
      onFocusDock={onFocusDiffRequest}
    />
    ) : null}
    {productMode !== "chat" ? (
    <VerifySection
      projection={verifyList}
      offline={offline}
      onViewOutput={(member) => setFocusActivityId(member.activityId)}
      outputAvailableIds={new Set(
        Object.values(run.activities)
          .filter((a) => a.output != null)
          .map((a) => a.activityId),
      )}
    />
    ) : null}
    {productMode === "code" ? (
      <GitReviewSection
        projection={gitReviewList}
        offline={offline}
        activityStatusById={activityStatusById}
        activityLifecycleById={activityLifecycleById}
        onViewOutput={(member) => setFocusActivityId(member.activityId)}
        outputAvailableIds={new Set(
          Object.values(run.activities)
            .filter((a) => a.output != null)
            .map((a) => a.activityId),
        )}
      />
    ) : null}
    {productMode === "code" ? <ChildAgentsSection projection={childProjection} /> : null}
    {productMode === "code" ? <BrowserSection projection={browserProjection} /> : null}
    {productMode === "code" ? <McpServersSection projection={mcpProjection} /> : null}
    {productMode === "code" ? <HooksSection projection={hooksProjection} /> : null}
    {Object.values(run.activities).length > 0 && (
      <div className="activity-output" aria-label="Activity">
        <Receipts
          tools={toolMessages}
          live={run.state !== "terminal"}
          groupKey={`run-tools:${run.runId}`}
          forceOpen={Boolean(focusActivityId)}
        />
        {Object.values(run.activities).map((a) => {
          const result = recoveryResult[a.activityId];
          const listAuto = isListAutoExecuted(a);
          const inChangeList = changeListCoversActivity(changeList, a);
          // Trusted AC-03 keeps an Activity View diff. Review File changes
          // already owns the write — a second button is duplicate chrome.
          // Reads/greps that carry a leftover diff must not mint View diff pills.
          const showDiffHere =
            activityLooksLikeWrite(a) &&
            Boolean(a.diff) &&
            !activityIsVendorSessionPlan(a) &&
            !(inChangeList && !a.autoApplied);
          // File changes already owns Revert / Edit reverted for list members.
          const showRecoveryHere = !inChangeList && Boolean(a.recovery?.available || result);
          const showExtras = Boolean(showRecoveryHere || showDiffHere || a.autoApplied || listAuto);
          if (!showExtras) return null;
          return (
            <div key={`prov-${a.activityId}`}>
              <ActivityProvenance activity={a} hideCommand />
              {showDiffHere && (
                <>
                  <Button
                    variant="ghost"
                    className="activity-diff-toggle"
                    onClick={() => setOpenDiff(openDiff === a.activityId ? null : a.activityId)}
                  >
                    {openDiff === a.activityId ? "Hide diff" : "View diff"}
                  </Button>
                  {openDiff === a.activityId && <pre>{a.diff}</pre>}
                </>
              )}
              {showRecoveryHere && a.recovery?.available && !result && (
                <>
                  <p className="recovery-guard">Restore this file to its state immediately before the edit. Forge will stop if the file has changed since.</p>
                  <Button variant="ghost" disabled={pending === a.editId} onClick={() => void recover(a)}>Revert edit</Button>
                </>
              )}
              {showRecoveryHere && result === "reverted" && <p role="status"><strong>Edit reverted</strong><br />The file was restored to its state immediately before this edit.</p>}
              {showRecoveryHere && result === "conflict" && <p role="alert"><strong>Edit not reverted</strong><br />The file changed after Forge applied this edit, so Forge left it unchanged. Review the current file and this edit’s diff before deciding what to do next.</p>}
              {showRecoveryHere && result === "conflict" && a.diff && <Button variant="ghost" onClick={() => setOpenDiff(a.activityId)}>View diff</Button>}
            </div>
          );
        })}
      </div>
    )}
    {Object.values(run.decisions)
      .filter((d) => {
        if (d.kind === "plan") return false;
        if (d.kind === "recovery_confirmation") return true;
        // Pending permission/diff live in the dock. Settled Write file/Edit
        // cards duplicate File changes.
        return d.status === "pending";
      })
      .map((d) => {
        const isRecovery = d.kind === "recovery_confirmation";
        return (
          <div className="run-decision" key={d.requestId} role="group" aria-label={d.title}>
            <strong>{d.title}</strong>
            <p>{d.detail}</p>
            {isRecovery ? (
              <Button
                variant="primary"
                disabled={pending === d.requestId}
                onClick={() => void submitDecision(d, "allow_once")}
              >
                Recover
              </Button>
            ) : d.status === "pending" ? (
              <p className="run-decision-dock-hint">{SETTLE_IN_DOCK}</p>
            ) : null}
          </div>
        );
      })}
    {error && <p role="alert">{error}</p>}
    {run.state !== "terminal" && <div className="run-live" role="status" aria-live="polite">{run.state === "recovering" ? "Recovering run…" : run.state === "cancelling" ? "Ending run…" : "Run in progress…"}</div>}
    {showLegacyPartial && (
      <div
        className={`assistant-partial${run.state !== "terminal" ? " streaming" : ""}`}
        aria-label="Received answer (not final)"
      >
        <pre className="assistant-partial-text">{receivedLegacy}</pre>
        {run.state !== "terminal" ? <span className="md-caret" aria-hidden /> : null}
      </div>
    )}
    {vouchedAnswer && answer ? (
      <div className="assistant-answer-wrap">
        <div className="assistant-answer-actions">
          {answerElevatable ? (
            <Button
              variant="ghost"
              onClick={() => onOpenArtifact?.(run.runId)}
              title={openTitle}
            >
              Open
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onCopyAnswer} title="Copy message">
            {copyErr ? "Failed" : copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <div
          className={`assistant-answer${artifactOpen ? " assistant-answer--compact" : ""}`}
          role="article"
          aria-label="Assistant answer"
          hidden={artifactOpen || undefined}
        >
          {artifactOpen ? null : <MarkdownBody text={cleanVendorAnswer(answer)} onChoose={onChoose} />}
        </div>
      </div>
    ) : null}
    {run.state === "terminal" && <RunTerminalNotice run={run} onRetryPrompt={onRetryPrompt} onReconnect={onReconnect} onOpenSettings={onOpenSettings} onExportDiagnostics={onExportDiagnostics} />}
  </article>;
});
