import type { RunProjectionRun } from "./runReducer";
import { Button } from "./ui/Button";
export interface RunTerminalNoticeProps {
  run: RunProjectionRun;
  onRetryPrompt?: (prompt: string) => void;
  onReconnect?: () => void;
  onOpenSettings?: () => void;
  onExportDiagnostics?: () => void;
}

export function RunTerminalNotice({ run, onRetryPrompt, onReconnect, onOpenSettings, onExportDiagnostics }: RunTerminalNoticeProps) {
  if (run.terminalKind === "answered") return <span className="run-status chip">Answered</span>;
  if (run.terminalKind === "cancelled") return <div className="terminal-detail" role="status"><strong>Cancelled</strong><p>Run cancelled. Your prompt and received output are preserved.</p></div>;
  const missingFinal = run.failure?.code === "missing_final_answer";
  const detail = missingFinal
    ? "No final answer was received. Your prompt, reasoning, and activity are preserved."
    : "The run ended before a final answer. Your prompt and received output are preserved.";
  const action = run.failure?.recoveryAction === "retry_prompt" && onRetryPrompt
    ? { label: "Retry prompt", run: () => onRetryPrompt(run.acceptedPrompt) }
    : run.failure?.recoveryAction === "reconnect" && onReconnect
      ? { label: "Reconnect", run: onReconnect }
      : run.failure?.recoveryAction === "open_settings" && onOpenSettings
        ? { label: "Open settings", run: onOpenSettings }
        : run.failure?.recoveryAction === "export_diagnostics" && onExportDiagnostics
          ? { label: "Export diagnostics", run: onExportDiagnostics }
        : null;
  return <div className="terminal-detail" role="alert"><strong>Run failed</strong><p>{detail}</p>{action && <Button onClick={action.run}>{action.label}</Button>}</div>;
}
import React from "react";
void React;
