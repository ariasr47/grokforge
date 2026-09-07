import React from "react";
void React;
import type { ActivityRecord, RunProjectionRun } from "../projections/runReducer";
import { RunTerminalNotice } from "../sections/RunTerminalNotice";
import { api, type BrowserWorkMembershipFact, type ChildAgentsMembershipFact, type CodeAgentFact, type HooksMembershipFact, type McpServersMembershipFact, type ProductMode } from "../lib/api";
import { ChildAgentsSection } from "../sections/ChildAgentsSection";
import { projectChildAgents } from "../projections/childAgentsProjection";
import { BrowserSection } from "../sections/BrowserSection";
import { projectBrowserWork } from "../projections/browserWorkProjection";
import { McpServersSection } from "../sections/McpServersSection";
import { projectMcpServers } from "../projections/mcpServersProjection";
import { HooksSection } from "../sections/HooksSection";
import { projectHooks } from "../projections/hooksProjection";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { writeClipboard } from "../lib/copyClipboard";
import { isListAutoExecuted } from "../projections/trustedCommandProvenance";
import { changeListCoversActivity, projectRunChangeList, type CatchUpSignal } from "../projections/runChangeList";
import { projectRunPlanSection } from "../projections/runPlanSection";
import { PlanSection } from "../sections/PlanSection";
import { projectProjectInstructionsTurn } from "../projections/projectInstructionsTurn";
import { ProjectInstructionsTurnChip } from "../sections/ProjectInstructionsTurnChip";
import { projectChatPackTurn } from "../projections/chatPackTurn";
import { ChatPackTurnChip } from "../sections/ChatPackTurnChip";
import { codeRunProvenanceCopy, projectCodeRunProvenance } from "../projections/codeRunProvenance";
import { CodeRunProvenanceChip } from "../sections/CodeRunProvenanceChip";
import { SkillHandoffProvenanceChip } from "../sections/SkillHandoffProvenanceChip";
import { FileText } from "lucide-react";
import { MarkdownBody } from "../thread/markdown";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { elevateArtifact, type ElevateKind } from "../projections/artifactEligibility";
import { SETTLE_IN_DOCK } from "../lib/copyDock";
import { Receipts } from "../thread/Receipts";
import type { ChatMessage } from "../thread/messageBlocks";
import { formatToolInput, formatToolOutput } from "../projections/toolFormat";
import { cleanVendorAnswer } from "../projections/vendorAnswerClean";
import { activityIsVendorSessionPlan, activityLooksLikeWrite } from "../projections/activityWriteLike";
import { splitUserPromptMentions, visibleUserPrompt } from "../composer/expandMentions";

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
  onChoose?: (label: string, meta?: string) => void;
  artifactOpen?: boolean;
  onOpenArtifact?: (runId: string) => void;
  /** Same source as TranscriptBody.tsx's `<MessageList onOpenPath>` call
   *  (App.tsx's `openToolPath`) — the "Open <path>" action on a Receipts
   *  row. Optional so every other RunSurface consumer (component tests,
   *  other surfaces) stays unaffected when it is left unwired. */
  onOpenPath?: (path: string) => void;
  /** The session's own title — same text ThreadHeader/Beside show. Threaded
   *  to the in-thread `.beside` card's title; never a per-run title. */
  title?: string;
}
const OPEN_TOOLTIP =
  "Show this turn’s document beside the transcript. Closing hides the panel without deleting the turn.";

/** Real, derived classification — mirrors MessageList.tsx's own
 *  besideSubline (kept as an independent copy rather than a shared import
 *  so RunSurface/MessageList stay decoupled); never the mockup's invented
 *  specifics ("English + Japanese · 2 versions"), since no such data exists. */
function besideSubline(kind: ElevateKind): string {
  return kind === "rich-document" ? "Rich document" : "Long document";
}

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

/** Collapse whitespace and cap the live thought excerpt so the DOM never carries
 *  a full reasoning transcript on the one-line summary. */
