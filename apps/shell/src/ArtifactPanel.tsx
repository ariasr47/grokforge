import { Component, type ErrorInfo, type ReactNode } from "react";
import { MarkdownBody } from "./markdown";
import { Button } from "./ui/Button";
import type { ArtifactContentKind } from "./artifactOpenBinding";

/** Test-only seam so AC 15 can exercise the shared-renderer catch path. */
let forceRenderErrorForTests = false;
export function setArtifactPanelForceRenderError(next: boolean): void {
  forceRenderErrorForTests = next;
}

const OPEN_ERROR_COPY = "Couldn't open this artifact.";
const CLOSE_TITLE =
  "Hide the side panel. The turn stays in the transcript.";
const ERROR_TITLE =
  "The side panel could not render this turn’s content. The transcript turn is unchanged.";
const HELPER =
  "Large document or grok-ui from this turn — same renderer, beside the bubble.";

function ThrowOnRender(): ReactNode {
  throw new Error("artifact-panel: forced shared renderer failure");
}

class ArtifactRenderBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  componentDidCatch(_err: Error, _info: ErrorInfo): void {}
  render(): ReactNode {
    if (this.state.failed) return this.props.fallback;
    return this.props.children;
  }
}

export function ArtifactPanel({
  body,
  contentKind,
  onClose,
  onChoose,
  forceRenderError = false,
}: {
  body: string | null;
  contentKind: ArtifactContentKind | null;
  onClose: () => void;
  onChoose?: (label: string, meta?: string) => void;
  /** Test-only: throw at the shared MarkdownBody/RichBlocks boundary. */
  forceRenderError?: boolean;
}) {
  if (!body || !contentKind) return null;
  const forceThrow = Boolean(forceRenderError) || forceRenderErrorForTests;
  const errorChrome = (
    <div className="artifact-panel-error" role="alert" title={ERROR_TITLE}>
      {OPEN_ERROR_COPY}
    </div>
  );
  return (
    <aside className="artifact-panel" aria-label="Artifact">
      <div className="artifact-panel-head">
        <h2>Artifact</h2>
        <Button variant="ghost" onClick={onClose} title={CLOSE_TITLE}>
          Close
        </Button>
      </div>
      <p className="artifact-panel-helper">{HELPER}</p>
      <div className="sr-only" aria-live="polite">
        {forceThrow ? "Couldn't open this artifact" : "Artifact opened"}
      </div>
      <div className="artifact-panel-body">
        <ArtifactRenderBoundary fallback={errorChrome}>
          {forceThrow ? (
            <ThrowOnRender />
          ) : (
            <MarkdownBody text={body} onChoose={onChoose} />
          )}
        </ArtifactRenderBoundary>
      </div>
    </aside>
  );
}
