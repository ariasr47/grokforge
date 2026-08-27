import React from "react";
void React;
import type { ActivityRecord, RunProjectionRun } from "./runReducer";
import { RunTerminalNotice } from "./RunTerminalNotice";
import { api, type BrowserWorkMembershipFact, type ChildAgentsMembershipFact, type CodeAgentFact, type ProductMode } from "./api";
import { ChildAgentsSection } from "./ChildAgentsSection";
import { projectChildAgents } from "./childAgentsProjection";
import { BrowserSection } from "./BrowserSection";
import { projectBrowserWork } from "./browserWorkProjection";
import { memo, useEffect, useMemo, useState } from "react";
import { isListAutoExecuted } from "./trustedCommandProvenance";
import { projectRunChangeList, type CatchUpSignal, type RunChangeMember } from "./runChangeList";
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
import { MarkdownBody } from "./markdown";
import { Button } from "./ui/Button";
import { SETTLE_IN_DOCK } from "./copyDock";
import { ToolActivityGroup } from "./ToolActivity";
import type { ChatMessage } from "./messageBlocks";
import { formatToolInput, formatToolOutput } from "./toolFormat";

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
      title: activity.title ?? null,
      summary: activity.summary ?? activity.command ?? activity.path ?? undefined,
      ok: activity.execution === "executed" ? activity.status === "succeeded" : undefined,
      done: activity.lifecycle === "terminal",
      lifecycle: activity.lifecycle,
      execution: activity.execution,
      status: activity.status,
      command: activity.command,
    },
  };
}

const LIST_AUTO_CHIP = "Ran without asking · Trusted command class";
const LIST_AUTO_TOOLTIP = "Matched a saved class for this workspace. The process is not sandboxed.";

