import { Button } from "./ui/Button";

interface Props {
  /** "ready"/"no-workspace" retired — Task 13's HomeScreen replaces both
   *  (docs/design/forge-next/Home.dc.html). These three launch surfaces
   *  stay exactly as they are; apps/shell/src/copyInvariants.test.tsx
   *  covers all four (this trio plus Home). */
  kind: "signed-out" | "host-offline" | "conversations-not-found";
  onSettings?: () => void;
  /** F8/AC5 — direct sign-in affordance: starts the same subscription
   * sign-in the Settings panel's "Sign in with Grok" button starts, from
   * this state, with no Settings navigation first. */
  onSignIn?: () => void;
  onReconnect?: () => void;
  /** F7 (AC12b) — Save troubleshooting file / Start a new conversation. */
  onSaveDiagnostics?: () => void;
  onStartNewConversation?: () => void;
}

export function EmptyStates({
  kind,
  onSettings,
  onSignIn,
  onReconnect,
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

  // SPEC §4 "Sign-in empty state" — operator ruling (2026-08-14, AC5):
  // primary direct sign-in affordance, `Open Settings` demoted to
  // secondary. Order is the content of the state (AC5 is checkable by
  // looking): primary first, secondary below it, nothing else renders.
  // `kind` is exhausted by the two `if`s above — this is the only case left.
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
        {onSettings && <Button onClick={onSettings}>Open Settings</Button>}
      </div>
    </div>
  );
}
