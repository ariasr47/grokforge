export interface PermissionReq {
  id: string;
  kind: "write" | "shell";
  detail: string;
  sessionId: string;
  runId: string;
  invocationId: string;
}

interface Props {
  permission: PermissionReq;
  onDecision: (decision: "allow_once" | "allow_session" | "deny") => void;
}

export function PermissionCard({ permission, onDecision }: Props) {
  const isShell = permission.kind === "shell";
  const label = isShell
    ? "Allow running a command?"
    : "Allow saving a file?";
  const kindLabel = isShell ? "Run command" : "Save file";
  return (
    <div
      className="perm-card"
      id="perm-card"
      data-perm-card
      role="region"
      aria-label={label}
    >
      <div className="perm-card-head">
        <span className="kind">{kindLabel}</span>
        <span className="perm-keys" aria-hidden="true">
          Y once · S session · N deny
        </span>
      </div>
      <p className="hint" style={{ margin: "0 0 8px" }}>
        {isShell
          ? "Grok wants to run this on your machine (inside the open folder)."
          : "Grok wants to write a file. You can review the change before it sticks."}
      </p>
      <pre className="detail">{permission.detail}</pre>
      <div className="row">
        <button
          type="button"
          className="btn primary"
          aria-keyshortcuts="y"
          onClick={() => onDecision("allow_once")}
        >
          Allow once
        </button>
        <button
          type="button"
          className="btn"
          aria-keyshortcuts="s"
          onClick={() => onDecision("allow_session")}
        >
          Always this chat
        </button>
        <button
          type="button"
          className="btn ghost"
          aria-keyshortcuts="n"
          onClick={() => onDecision("deny")}
        >
          Deny
        </button>
      </div>
    </div>
  );
}
