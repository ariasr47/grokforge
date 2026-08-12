import type { FirstRunState } from "./firstRun";
import type { ProductMode } from "./api";

interface Props {
  firstRun: FirstRunState;
  hasWorkspace: boolean;
  signedIn: boolean;
  mode: ProductMode;
  onOpenFolder: () => void;
  onOpenSettings: () => void;
  onSetMode?: (m: ProductMode) => void;
  onDismiss: () => void;
}

export function Onboarding({
  firstRun,
  hasWorkspace,
  signedIn,
  mode,
  onOpenFolder,
  onOpenSettings,
  onSetMode,
  onDismiss,
}: Props) {
  const isChat = mode === "chat";
  const steps = [
    {
      id: "mode",
      title: "Pick how you want to start",
      done: Boolean(firstRun.pickedMode),
      action:
        onSetMode && !firstRun.pickedMode ? (
          <div className="row" style={{ gap: 8 }}>
            <button
              type="button"
              className={`btn ${isChat ? "primary" : ""}`}
              onClick={() => onSetMode("chat")}
            >
              Chat — everyday agent
            </button>
            <button
              type="button"
              className={`btn ${!isChat ? "primary" : ""}`}
              onClick={() => onSetMode("code")}
            >
              Code — repo agent
            </button>
          </div>
        ) : null,
      hint: "Chat is for everyday work. Code is only if you work with a software project folder.",
    },
    {
      id: "folder",
      title: isChat
        ? "Optional: open a folder for Chat tools"
        : "Open a project folder",
      done: isChat
        ? firstRun.openedFolder || firstRun.sentMessage || hasWorkspace
        : firstRun.openedFolder || hasWorkspace,
      action:
        !hasWorkspace && !isChat ? (
          <button type="button" className="btn primary" onClick={onOpenFolder}>
            Open folder…
          </button>
        ) : isChat && !hasWorkspace ? (
          <button type="button" className="btn" onClick={onOpenFolder}>
            Open folder (optional)…
          </button>
        ) : null,
      hint: isChat
        ? "Chat works without a folder (sandbox). Attach files only if you need tools on disk."
        : "Workspace tools only run inside this folder.",
    },
    {
      id: "auth",
      title: "Sign in with subscription (or API key backup)",
      done: firstRun.signedIn || signedIn,
      action: signedIn ? null : (
        <button type="button" className="btn primary" onClick={onOpenSettings}>
          Sign in / Settings
        </button>
      ),
      hint: "Sign in with your Grok account (recommended). API key is optional backup.",
    },
    {
      id: "connectors",
      title: isChat
        ? "Work tools (Gmail, Notion, files)"
        : "Workspace tools (repo folder)",
      done: isChat
        ? firstRun.sentMessage || firstRun.openedFolder || firstRun.dismissed
        : firstRun.openedFolder || hasWorkspace,
      action:
        isChat && onOpenSettings ? (
          <button type="button" className="btn" onClick={onOpenSettings}>
            Open Connectors in Settings
          </button>
        ) : null,
      hint: isChat
        ? "No Gmail login yet — paste emails into Chat. Notion: optional API secret under Settings → Connectors. Local files: Open folder or Attach."
        : "Code mode uses the project folder for tools and diffs.",
    },
    {
      id: "chat",
      title: isChat
        ? "Try a real task (email, translate, summarize)"
        : "Ask about the repo",
      done: firstRun.sentMessage,
      action: null,
      hint: isChat
        ? "Paste text or ask in plain language. New chat = new project/topic. PDF: paste text or .txt export. Stay on Chat."
        : 'Try: "What does this project do?" or "Where is the entrypoint?"',
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;

  return (
    <div className="onboarding" role="region" aria-label="Getting started">
      <div className="onboarding-header">
        <div>
          <h2>Welcome to Forge</h2>
          <p>
            Desktop agent shell · Grok first · {doneCount}/{steps.length} done
          </p>
        </div>
        <button type="button" className="btn ghost" onClick={onDismiss}>
          Skip
        </button>
      </div>
      <ol className="onboarding-steps">
        {steps.map((s, i) => (
          <li key={s.id} className={s.done ? "done" : ""}>
            <div className="step-n" aria-hidden>
              {s.done ? "✓" : i + 1}
            </div>
            <div className="step-body">
              <strong>{s.title}</strong>
              <span className="hint">{s.hint}</span>
              {s.action && <div className="step-action">{s.action}</div>}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
