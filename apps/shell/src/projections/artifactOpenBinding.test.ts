import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clearArtifactBinding,
  openArtifactBinding,
  shouldClearOnConversationChange,
  shouldClearOnModeChange,
  shouldClearOnSourceGone,
  type ArtifactOpenBinding,
  type ArtifactTurnRef,
} from "./artifactOpenBinding.js";

const convA = "sess-a";
const convB = "sess-b";
const runTurn: ArtifactTurnRef = { surface: "run", id: "run-1" };
const msgTurn: ArtifactTurnRef = { surface: "message", id: "msg-1" };

describe("artifactOpenBinding", () => {
  it("open sets single binding; open another replaces (no stack)", () => {
    let b: ArtifactOpenBinding | null = null;
    b = openArtifactBinding(b, {
      conversationId: convA,
      turn: runTurn,
      contentKind: "rich-document",
    });
    assert.equal(b?.turn.id, "run-1");
    b = openArtifactBinding(b, {
      conversationId: convA,
      turn: msgTurn,
      contentKind: "long-markdown",
    });
    assert.equal(b?.turn.id, "msg-1");
    assert.equal(b?.contentKind, "long-markdown");
  });

  it("close / source-gone / regenerate clear to null (not open-error)", () => {
    let b: ArtifactOpenBinding | null = openArtifactBinding(null, {
      conversationId: convA,
      turn: runTurn,
      contentKind: "rich-document",
    });
    b = clearArtifactBinding(b);
    assert.equal(b, null);
    assert.equal(shouldClearOnSourceGone(runTurn, new Set()), true);
    assert.equal(shouldClearOnSourceGone(runTurn, new Set(["run-1"])), false);
  });

  it("conversation switch clears; return does not restore (caller starts null)", () => {
    assert.equal(shouldClearOnConversationChange(convA, convB), true);
    assert.equal(shouldClearOnConversationChange(convA, convA), false);
  });

  it("Chat↔Code mode switch on same conversation does not clear", () => {
    assert.equal(shouldClearOnModeChange("chat", "code", convA, convA), false);
    assert.equal(shouldClearOnModeChange("chat", "code", convA, convB), true);
  });

  it("binding shape never uses ChatSession.open field name", () => {
    const b = openArtifactBinding(null, {
      conversationId: convA,
      turn: runTurn,
      contentKind: "rich-document",
    });
    assert.equal(Object.prototype.hasOwnProperty.call(b, "open"), false);
    assert.equal("conversationId" in (b as object), true);
  });
});
