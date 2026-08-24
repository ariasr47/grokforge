import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { cleanup, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { ComposerPane } from "./ComposerPane";
import { SETTLE_CARD_BELOW } from "./copyDock.js";

afterEach(() => cleanup());

const base = {
  dragOver: false,
  onDragOver: () => undefined,
  onDragLeave: () => undefined,
  onDrop: () => undefined,
  atSuggestions: [] as string[],
  onInsertAt: () => undefined,
  composerRef: createRef<HTMLTextAreaElement | null>(),
  draft: "",
  onDraftChange: () => undefined,
  onComposerKeyDown: () => undefined,
  sendDisabledReason: null as string | null,
  productMode: "code",
  connected: true,
  densityCompact: false,
  onAttachFiles: () => undefined,
  busy: false,
  hasMessages: false,
  onExportChat: () => undefined,
  onCancel: () => undefined,
  onSend: () => undefined,
  footer: null,
};

describe("ComposerPane dock lock", () => {
  it("disables typing while a dock card owns the turn", () => {
    render(
      <ComposerPane
        {...base}
        busy
        lockedReason={SETTLE_CARD_BELOW}
        sendDisabledReason={SETTLE_CARD_BELOW}
      />,
    );
    const composer = screen.getByLabelText("Message to agent") as HTMLTextAreaElement;
    assert.equal(composer.disabled, true);
    assert.equal(composer.placeholder, SETTLE_CARD_BELOW);
    assert.ok(screen.getByRole("button", { name: "Cancel" }));
    assert.equal(screen.queryByRole("button", { name: "Send" }), null);
  });
});
