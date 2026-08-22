import { Button } from "./ui/Button";

interface Props {
  kind:
    | "no-workspace"
    | "signed-out"
    | "ready"
    | "host-offline"
    | "conversations-not-found";
  /** ready-state copy differs for Chat vs Code */
  productMode?: "chat" | "code";
  onOpenFolder?: () => void;
  onSettings?: () => void;
  /** F8/AC5 — direct sign-in affordance: starts the same subscription
   * sign-in the Settings panel's "Sign in with Grok" button starts, from
   * this state, with no Settings navigation first. */
  onSignIn?: () => void;
  onReconnect?: () => void;
  onSamplePrompt?: (text: string) => void;
  /** F7 (AC12b) — Save troubleshooting file / Start a new conversation. */
  onSaveDiagnostics?: () => void;
  onStartNewConversation?: () => void;
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
  onSignIn,
  onReconnect,
  onSamplePrompt,
  onSaveDiagnostics,
  onStartNewConversation,
}: Props) {
  if (kind === "host-offline") {
    // SPEC §4 — "Forge's engine stopped" (replaces the withdrawn "Host
    // offline" copy; the noun "host" is banned from rendered text, AC-U4).
    return (
      <div className="empty-state empty-card" role="status">
        <h1>Forge's engine stopped.</h1>
        <p>
          Your conversation is saved.
          {onReconnect ? " Forge is trying to reconnect." : ""}
        </p>
        {onReconnect && (
          <Button variant="primary" onClick={onReconnect}>
            Try again
          </Button>
        )}
      </div>
    );
  }

  if (kind === "conversations-not-found") {
    // F7 / AC12b. Wording constrained by SPEC §4: names no cause, does not
    // claim the data is unrecoverable, does not show the welcome.
    return (
      <div className="empty-state empty-card" role="status">
        <h1>Forge didn't find your earlier conversations.</h1>
        <p>
          Forge couldn't find conversations saved on this PC. New conversations
          will be saved as usual. If you had conversations here before, save a
          troubleshooting file and send it to whoever set Forge up.
        </p>
        <div className="row" style={{ justifyContent: "center", gap: 8 }}>
          {onSaveDiagnostics && (
            <Button variant="primary" onClick={onSaveDiagnostics}>
              Save troubleshooting file
            </Button>
          )}
          {onStartNewConversation && (
            <Button onClick={onStartNewConversation}>
              Start a new conversation
            </Button>
          )}
        </div>
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
          <Button variant="primary" onClick={onOpenFolder}>
            Open folder…
          </Button>
        )}
      </div>
    );
  }

  if (kind === "signed-out") {
    // SPEC §4 "Sign-in empty state" — operator ruling (2026-08-14, AC5):
    // primary direct sign-in affordance, `Open Settings` demoted to
    // secondary. Order is the content of the state (AC5 is checkable by
    // looking): primary first, secondary below it, nothing else renders.
    return (
      <div className="empty-state empty-card" role="status">
        <h1>Sign in to chat.</h1>
        <p>
          Sign in with Grok to start. Forge remembers this on this PC. If
          you'd rather use an API key, you can add one in Settings.
        </p>
        <div className="row" style={{ justifyContent: "center" }}>
          {onSignIn && (
            <Button variant="primary" onClick={onSignIn}>
              Sign in with Grok
            </Button>
          )}
          {onSettings && (
            <Button onClick={onSettings}>Open Settings</Button>
          )}
        </div>
      </div>
    );
  }

  const isChat = productMode === "chat";
  const samples = isChat ? CHAT_SAMPLES : CODE_SAMPLES;

  return (
    <div className="empty-state empty-card" role="status">
      <h1>{isChat ? "Chat with Grok" : "Code continuum"}</h1>
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
