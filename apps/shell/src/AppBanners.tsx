import { Button } from "./ui/Button";

export function EngineStoppedBanner({
  engineRetryAllowed,
  onRetry,
}: {
  engineRetryAllowed: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="banner-error" role="alert">
      <div>
        <strong>Forge's engine stopped.</strong> Your conversation is saved.
        {engineRetryAllowed ? " Forge is trying to reconnect." : ""}
      </div>
      {engineRetryAllowed ? (
        <Button variant="primary" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function ErrorBanner({
  message,
  recovery,
  engineRetryAllowed,
  onSignIn,
  onReconnect,
  onOpenFolder,
  onShowFailedTools,
  onExportDiagnostics,
  onDismiss,
}: {
  message: string;
  recovery: string | null;
  engineRetryAllowed: boolean;
  onSignIn: () => void;
  onReconnect: () => void;
  onOpenFolder: () => void;
  onShowFailedTools: () => void;
  onExportDiagnostics: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="banner-error" role="alert">
      <div>
        <div>{message}</div>
        <div className="recovery">
          {recovery === "api_key" ? (
            <Button variant="primary" onClick={onSignIn}>
              Sign in / API key
            </Button>
          ) : null}
          {recovery === "reconnect" && engineRetryAllowed ? (
            <Button variant="primary" onClick={onReconnect}>
              Reconnect engine
            </Button>
          ) : null}
          {recovery === "workspace" ? (
            <Button variant="primary" onClick={onOpenFolder}>
              Open folder…
            </Button>
          ) : null}
          {recovery === "tools" ? (
            <Button variant="primary" onClick={onShowFailedTools}>
              Show failed tools
            </Button>
          ) : null}
        </div>
      </div>
      <div className="banner-actions">
        <Button onClick={onExportDiagnostics}>Export diagnostics</Button>
        <Button variant="ghost" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}