function ActivityProvenance({ activity, hideCommand = false }: { activity: ActivityRecord; hideCommand?: boolean }) {
  const command = hideCommand ? null : activity.command;
  const listAuto = isListAutoExecuted(activity);
  return (
    <>
      {command ? <p className="activity-command"><code>{command}</code></p> : null}
      <p>
        Policy: {activity.policy?.effectiveMode ? String(activity.policy.effectiveMode) : "unspecified"}
        {!listAuto && activity.autoApplied ? " · Applied automatically · Trusted workspace" : ""}
      </p>
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
  ownershipLost?: boolean;
  onRetryPrompt?: (prompt: string) => void;
  onReconnect?: () => void;
  onOpenSettings?: () => void;
  onExportDiagnostics?: () => void;
  onFocusDiffRequest?: (requestId: string) => void;
  onChoose?: (label: string, meta?: string) => void;
}
export const RunSurface = memo(function RunSurface({ run, catchUp = { phase: "closed" }, offline = false, productMode, codeAgent = null, childAgents = null, browserWork = null, ownershipLost = false, onRetryPrompt, onReconnect, onOpenSettings, onExportDiagnostics, onFocusDiffRequest, onChoose }: RunSurfaceProps) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openDiff, setOpenDiff] = useState<string | null>(null);
  const [openChangeDiff, setOpenChangeDiff] = useState<string | null>(null);
  const [recoveryResult, setRecoveryResult] = useState<Record<string, "reverted" | "conflict">>({});
  const [focusActivityId, setFocusActivityId] = useState<string | null>(null);
  const [thoughtOpen, setThoughtOpen] = useState(true);
  useEffect(() => {
    if (run.state !== "terminal" && Object.values(run.reasoning).join("").trim()) setThoughtOpen(true);
  }, [run.state, run.reasoning]);
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
      setRecoveryResult((prev) => ({ ...prev, [activity.activityId]: "reverted" }));
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "recovery_conflict") setRecoveryResult((prev) => ({ ...prev, [activity.activityId]: "conflict" }));
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
  });
  const browserProjection = projectBrowserWork({
    mode: productMode,
    codeAgent,
    browserWork,
    connected: !offline,
    parentTerminal: run.state === "terminal",
    ownershipLost,
    runNonTerminal: run.state !== "terminal",
  });
  const reasoning = Object.values(run.reasoning).join("");
  const midturn = Object.values(run.message ?? {}).join("");
  const answer = run.finalAnswer;
  const vouchedAnswer = Boolean(run.terminalKind === "answered" && run.answerVouched && answer?.trim());
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
  return <article className="run-content" data-run-id={run.runId} aria-label={`Run ${run.acceptedPrompt}`}>
    <div className="run-prompt"><strong>You</strong><p>{run.acceptedPrompt}</p></div>
    <div className="run-provenance" aria-label="Run provenance"><span>Model: {model.appliedModel || model.requestedModel || "unspecified"}</span>{model.selectionProvenance && <span>Selection: {model.selectionProvenance}</span>}<span>Policy: {policy.effectiveMode || "unspecified"}</span>{policy.source && <span>Policy source: {policy.source}</span>}<ProjectInstructionsTurnChip projection={projectInstructionsTurn} /><ChatPackTurnChip projection={chatPackTurn} /></div>
    {reasoning.trim() ? (
      <details
        className="run-thought think-aloud"
        open={thoughtOpen}
        onToggle={(e) => setThoughtOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary>{thoughtStreaming ? "Thought…" : "Thought"}</summary>
        <pre className="run-thought-body think-aloud-body">{reasoning}</pre>
      </details>
    ) : null}
    {midturn.trim() ? (
      vouchedAnswer ? (
        <details className="run-midturn run-midturn-yielded" aria-label="Mid-turn narration">
          <summary>Mid-turn</summary>
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
    <PlanSection projection={planSection} preserved={run.plan ?? null} offline={offline} />
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
    {Object.values(run.activities).length > 0 && (
      <div className="activity-output" aria-label="Activity">
        <ToolActivityGroup
          tools={toolMessages}
          live={run.state !== "terminal"}
          groupKey={`run-tools:${run.runId}`}
          forceOpen={Boolean(focusActivityId)}
        />
        {Object.values(run.activities).map((a) => {
          const result = recoveryResult[a.activityId];
          const listAuto = isListAutoExecuted(a);
          const showExtras = Boolean(a.recovery?.available || result || a.diff || a.autoApplied || listAuto);
          if (!showExtras) return null;
          return (
            <div key={`prov-${a.activityId}`}>
              <ActivityProvenance activity={a} hideCommand />
              {a.diff && (
                <>
                  <Button variant="ghost" onClick={() => setOpenDiff(openDiff === a.activityId ? null : a.activityId)}>
                    {openDiff === a.activityId ? "Hide diff" : "View diff"}
                  </Button>
                  {openDiff === a.activityId && <pre>{a.diff}</pre>}
                </>
              )}
              {a.recovery?.available && !result && (
                <>
                  <p className="recovery-guard">Restore this file to its state immediately before the edit. Forge will stop if the file has changed since.</p>
                  <Button variant="ghost" disabled={pending === a.editId} onClick={() => void recover(a)}>Revert edit</Button>
                </>
              )}
              {result === "reverted" && <p role="status"><strong>Edit reverted</strong><br />The file was restored to its state immediately before this edit.</p>}
              {result === "conflict" && <p role="alert"><strong>Edit not reverted</strong><br />The file changed after Forge applied this edit, so Forge left it unchanged. Review the current file and this edit’s diff before deciding what to do next.</p>}
              {result === "conflict" && a.diff && <Button variant="ghost" onClick={() => setOpenDiff(a.activityId)}>View diff</Button>}
            </div>
          );
        })}
      </div>
    )}
    {Object.values(run.decisions)
      .filter((d) => d.kind !== "plan")
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
    {vouchedAnswer && answer && <div className="assistant-answer" role="article" aria-label="Assistant answer"><MarkdownBody text={answer} onChoose={onChoose} /></div>}
    {run.state === "terminal" && <RunTerminalNotice run={run} onRetryPrompt={onRetryPrompt} onReconnect={onReconnect} onOpenSettings={onOpenSettings} onExportDiagnostics={onExportDiagnostics} />}
  </article>;
});
