import type { RunProjectionRun } from "./runReducer";
import { Button } from "./ui/Button";
import { visibleUserPrompt } from "./expandMentions";
export interface RunTerminalNoticeProps {
  run: RunProjectionRun;
  onRetryPrompt?: (prompt: string) => void;
  onReconnect?: () => void;
  onOpenSettings?: () => void;
  onExportDiagnostics?: () => void;
}

export function declinedReviewDecision(run: Pick<RunProjectionRun, "decisions">): "permission" | "diff" | null {
  for (const d of Object.values(run.decisions)) {
    if (d.status !== "declined") continue;
    if (d.kind === "permission" || d.kind === "diff") return d.kind;
  }
  return null;
}

export function RunTerminalNotice({ run, onRetryPrompt, onReconnect, onOpenSettings, onExportDiagnostics }: RunTerminalNoticeProps) {
  if (run.terminalKind === "answered") {
    // A clean answered turn renders nothing here — the response turn's node
    // (muted "done") already carries that fact; no "Answered" strip.
    if (!declinedReviewDecision(run)) return null;
    return (
      <div className="terminal-detail" role="status">
        <strong>Denied</strong>
        <p>You denied that action. Your prompt and received output are preserved.</p>
        {onRetryPrompt ? (
          <Button
            variant="ghost"
            onClick={() => onRetryPrompt(visibleUserPrompt(run.acceptedPrompt))}
            title="Send this message again"
          >
            Retry
          </Button>
        ) : null}
      </div>
    );
  }
  if (run.terminalKind === "cancelled") return (
    <div className="terminal-detail" role="status">
      <strong>Cancelled</strong>
      <p>Run cancelled. Your prompt and received output are preserved.</p>
      {onRetryPrompt ? (
        <Button
          variant="ghost"
          onClick={() => onRetryPrompt(visibleUserPrompt(run.acceptedPrompt))}
          title="Send this message again"
        >
          Retry
        </Button>
      ) : null}
    </div>
  );
  const missingFinal = run.failure?.code === "missing_final_answer";
  const detail = missingFinal
    ? "No final answer was received. Your prompt, reasoning, and activity are preserved."
    : "The run ended before a final answer. Your prompt and received output are preserved.";
  const action = run.failure?.recoveryAction === "retry_prompt" && onRetryPrompt
    ? { label: "Retry prompt", run: () => onRetryPrompt(visibleUserPrompt(run.acceptedPrompt)) }
    : run.failure?.recoveryAction === "reconnect" && onReconnect
      ? { label: "Reconnect", run: onReconnect }
      : run.failure?.recoveryAction === "open_settings" && onOpenSettings
        ? { label: "Open settings", run: onOpenSettings }
        : run.failure?.recoveryAction === "export_diagnostics" && onExportDiagnostics
          ? { label: "Export diagnostics", run: onExportDiagnostics }
        : null;
  return <div className="terminal-detail" role="alert"><strong>Run failed</strong><p>{detail}</p>{action && <Button onClick={action.run}>{action.label}</Button>}</div>;
}
