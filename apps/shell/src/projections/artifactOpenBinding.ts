export type ArtifactTurnRef =
  | { surface: "run"; id: string }
  | { surface: "message"; id: string };

export type ArtifactContentKind = "rich-document" | "long-markdown";

/** Session-local disclosure — never ChatSession.open (archived vs not). */
export type ArtifactOpenBinding = {
  conversationId: string;
  turn: ArtifactTurnRef;
  contentKind: ArtifactContentKind;
};

export function openArtifactBinding(
  _prev: ArtifactOpenBinding | null,
  next: ArtifactOpenBinding,
): ArtifactOpenBinding {
  return { ...next };
}

export function clearArtifactBinding(
  _prev: ArtifactOpenBinding | null,
): null {
  return null;
}

export function shouldClearOnConversationChange(
  prevConversationId: string | null,
  nextConversationId: string | null,
): boolean {
  if (!prevConversationId || !nextConversationId) return true;
  return prevConversationId !== nextConversationId;
}

export function shouldClearOnModeChange(
  _from: "chat" | "code",
  _to: "chat" | "code",
  prevConversationId: string | null,
  nextConversationId: string | null,
): boolean {
  return shouldClearOnConversationChange(prevConversationId, nextConversationId);
}

export function shouldClearOnSourceGone(
  turn: ArtifactTurnRef,
  presentIds: Set<string>,
): boolean {
  return !presentIds.has(turn.id);
}

export function bindingMatchesTurn(
  binding: ArtifactOpenBinding | null,
  turn: ArtifactTurnRef,
): boolean {
  return Boolean(
    binding &&
      binding.turn.surface === turn.surface &&
      binding.turn.id === turn.id,
  );
}
