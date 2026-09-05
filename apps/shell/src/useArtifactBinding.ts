import { useCallback, useEffect, useMemo, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { elevateArtifact } from "./artifactEligibility";
import {
  clearArtifactBinding,
  openArtifactBinding,
  shouldClearOnConversationChange,
  shouldClearOnSourceGone,
  type ArtifactContentKind,
  type ArtifactOpenBinding,
} from "./artifactOpenBinding";
import type { ChatMessage } from "./messageBlocks";
import type { RunProjection } from "./runReducer";

export interface UseArtifactBindingParams {
  sessionId: string | null;
  runProjection: RunProjection;
  messages: ChatMessage[];
  /**
   * App.tsx's own `runProjectionRef` — the same mutable object, not a copy.
   * `runProjectionRef.current` can run ahead of the committed `runProjection`
   * state while a FrameFlush-coalesced paint is pending (see App.tsx's
   * comment above the ref and task-2-report.md), so `openRunArtifact` reads
   * it instead of `runProjection` to see the truly latest run. Threading the
   * real ref through (rather than re-deriving one locally) preserves that
   * timing exactly.
   */
  runProjectionRef: RefObject<RunProjection>;
  /**
   * App.tsx's own `messagesRef` — mirrors `messages` via a plain effect
   * elsewhere in App.tsx. `openMessageArtifact` reads it (matching the
   * pre-move source) rather than the `messages` param.
   */
  messagesRef: RefObject<ChatMessage[]>;
}

export interface UseArtifactBindingResult {
  artifactOpenBinding: ArtifactOpenBinding | null;
  /**
   * The raw setter, exposed alongside `closeArtifact`. Several App.tsx flows
   * outside this hook (switchSession, newSession, removeSession,
   * retryLastUser, regenerateLast) clear the binding directly — e.g.
   * `setArtifactOpenBinding(null)` — without going through `closeArtifact`,
   * because those are implicit clears (session switching away, retrying a
   * turn) and must not fire `closeArtifact`'s "Artifact closed" screen-reader
   * announce, which is reserved for an explicit user close. Keeping the same
   * setter identity available here (rather than only a same-named local
   * `useState` in App.tsx) is what lets those call sites keep working
   * unchanged.
   */
  setArtifactOpenBinding: Dispatch<SetStateAction<ArtifactOpenBinding | null>>;
  boundArtifact: { body: string; contentKind: ArtifactContentKind } | null;
  artifactAnnounce: string;
  closeArtifact: () => void;
  openRunArtifact: (runId: string) => void;
  openMessageArtifact: (messageId: string) => void;
}

export function useArtifactBinding({
  sessionId,
  runProjection,
  messages,
  runProjectionRef,
  messagesRef,
}: UseArtifactBindingParams): UseArtifactBindingResult {
  const [artifactOpenBinding, setArtifactOpenBinding] =
    useState<ArtifactOpenBinding | null>(null);
  const [artifactAnnounce, setArtifactAnnounce] = useState("");

  const closeArtifact = useCallback(() => {
    setArtifactOpenBinding((prev) => {
      if (prev) setArtifactAnnounce("Artifact closed");
      return clearArtifactBinding(prev);
    });
  }, []);

  const openRunArtifact = useCallback(
    (runId: string) => {
      if (!sessionId) return;
      const run = runProjectionRef.current.runsById[runId];
      const r = elevateArtifact(run?.finalAnswer ?? "");
      if (r.kind === "none") return;
      setArtifactOpenBinding((prev) =>
        openArtifactBinding(prev, {
          conversationId: sessionId,
          turn: { surface: "run", id: runId },
          contentKind: r.kind === "long-markdown" ? "long-markdown" : "rich-document",
        }),
      );
      setArtifactAnnounce("Artifact opened");
    },
    [sessionId],
  );

  const openMessageArtifact = useCallback(
    (messageId: string) => {
      if (!sessionId) return;
      const msg = messagesRef.current.find((m) => m.id === messageId);
      const r = elevateArtifact(msg?.content ?? "");
      if (r.kind === "none") return;
      setArtifactOpenBinding((prev) =>
        openArtifactBinding(prev, {
          conversationId: sessionId,
          turn: { surface: "message", id: messageId },
          contentKind: r.kind === "long-markdown" ? "long-markdown" : "rich-document",
        }),
      );
      setArtifactAnnounce("Artifact opened");
    },
    [sessionId],
  );

  const boundArtifact = useMemo(() => {
    if (!artifactOpenBinding || !sessionId) return null;
    if (artifactOpenBinding.conversationId !== sessionId) return null;
    const { turn } = artifactOpenBinding;
    if (turn.surface === "run") {
      const run = runProjection.runsById[turn.id];
      if (!run || run.sessionId !== sessionId) return null;
      const r = elevateArtifact(run.finalAnswer ?? "");
      if (r.kind === "none" || !r.body) return null;
      return { body: r.body, contentKind: r.kind as ArtifactContentKind };
    }
    const msg = messages.find((m) => m.id === turn.id);
    if (!msg) return null;
    const r = elevateArtifact(msg.content);
    if (r.kind === "none" || !r.body) return null;
    return { body: r.body, contentKind: r.kind as ArtifactContentKind };
  }, [artifactOpenBinding, sessionId, runProjection, messages]);

  useEffect(() => {
    if (!artifactOpenBinding) return;
    if (shouldClearOnConversationChange(artifactOpenBinding.conversationId, sessionId)) {
      setArtifactOpenBinding(null);
    }
  }, [sessionId, artifactOpenBinding]);

  useEffect(() => {
    if (!artifactOpenBinding) return;
    const present = new Set<string>();
    for (const id of runProjection.runOrder) {
      const run = runProjection.runsById[id];
      if (run?.sessionId === sessionId) present.add(run.runId);
    }
    for (const m of messages) present.add(m.id);
    if (shouldClearOnSourceGone(artifactOpenBinding.turn, present)) {
      setArtifactOpenBinding(null);
    }
  }, [artifactOpenBinding, runProjection, messages, sessionId]);

  return {
    artifactOpenBinding,
    setArtifactOpenBinding,
    boundArtifact,
    artifactAnnounce,
    closeArtifact,
    openRunArtifact,
    openMessageArtifact,
  };
}
