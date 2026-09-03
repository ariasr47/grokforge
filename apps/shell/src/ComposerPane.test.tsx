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
  onAttachFiles: () => undefined,
  busy: false,
  onCancel: () => undefined,
  onSend: () => undefined,
  onQueue: () => undefined,
  onCancelQueued: () => undefined,
  queuedCount: 0,
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
    assert.ok(screen.getByRole("button", { name: "Stop" }));
    assert.equal(screen.queryByRole("button", { name: "Send" }), null);
  });
});

describe("ComposerPane growth: one row idle, two rows once the draft grows", () => {
  it("idle composer is one 46px row, rows=1, and carries the one-row layout class", () => {
    render(<ComposerPane {...base} />);
    const composer = screen.getByLabelText("Message to agent") as HTMLTextAreaElement;
    assert.equal(composer.rows, 1);
    assert.ok(composer.closest(".composer")?.classList.contains("one"));
  });

  it("a newline in the draft grows the composer past one row", () => {
    render(<ComposerPane {...base} draft={"first line\nsecond line"} />);
    const composer = screen.getByLabelText("Message to agent") as HTMLTextAreaElement;
    assert.equal(composer.rows, 1);
    assert.equal(composer.closest(".composer")?.classList.contains("one"), false);
  });

  it("shrinks back to the one-row layout once the newline is removed", () => {
    const { rerender } = render(<ComposerPane {...base} draft={"a\nb"} />);
    assert.equal(
      screen.getByLabelText("Message to agent").closest(".composer")?.classList.contains("one"),
      false,
    );
    rerender(<ComposerPane {...base} draft="a" />);
    assert.equal(
      screen.getByLabelText("Message to agent").closest(".composer")?.classList.contains("one"),
      true,
    );
  });
});

describe("ComposerPane placeholders (exact copy)", () => {
  it("Code idle: Ask Grok to change something…", () => {
    render(<ComposerPane {...base} />);
    assert.equal(
      (screen.getByLabelText("Message to agent") as HTMLTextAreaElement).placeholder,
      "Ask Grok to change something… @ file · / command",
    );
  });

  it("Code while a decision is pending: Reply or steer Grok…", () => {
    render(<ComposerPane {...base} decisionPending />);
    assert.equal(
      (screen.getByLabelText("Message to agent") as HTMLTextAreaElement).placeholder,
      "Reply or steer Grok… @ file · / command",
    );
  });

  it("a pending decision never leaks the placeholder into Chat mode", () => {
    render(<ComposerPane {...base} productMode="chat" decisionPending chatHomeLabel="Family admin" />);
    assert.equal(
      (screen.getByLabelText("Message to agent") as HTMLTextAreaElement).placeholder,
      "Message Family admin… paste text, drop a PDF",
    );
  });

  it("Chat idle names the current home", () => {
    render(<ComposerPane {...base} productMode="chat" chatHomeLabel="Family admin" />);
    assert.equal(
      (screen.getByLabelText("Message to agent") as HTMLTextAreaElement).placeholder,
      "Message Family admin… paste text, drop a PDF",
    );
  });

  it("Chat without a home label falls back to a real word, not an empty gap", () => {
    render(<ComposerPane {...base} productMode="chat" />);
    assert.equal(
      (screen.getByLabelText("Message to agent") as HTMLTextAreaElement).placeholder,
      "Message Chat… paste text, drop a PDF",
    );
  });
});

