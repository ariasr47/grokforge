import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import {
  ComposerPane,
  EMPTY_DRAFT_SEND,
  atMenuKeyAction,
  composerBlockReasonVisible,
  draftIsSendReady,
} from "./ComposerPane";
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

describe("ComposerPane empty-draft placeholder", () => {
  it("empty Code composer is two rows, not a tall three-row pill", () => {
    render(<ComposerPane {...base} />);
    const composer = screen.getByLabelText("Message to agent") as HTMLTextAreaElement;
    assert.equal(composer.rows, 2);
  });

  it("compact density uses a one-row composer", () => {
    render(<ComposerPane {...base} densityCompact />);
    const composer = screen.getByLabelText("Message to agent") as HTMLTextAreaElement;
    assert.equal(composer.rows, 1);
  });

  it("keeps Code continuum copy while Send stays disabled", () => {
    render(
      <ComposerPane {...base} sendDisabledReason="Type a message to send" />,
    );
    const composer = screen.getByLabelText("Message to agent") as HTMLTextAreaElement;
    assert.equal(
      composer.placeholder,
      "Speak into the continuum… @file · attach · Enter send",
    );
    const send = screen.getByRole("button", { name: "Send" });
    assert.equal(send.hasAttribute("disabled"), true);
    assert.equal(send.getAttribute("title"), "Type a message to send");
  });

  it("keeps Chat continuum copy while Send stays disabled", () => {
    render(
      <ComposerPane
        {...base}
        productMode="chat"
        sendDisabledReason="Type a message to send"
      />,
    );
    const composer = screen.getByLabelText("Message to agent") as HTMLTextAreaElement;
    assert.equal(
      composer.placeholder,
      "Speak into the continuum… paste text, attach .txt/.md",
    );
  });

  it("uses a real lock reason as placeholder when the draft is empty", () => {
    render(
      <ComposerPane
        {...base}
        sendDisabledReason="Open a project folder first"
      />,
    );
    const composer = screen.getByLabelText("Message to agent") as HTMLTextAreaElement;
    assert.equal(composer.placeholder, "Open a project folder first");
    assert.equal(screen.getByRole("button", { name: "Send" }).hasAttribute("disabled"), true);
  });
});

describe("draftIsSendReady", () => {
  it("rejects empty and bare @ mentions", () => {
    assert.equal(draftIsSendReady(""), false);
    assert.equal(draftIsSendReady("   "), false);
    assert.equal(draftIsSendReady("@"), false);
    assert.equal(draftIsSendReady("@AGENTS.md"), false);
    assert.equal(draftIsSendReady("/"), false);
    assert.equal(draftIsSendReady("/compact"), false);
    assert.equal(draftIsSendReady("/session-info"), false);
  });
  it("accepts an exact catalog skill with no extra args", () => {
    assert.equal(draftIsSendReady("/session-info", ["/session-info", "/compact"]), true);
    assert.equal(draftIsSendReady("/compact", ["/compact"]), true);
    assert.equal(draftIsSendReady("/sess", ["/session-info"]), false);
    assert.equal(draftIsSendReady("/", ["/session-info"]), false);
  });
  it("accepts a message with or without a mention", () => {
    assert.equal(draftIsSendReady("hello"), true);
    assert.equal(draftIsSendReady("@AGENTS.md summarize this"), true);
    assert.equal(draftIsSendReady("/compact save context"), true);
  });
});

describe("composerBlockReasonVisible", () => {
  it("does not shout Type a message to send under a bare @ draft", () => {
    assert.equal(composerBlockReasonVisible(null, ""), false);
    assert.equal(composerBlockReasonVisible(EMPTY_DRAFT_SEND, ""), false);
    assert.equal(composerBlockReasonVisible(EMPTY_DRAFT_SEND, "@"), false);
    assert.equal(composerBlockReasonVisible(EMPTY_DRAFT_SEND, "@AGENTS.md "), false);
    assert.equal(composerBlockReasonVisible("Open a project folder first", "hello"), true);
  });
});

describe("ComposerPane @file menu", () => {
  it("clicking a mention calls onInsertAt with the path", () => {
    const seen: string[] = [];
    render(
      <ComposerPane
        {...base}
        atSuggestions={["AGENTS.md", ".gitignore"]}
        onInsertAt={(f) => seen.push(f)}
      />,
    );
    fireEvent.click(screen.getByRole("option", { name: "@AGENTS.md" }));
    assert.deepEqual(seen, ["AGENTS.md"]);
    assert.ok(screen.getByRole("listbox", { name: "File mentions" }));
  });

  it("ArrowDown highlights the next path; Enter inserts that path, not the first", () => {
    const seen: string[] = [];
    let active = 0;
    const view = (index: number) => (
      <ComposerPane
        {...base}
        atSuggestions={["AGENTS.md", ".gitignore"]}
        atActiveIndex={index}
        onAtActiveIndexChange={(i) => {
          active = i;
        }}
        onDismissAt={() => {
          seen.push("dismiss");
        }}
        onInsertAt={(f) => seen.push(f)}
      />
    );
    const { rerender } = render(view(0));
    const composer = screen.getByLabelText("Message to agent");
    assert.equal(
      screen.getByRole("option", { name: "@AGENTS.md" }).getAttribute("aria-selected"),
      "true",
    );
    assert.equal(
      screen.getByRole("option", { name: "@.gitignore" }).getAttribute("aria-selected"),
      "false",
    );

    fireEvent.keyDown(composer, { key: "ArrowDown" });
    assert.deepEqual(seen, []);
    assert.equal(active, 1);
    rerender(view(1));
    assert.equal(
      screen.getByRole("option", { name: "@AGENTS.md" }).getAttribute("aria-selected"),
      "false",
    );
    assert.equal(
      screen.getByRole("option", { name: "@.gitignore" }).getAttribute("aria-selected"),
      "true",
    );

    fireEvent.keyDown(composer, { key: "Enter" });
    assert.deepEqual(seen, [".gitignore"]);
  });

  it("Escape dismisses the menu without inserting", () => {
    const seen: string[] = [];
    render(
      <ComposerPane
        {...base}
        atSuggestions={["AGENTS.md"]}
        onDismissAt={() => seen.push("dismiss")}
        onInsertAt={(f) => seen.push(f)}
      />,
    );
    fireEvent.keyDown(screen.getByLabelText("Message to agent"), { key: "Escape" });
    assert.deepEqual(seen, ["dismiss"]);
  });
});

describe("atMenuKeyAction", () => {
  const files = ["AGENTS.md", ".gitignore", "README.md"];
  it("ArrowDown/Up move highlight; Tab/Enter insert; Escape closes", () => {
    assert.deepEqual(atMenuKeyAction("ArrowDown", files, 0), { type: "move", index: 1 });
    assert.deepEqual(atMenuKeyAction("ArrowUp", files, 0), { type: "move", index: 2 });
    assert.deepEqual(atMenuKeyAction("Tab", files, 1), { type: "insert", file: ".gitignore" });
    assert.deepEqual(atMenuKeyAction("Enter", files, 0), { type: "insert", file: "AGENTS.md" });
    assert.deepEqual(atMenuKeyAction("Escape", files, 0), { type: "close" });
    assert.equal(atMenuKeyAction("ArrowDown", [], 0), null);
  });
});