export function thoughtExcerpt(reasoning: string, max = 120): string {
  const collapsed = reasoning.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, max).trimEnd()}…`;
}

/** `Thought for Ns` needs a real thinking-span timestamp. The projection carries
 *  none today (never invent one) — so the label omits the duration until a real
 *  thought start/end timestamp exists on the projection. */
export function thoughtLabel(streaming: boolean): string {
  return streaming ? "Thought…" : "Thought";
}

/** Response-turn node modifier from run state — hollow (You) is handled separately;
 *  this is only for the turn that carries Grok's own work. */
export function responseNodeModifier(
  run: Pick<RunProjectionRun, "state" | "terminalKind">,
): "filled" | "amber" | "rose" | "done" {
  if (run.state === "waiting_for_decision") return "amber";
  if (run.state === "terminal") return run.terminalKind === "failed" ? "rose" : "done";
  return "filled";
}

/** HH:MM in the viewer's local clock from a real host timestamp. Empty/invalid
 *  input (common in fixtures, and possible before the host stamps a run) never
 *  renders a guessed or garbled time — it renders nothing. */
export function formatClockTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
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

/** Latch Show more so a later tighter measure cannot drop it (WebView2
 *  scrollHeight/clientHeight can oscillate when the button itself appears). */
export function nextPromptOverflow(prev: boolean, measured: boolean, promptChanged: boolean): boolean {
  if (promptChanged) return measured;
  return prev || measured;
}

export const RunSurface = memo(function RunSurface({ run, catchUp = { phase: "closed" }, offline = false, productMode, codeAgent = null, childAgents = null, browserWork = null, mcpServers = null, hooks = null, hostRosterEligible = true, ownershipLost = false, onRetryPrompt, onReconnect, onOpenSettings, onExportDiagnostics, onChoose, artifactOpen = false, onOpenArtifact, onOpenPath, title }: RunSurfaceProps) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openDiff, setOpenDiff] = useState<string | null>(null);
  const [recoveryResult, setRecoveryResult] = useState<Record<string, "reverted" | "conflict">>({});
  const [thoughtOpen, setThoughtOpen] = useState(() => run.state !== "terminal");
  const youPrompt = visibleUserPrompt(run.acceptedPrompt);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [promptOverflows, setPromptOverflows] = useState(false);
  const promptOverflowTextRef = useRef(youPrompt);
  const promptBodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setPromptExpanded(false);
    setThoughtOpen(run.state !== "terminal");
  }, [run.runId]);
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
      if (el.closest(".you")?.classList.contains("is-expanded")) return;
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
  const changeList = projectRunChangeList(run, catchUp);
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
  const clockTime = formatClockTime(run.admittedAt);
  const nodeModifier = responseNodeModifier(run);
  const thoughtLbl = thoughtLabel(thoughtStreaming);
  const thoughtTx = reasoning.trim() ? thoughtExcerpt(reasoning) : "";
  return <article className="run-content" data-run-id={run.runId} aria-label={`Run ${youPrompt}`}>
    <article className="turn you-turn">
      <i className="node" aria-hidden="true" />
      <div className="you" title={youPrompt}>
        <div className="who">
          <span>You</span>
          {clockTime ? <span className="m">{clockTime}</span> : null}
        </div>
        <div
          className="you-meta"
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
        <div ref={promptBodyRef} className={`you-body${promptExpanded ? " is-expanded" : ""}`}>
          {splitUserPromptMentions(youPrompt).map((part, i) =>
            part.kind === "mention" ? (
              <code key={i} className="mention">
                {part.value}
              </code>
            ) : (
              part.value
            ),
          )}
        </div>
        {promptOverflows ? (
          <button
            type="button"
            className="you-more"
            aria-expanded={promptExpanded}
            onClick={() => setPromptExpanded((open) => !open)}
          >
            {promptExpanded ? "Show less" : "Show more"}
          </button>
        ) : null}
      </div>
    </article>

    <article className="turn response-turn">
      <i className={`node node--${nodeModifier}`} aria-hidden="true" />
      {reasoning.trim() ? (
        <details className="thought" open={thoughtOpen}>
          <summary
            onClick={(e) => {
              e.preventDefault();
              setThoughtOpen((open) => nextThoughtOpen(open, { runState: run.state, toggleTo: !open }));
            }}
          >
            <span className="ch" aria-hidden="true">{thoughtOpen ? "▾" : "▸"}</span>
            <span className="lb">{thoughtLbl}</span>
            {thoughtTx ? <span className="tx">— {thoughtTx}</span> : null}
          </summary>
          <pre className="think-aloud-body">{reasoning}</pre>
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
            onOpenPath={onOpenPath}
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
        .map((d) => (
          // The dock (ActionDock's ask/amber gates) owns every action for
          // these — recovery_confirmation included, since Task 8's follow-up
          // wired the cyan ask tier there. This keeps only the record (title
          // + detail) and, while still pending, the same settle-below hint
          // permission/diff cards show — never a live control of its own.
          <div className="run-decision" key={d.requestId} role="group" aria-label={d.title}>
            <strong>{d.title}</strong>
            <p>{d.detail}</p>
            {d.status === "pending" ? (
              <p className="run-decision-dock-hint">{SETTLE_IN_DOCK}</p>
            ) : null}
          </div>
        ))}
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
            <Button variant="ghost" onClick={onCopyAnswer} title="Copy message">
              {copyErr ? "Failed" : copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <div
            className={`assistant-answer prose${artifactOpen ? " assistant-answer--compact" : ""}`}
            role="article"
            aria-label="Assistant answer"
            hidden={artifactOpen || undefined}
          >
            {artifactOpen ? null : <MarkdownBody text={cleanVendorAnswer(answer)} onChoose={onChoose} />}
          </div>
          {answerElevatable ? (
            <div className="beside">
              <span className="ic" aria-hidden="true">
                <Icon icon={FileText} size={16} />
              </span>
              <div>
                <div className="bt">{title || "Document"}</div>
                <div className="bs">{besideSubline(elevate.kind)}</div>
              </div>
              <Button
                size="sm"
                className="open"
                onClick={() => onOpenArtifact?.(run.runId)}
                title={openTitle}
              >
                Open
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      {run.state === "terminal" && <RunTerminalNotice run={run} onRetryPrompt={onRetryPrompt} onReconnect={onReconnect} onOpenSettings={onOpenSettings} onExportDiagnostics={onExportDiagnostics} />}
    </article>
  </article>;
});