describe("ComposerPane empty-draft placeholder", () => {
  it("keeps Code placeholder copy while Send stays disabled", () => {
    render(
      <ComposerPane {...base} sendDisabledReason="Type a message to send" />,
    );
    const composer = screen.getByLabelText("Message to agent") as HTMLTextAreaElement;
    assert.equal(
      composer.placeholder,
      "Ask Grok to change something… @ file · / command",
    );
    const send = screen.getByRole("button", { name: "Send" });
    assert.equal(send.hasAttribute("disabled"), true);
    assert.equal(send.getAttribute("title"), "Type a message to send");
  });

  it("keeps Chat placeholder copy while Send stays disabled", () => {
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
      "Message Chat… paste text, drop a PDF",
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

describe("ComposerPane while busy: Queue and Stop, never Steer, never Send", () => {
  it("busy with an empty draft shows a disabled Queue and an active Stop", () => {
    render(<ComposerPane {...base} busy />);
    assert.equal(screen.queryByRole("button", { name: "Send" }), null);
    assert.equal(screen.queryByRole("button", { name: /steer/i }), null);
    const queue = screen.getByRole("button", { name: "Queue" });
    assert.equal(queue.hasAttribute("disabled"), true);
    assert.equal(screen.getByRole("button", { name: "Stop" }).hasAttribute("disabled"), false);
  });

  it("busy with draft text enables Queue; clicking it calls onQueue", () => {
    let queued = false;
    render(
      <ComposerPane
        {...base}
        busy
        draft="ship this next"
        onQueue={() => {
          queued = true;
        }}
      />,
    );
    const queue = screen.getByRole("button", { name: "Queue" });
    assert.equal(queue.hasAttribute("disabled"), false);
    fireEvent.click(queue);
    assert.equal(queued, true);
  });

  it("Stop still cancels the run while busy", () => {
    let cancelled = false;
    render(
      <ComposerPane
        {...base}
        busy
        onCancel={() => {
          cancelled = true;
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    assert.equal(cancelled, true);
  });

  it("a queued message shows Queued · 1 instead of the Queue button, and can be cancelled", () => {
    let cancelled = false;
    render(
      <ComposerPane
        {...base}
        busy
        queuedCount={1}
        onCancelQueued={() => {
          cancelled = true;
        }}
      />,
    );
    assert.equal(screen.queryByRole("button", { name: "Queue" }), null);
    const queuedChip = screen.getByRole("button", { name: "Queued · 1" });
    fireEvent.click(queuedChip);
    assert.equal(cancelled, true);
    assert.ok(screen.getByRole("button", { name: "Stop" }));
  });

  it("idle (not busy) never shows Queue, Queued, or Stop", () => {
    render(<ComposerPane {...base} />);
    assert.equal(screen.queryByRole("button", { name: "Queue" }), null);
    assert.equal(screen.queryByRole("button", { name: "Stop" }), null);
    assert.equal(screen.queryByText(/Queued ·/), null);
  });

  it("a still-held draft stays surfaced as Queued even once its own run has ended", () => {
    // The run this draft was queued behind already went idle, but the flush
    // itself hasn't gone through (e.g. still offline) — App.tsx keeps
    // queuedCount > 0 in that case, and the chip must not vanish just
    // because `busy` dropped out from under it (that would silently
    // un-surface a message that is still only queued, never sent). Send
    // returns instead of Stop, since idle can compose a fresh message too.
    let cancelled = false;
    render(
      <ComposerPane
        {...base}
        busy={false}
        queuedCount={1}
        onCancelQueued={() => {
          cancelled = true;
        }}
      />,
    );
    const queuedChip = screen.getByRole("button", { name: "Queued · 1" });
    assert.equal(screen.queryByRole("button", { name: "Queue" }), null);
    assert.equal(screen.queryByRole("button", { name: "Stop" }), null);
    assert.ok(screen.getByRole("button", { name: "Send" }));
    fireEvent.click(queuedChip);
    assert.equal(cancelled, true);
  });
});

describe("ComposerPane has no Export control", () => {
  it("idle composer never renders an Export button — it lives in the thread header", () => {
    render(<ComposerPane {...base} />);
    assert.equal(screen.queryByRole("button", { name: /export/i }), null);
  });

  it("busy composer never renders an Export button either", () => {
    render(<ComposerPane {...base} busy queuedCount={1} />);
    assert.equal(screen.queryByRole("button", { name: /export/i }), null);
  });
});

describe("ComposerPane chip and context-ring mount points", () => {
  it("renders whatever chips App.tsx composes beside the field", () => {
    render(<ComposerPane {...base} chips={<button type="button">Plan</button>} />);
    assert.ok(screen.getByRole("button", { name: "Plan" }));
  });

  it("context ring renders nothing when no usage data exists", () => {
    render(<ComposerPane {...base} />);
    assert.equal(document.querySelector(".ring"), null);
  });

  it("context ring renders whatever App.tsx provides once usage data exists", () => {
    render(<ComposerPane {...base} contextRing={<span className="ring">41%</span>} />);
    assert.ok(document.querySelector(".ring"));
  });
});

describe("ComposerPane meta line: one mono line, facts left, shortcuts right", () => {
  it("renders the provided facts and the idle shortcut hint", () => {
    render(<ComposerPane {...base} metaFacts={<span>policy sentence · grok-4.6</span>} />);
    const meta = document.querySelector(".cmeta");
    assert.ok(meta);
    const text = meta?.textContent ?? "";
    assert.ok(text.includes("policy sentence · grok-4.6"));
    assert.ok(text.includes("⏎ send"));
    assert.ok(text.includes("⇧⏎ line"));
    assert.ok(text.includes("Ctrl+K commands"));
  });

  it("the shortcut hint swaps to queue/stop while busy and drops send/line/commands", () => {
    render(<ComposerPane {...base} busy />);
    const text = document.querySelector(".cmeta")?.textContent ?? "";
    assert.ok(text.includes("⇧⏎ queue"));
    assert.ok(text.includes("esc stop"));
    assert.equal(text.includes("⏎ send"), false);
    assert.equal(text.includes("Ctrl+K commands"), false);
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
