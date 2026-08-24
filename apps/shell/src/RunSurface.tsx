import React from "react";
void React;
import type { ActivityRecord, RunProjectionRun } from "./runReducer";
import { RunTerminalNotice } from "./RunTerminalNotice";
import { api, type ProductMode } from "./api";
import { useEffect, useState } from "react";
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
import { MarkdownBody } from "./markdown";
import { Button } from "./ui/Button";
import { SETTLE_IN_DOCK } from "./copyDock";

const LIST_AUTO_CHIP = "Ran without asking · Trusted command class";
const LIST_AUTO_TOOLTIP = "Matched a saved class for this workspace. The process is not sandboxed.";

function ActivityProvenance({ activity }: { activity: ActivityRecord }) {
  const command = activity.command;
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
  onRetryPrompt?: (prompt: string) => void;
  onReconnect?: () => void;
  onOpenSettings?: () => void;
  onExportDiagnostics?: () => void;
  onFocusDiffRequest?: (requestId: string) => void;
  onChoose?: (label: string, meta?: string) => void;
}
export function RunSurface({ run, catchUp = { phase: "closed" }, offline = false, productMode, onRetryPrompt, onReconnect, onOpenSettings, onExportDiagnostics, onFocusDiffRequest, onChoose }: RunSurfaceProps) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openDiff, setOpenDiff] = useState<string | null>(null);
  const [openChangeDiff, setOpenChangeDiff] = useState<string | null>(null);
  const [recoveryResult, setRecoveryResult] = useState<Record<string, "reverted" | "conflict">>({});
  const [focusActivityId, setFocusActivityId] = useState<string | null>(null);
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
  const reasoning = Object.values(run.reasoning).join("");
  const answer = run.finalAnswer;
  // answer_delta is durable received provider output, but is not itself a
  // vouched final answer. Keep it visible for live, cancelled, and failed runs
  // while reserving the assistant-answer surface for an authoritative answer.
  const receivedAnswer = Object.values(run.answer).join("");
  const policy = run.policy as { effectiveMode?: string; source?: string; revision?: string };
  const model = run.model as { requestedModel?: string; appliedModel?: string; selectionProvenance?: string };
  return <article className="run-content" data-run-id={run.runId} aria-label={`Run ${run.acceptedPrompt}`}>
    <div className="run-prompt"><strong>You</strong><p>{run.acceptedPrompt}</p></div>
    <div className="run-provenance" aria-label="Run provenance"><span>Model: {model.appliedModel || model.requestedModel || "unspecified"}</span>{model.selectionProvenance && <span>Selection: {model.selectionProvenance}</span>}<span>Policy: {policy.effectiveMode || "unspecified"}</span>{policy.source && <span>Policy source: {policy.source}</span>}<ProjectInstructionsTurnChip projection={projectInstructionsTurn} /></div>
    {reasoning && <details><summary>Reasoning</summary><p>{reasoning}</p></details>}
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
    {Object.values(run.activities).length > 0 && <div className="activity-output" aria-label="Activity">{Object.values(run.activities).map(a => { const result = recoveryResult[a.activityId]; return <details key={a.activityId} data-activity-id={a.activityId} open={focusActivityId === a.activityId ? true : undefined} ref={(el) => { if (el && focusActivityId === a.activityId) { el.scrollIntoView({ block: "nearest" }); } }}><summary>{a.name}: {a.status}</summary><p>Input: {typeof a.input === "string" ? a.input : JSON.stringify(a.input)}</p>{a.output != null && <p>Output: {typeof a.output === "string" ? a.output : JSON.stringify(a.output)}</p>}{a.error && <p role="alert">Failure: {a.error}</p>}{a.diff && <><Button variant="ghost" onClick={() => setOpenDiff(openDiff === a.activityId ? null : a.activityId)}>{openDiff === a.activityId ? "Hide diff" : "View diff"}</Button>{openDiff === a.activityId && <pre>{a.diff}</pre>}</>}<ActivityProvenance activity={a} />{a.recovery?.available && !result && <><p className="recovery-guard">Restore this file to its state immediately before the edit. Forge will stop if the file has changed since.</p><Button variant="ghost" disabled={pending === a.editId} onClick={() => void recover(a)}>Revert edit</Button></>}{result === "reverted" && <p role="status"><strong>Edit reverted</strong><br />The file was restored to its state immediately before this edit.</p>}{result === "conflict" && <p role="alert"><strong>Edit not reverted</strong><br />The file changed after Forge applied this edit, so Forge left it unchanged. Review the current file and this edit’s diff before deciding what to do next.</p>}{result === "conflict" && a.diff && <Button variant="ghost" onClick={() => setOpenDiff(a.activityId)}>View diff</Button>}</details>; })}</div>}
    {Object.values(run.decisions)
      .filter((d) => d.status === "pending" && d.kind !== "plan")
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
            ) : (
              <p className="run-decision-dock-hint">{SETTLE_IN_DOCK}</p>
            )}
          </div>
        );
      })}
    {error && <p role="alert">{error}</p>}
    {run.state !== "terminal" && <div className="run-live" role="status" aria-live="polite">{run.state === "recovering" ? "Recovering run…" : run.state === "cancelling" ? "Ending run…" : "Run in progress…"}</div>}
    {receivedAnswer && !(run.terminalKind === "answered" && run.answerVouched && answer) && (
      <div
        className={`assistant-partial${run.state !== "terminal" ? " streaming" : ""}`}
        aria-label="Received answer (not final)"
      >
        <pre className="assistant-partial-text">{receivedAnswer}</pre>
        {run.state !== "terminal" ? <span className="md-caret" aria-hidden /> : null}
      </div>
    )}
    {run.terminalKind === "answered" && run.answerVouched && answer && <div className="assistant-answer" role="article" aria-label="Assistant answer"><MarkdownBody text={answer} onChoose={onChoose} /></div>}
    {run.state === "terminal" && <RunTerminalNotice run={run} onRetryPrompt={onRetryPrompt} onReconnect={onReconnect} onOpenSettings={onOpenSettings} onExportDiagnostics={onExportDiagnostics} />}
  </article>;
}
