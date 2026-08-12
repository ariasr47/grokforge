interface Props {
  kind: "no-workspace" | "signed-out" | "ready" | "host-offline";
  /** ready-state copy differs for Chat vs Code */
  productMode?: "chat" | "code";
  onOpenFolder?: () => void;
  onSettings?: () => void;
  onReconnect?: () => void;
  onSamplePrompt?: (text: string) => void;
}

const CODE_SAMPLES = [
  "Summarize this repo structure and the main entrypoints.",
  "Find TODO/FIXME comments and list the top risks.",
  "Explain how auth works in this project.",
  "Run the typecheck and fix any errors you can.",
];

const CHAT_SAMPLES = [
  "Draft a short professional Gmail reply from these notes: [paste bullets].",
  "Translate the following to Japanese (business tone) and add a glossary: [paste].",
  "Summarize this market report excerpt: key players, risks, 5 client questions. [paste]",
  "Outline an 8-slide presentation on [topic] with speaker notes (Markdown I can paste into Slides).",
  "Turn this messy note into a clean checklist / recipe with steps.",
  "I exported a Notion page as text. Extract action items and owners: [paste].",
  "Rewrite this Slack message shorter and friendlier (2 tone options): [paste].",
];

export function EmptyStates({
  kind,
  productMode = "code",
  onOpenFolder,
  onSettings,
  onReconnect,
  onSamplePrompt,
}: Props) {
  if (kind === "host-offline") {
    return (
      <div className="empty-state empty-card" role="status">
        <h1>Host offline</h1>
        <p>
          The local agent process isn’t reachable. Reconnect to continue chatting
          and using tools.
        </p>
        {onReconnect && (
          <button type="button" className="btn primary" onClick={onReconnect}>
            Reconnect
          </button>
        )}
      </div>
    );
  }

  if (kind === "no-workspace") {
    return (
      <div className="empty-state empty-card" role="status">
        <h1>Open a project</h1>
        <p>
          Choose a folder so the agent can read and propose edits only inside
          that workspace.
        </p>
        {onOpenFolder && (
          <button type="button" className="btn primary" onClick={onOpenFolder}>
            Open folder…
          </button>
        )}
      </div>
    );
  }

  if (kind === "signed-out") {
    return (
      <div className="empty-state empty-card" role="status">
        <h1>Sign in to chat</h1>
        <p>
          Open Settings and sign in with Grok (or paste an API key as backup).
          You only need to do this once.
        </p>
        <div className="row" style={{ justifyContent: "center" }}>
          {onSettings && (
            <button type="button" className="btn primary" onClick={onSettings}>
              Open Settings
            </button>
          )}
        </div>
      </div>
    );
  }

  const isChat = productMode === "chat";
  const samples = isChat ? CHAT_SAMPLES : CODE_SAMPLES;

  return (
    <div className="empty-state empty-card" role="status">
      <h1>{isChat ? "Presence ready" : "Code continuum"}</h1>
      <p>
        {isChat ? (
          <>
            Writing, translation, summaries, plans — paste text or open a folder
            of documents. Flagship agent: <strong>Grok</strong>. Stay in{" "}
            <strong>Chat</strong> unless you need repo tools. <kbd>Enter</kbd>{" "}
            send · <kbd>Shift+Enter</kbd> newline.
          </>
        ) : (
          <>
            Ask about the repo or request a fix. Use <kbd>Ctrl+K</kbd> for
            commands, <code>@file</code> for paths, <kbd>Enter</kbd> to send,{" "}
            <kbd>Shift+Enter</kbd> for a new line.
          </>
        )}
      </p>
      {onSamplePrompt && (
        <div className="sample-prompts">
          {samples.map((s) => (
            <button
              key={s}
              type="button"
              className="sample-chip"
              onClick={() => onSamplePrompt(s)}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
