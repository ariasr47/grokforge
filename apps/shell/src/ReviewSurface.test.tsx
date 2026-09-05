import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import {
  ReviewSurface,
  composeAskFileMessage,
  composeCommitMessage,
  composeLineCommentMessage,
  type ReviewSurfaceProps,
} from "./ReviewSurface";
import type { ChangesDockFilesState, ChangesDockGitState, ChangesDockMember, ChangesDockVerifyState } from "./ChangesDock";
import type { PendingDiff } from "./runChangeList";
import { splitDiffHunks } from "./diffUtil";

afterEach(() => cleanup());

const TEST_DIFF =
  "--- a/src/OverviewStrip.test.ts\n+++ b/src/OverviewStrip.test.ts\n@@ -31,4 +32,4 @@ label expectations\n  it(\"labels turns\", () => {\n-   expect(label({ turns: 1 })).toBe(\"1 turn\");\n+   expect(label({ turnCount: 1 })).toBe(\"1 turn\");\n-   expect(label({ turns: 3 })).toBe(\"3 turns\");\n+   expect(label({ turnCount: 3 })).toBe(\"3 turns\");\n  });\n";

function member(overrides: Partial<ChangesDockMember> = {}): ChangesDockMember {
  return {
    editId: "e-1",
    path: "src/OverviewStrip.test.ts",
    kind: "content",
    fromPath: null,
    toPath: null,
    activityId: "a-1",
    invocationId: "i-1",
    requestId: null,
    diff: TEST_DIFF,
    settlement: "applied",
    recoveryAvailable: false,
    diffUnavailable: false,
    runId: "run-1",
    ...overrides,
  };
}

const EMPTY_VERIFY: ChangesDockVerifyState = { state: "ready", members: [], runLive: false };
const EMPTY_GIT: ChangesDockGitState = { state: "ready", members: [] };

function noop() {
  /* no-op */
}

function baseProps(overrides: Partial<ReviewSurfaceProps> = {}): ReviewSurfaceProps {
  return {
    threadTitle: "Fix typecheck in apps/shell",
    files: { state: "ready", members: [member()] } as ChangesDockFilesState,
    verify: EMPTY_VERIFY,
    git: EMPTY_GIT,
    diffQueue: [] as PendingDiff[],
    commitMessageDraft: null,
    onAccept: noop,
    onReject: noop,
    onAcceptAll: noop,
    onRejectAll: noop,
    onBack: noop,
    onSendToGrok: noop,
    ...overrides,
  };
}

describe("ReviewSurface — pure message composers", () => {
  it("composeLineCommentMessage: 'In <path> line N: <comment>' plus the hunk as context", () => {
    const hunk = splitDiffHunks(TEST_DIFF)[0]!;
    const text = composeLineCommentMessage("src/OverviewStrip.test.ts", 34, "Also cover turnCount: undefined.", hunk);
    assert.match(text, /^In src\/OverviewStrip\.test\.ts line 34: Also cover turnCount: undefined\./);
    // The hunk's own header and lines are included verbatim as context.
    assert.match(text, /@@ -31,4 \+32,4 @@/);
    assert.match(text, /turnCount: 3/);
  });

  it("composeLineCommentMessage: a synthetic hunk with no range header still includes its lines, no blank header line", () => {
    const hunk = { range: "", context: "", lines: [{ kind: "add" as const, no: 1, text: "+new line" }] };
    const text = composeLineCommentMessage("a.txt", 1, "why?", hunk);
    assert.equal(text, "In a.txt line 1: why?\n\n+new line");
  });

  it("composeAskFileMessage: 'In <path>: <message>'", () => {
    assert.equal(
      composeAskFileMessage("src/OverviewStrip.tsx", "keep the old key as a deprecated alias"),
      "In src/OverviewStrip.tsx: keep the old key as a deprecated alias",
    );
  });

  it("composeCommitMessage: fixed prompt prefix plus the message verbatim", () => {
    assert.equal(
      composeCommitMessage("Rename turns → turnCount in OverviewStrip"),
      "Commit the accepted files with this message:\n\nRename turns → turnCount in OverviewStrip",
    );
  });
});

describe("ReviewSurface — header", () => {
  it("shows the back button, title, meta line, and N of M accepted progress", () => {
    render(
      <ReviewSurface
        {...baseProps({
          files: {
            state: "ready",
            members: [
              member({ editId: "e-1", settlement: "accepted", diff: "--- a\n+++ b\n@@ -1,1 +1,2 @@\n+one\n+two\n" }),
              // "rejected", not "applied" — applied is committable too (see the
              // "every file applied" test below), so this must be a genuinely
              // unsettled file to keep this a real 1-of-2 partial-progress case.
              member({ editId: "e-2", path: "src/other.ts", settlement: "rejected", diff: "--- a\n+++ b\n@@ -1,1 +1,0 @@\n-gone\n" }),
            ],
          },
        })}
      />,
    );
    assert.ok(screen.getByRole("button", { name: "Thread" }));
    assert.ok(screen.getByText("Review changes"));
    const region = screen.getByRole("region", { name: "Review changes" });
    assert.match(region.textContent ?? "", /Fix typecheck in apps\/shell/);
    assert.match(region.textContent ?? "", /2 files/);
    assert.match(region.textContent ?? "", /\+2/);
    assert.match(region.textContent ?? "", /−1/);
    assert.ok(within(region).getByText("1 of 2 accepted"));
  });

  it("every file applied (no decisions ever needed — the ordinary trusted-workspace case) reads as fully accepted, and Commit is enabled", () => {
    const sent: string[] = [];
    render(
      <ReviewSurface
        {...baseProps({
          files: {
            state: "ready",
            members: [
              member({ editId: "e-1", settlement: "applied" }),
              member({ editId: "e-2", path: "src/other.ts", settlement: "applied" }),
            ],
          },
          commitMessageDraft: { subject: "Rename turns → turnCount", body: "" },
          onSendToGrok: (t) => sent.push(t),
        })}
      />,
    );
    const region = screen.getByRole("region", { name: "Review changes" });
    assert.ok(within(region).getByText("2 of 2 accepted"));
    const commitBtn = screen.getByRole("button", { name: /Commit 2 accepted files/ });
    assert.equal((commitBtn as HTMLButtonElement).disabled, false);
    fireEvent.click(commitBtn);
    assert.deepEqual(sent, ["Commit the accepted files with this message:\n\nRename turns → turnCount"]);
  });

  it("Thread back button calls onBack", () => {
    const calls: number[] = [];
    render(<ReviewSurface {...baseProps({ onBack: () => calls.push(1) })} />);
    fireEvent.click(screen.getByRole("button", { name: "Thread" }));
    assert.deepEqual(calls, [1]);
  });
});

describe("ReviewSurface — file list and diff column", () => {
  it("selects the first file by default and renders its hunks with range/context/lines", () => {
    render(<ReviewSurface {...baseProps()} />);
    assert.ok(screen.getByText("@@ -31,4 +32,4 @@"));
    assert.ok(screen.getByText("label expectations"));
    assert.ok(screen.getByText(/turnCount: 3/));
  });

  it("an auto-applied file (no permission gate) counts as accepted in the hunk sub-header, matching the header/dot/Commit button", () => {
    // W3-5: the default test member settles as "applied" (Trusted
    // workspace's ordinary case, no permission gate at all) — the sub-header
    // used to require the narrower "accepted" literal and read "N accepted"
    // as 0 while the header/Commit button already counted this file as
    // accepted via isSettledForCommit. Both must now agree.
    render(<ReviewSurface {...baseProps()} />);
    assert.ok(screen.getByText("Commit 1 accepted file"));
    assert.ok(screen.getByText(/1 hunk · 1 accepted/));
    assert.equal(screen.queryByText(/hunks? · 0 accepted/) === null, true);
    // The per-hunk badge (dbody) must agree too — same isSettledForCommit.
    assert.ok(document.querySelector(".hunk.accepted"));
  });

  it("clicking a different file row switches the diff column to that file", () => {
    render(
      <ReviewSurface
        {...baseProps({
          files: {
            state: "ready",
            members: [
              member({ editId: "e-1", path: "a.ts", diff: "--- a\n+++ b\n@@ -1,1 +1,1 @@\n-a-old\n+a-new\n" }),
              member({ editId: "e-2", path: "b.ts", diff: "--- a\n+++ b\n@@ -1,1 +1,1 @@\n-b-old\n+b-new\n" }),
            ],
          },
        })}
      />,
    );
    assert.ok(screen.getByText("a-new", { exact: false }));
    assert.equal(screen.queryByText("b-new", { exact: false }) === null, true);
    fireEvent.click(screen.getByText("b.ts", { exact: false }));
    assert.ok(screen.getByText("b-new", { exact: false }));
    assert.equal(screen.queryByText("a-new", { exact: false }) === null, true);
  });

  it("never renders a per-hunk Accept hunk / Reject button — the API only settles whole files", () => {
    render(<ReviewSurface {...baseProps()} />);
    assert.equal(screen.queryByRole("button", { name: /Accept hunk/ }) === null, true);
  });

  it("pending file backed by the diff queue shows Accept file ⇧A / Reject file ⇧R wired to onAccept/onReject with the request id", () => {
    const accepted: string[] = [];
    const rejected: string[] = [];
    render(
      <ReviewSurface
        {...baseProps({
          files: { state: "ready", members: [member({ settlement: "pending", requestId: "req-1" })] },
          diffQueue: [{ id: "req-1", path: "src/OverviewStrip.test.ts", diff: TEST_DIFF }],
          onAccept: (id) => accepted.push(id),
          onReject: (id) => rejected.push(id),
        })}
      />,
    );
    const acceptBtn = screen.getByRole("button", { name: /Accept file/ });
    const rejectBtn = screen.getByRole("button", { name: /Reject file/ });
    assert.ok(within(acceptBtn).getByText("⇧A"));
    assert.ok(within(rejectBtn).getByText("⇧R"));
    fireEvent.click(acceptBtn);
    fireEvent.click(rejectBtn);
    assert.deepEqual(accepted, ["req-1"]);
    assert.deepEqual(rejected, ["req-1"]);
  });

  it("pending file NOT backed by the diff queue (permission-gated) shows no fabricated accept/reject buttons", () => {
    render(
      <ReviewSurface
        {...baseProps({
          files: { state: "ready", members: [member({ settlement: "pending", requestId: "perm-1" })] },
          diffQueue: [],
        })}
      />,
    );
    assert.equal(screen.queryByRole("button", { name: /Accept file/ }) === null, true);
    assert.equal(screen.queryByRole("button", { name: /Reject file/ }) === null, true);
  });

  it("accepted file with recovery available shows Undo, not Accept/Reject file", () => {
    const reverted: ChangesDockMember[] = [];
    render(
      <ReviewSurface
        {...baseProps({
          files: { state: "ready", members: [member({ settlement: "accepted", recoveryAvailable: true })] },
          onRevert: (m) => reverted.push(m),
        })}
      />,
    );
    assert.equal(screen.queryByRole("button", { name: /Accept file/ }) === null, true);
    const undo = screen.getByRole("button", { name: "Undo" });
    fireEvent.click(undo);
    assert.equal(reverted.length, 1);
    assert.equal(reverted[0]!.editId, "e-1");
  });

  it("the file-list note claims only what Forge itself did, never git state it can't know", () => {
    // W3-4: Grok can shell out to git (e.g. `git add`) during a run — Forge
    // doesn't instrument that, so "nothing has touched git yet" is a claim
    // Forge cannot back. What Forge CAN vouch for unconditionally is that it
    // never runs git itself.
    render(<ReviewSurface {...baseProps()} />);
    assert.ok(
      screen.getByText("Edits are on disk, so checks run against them. Forge doesn’t run git itself."),
    );
    assert.equal(screen.queryByText(/touched git/) === null, true);
  });
});

describe("ReviewSurface — line comments", () => {
  it("clicking a line opens 'Comment on line N'; Send to Grok sends the composed message and closes the card", () => {
    const sent: string[] = [];
    render(<ReviewSurface {...baseProps({ onSendToGrok: (t) => sent.push(t) })} />);
    fireEvent.click(screen.getByText(/turnCount: 3/));
    assert.ok(screen.getByText("Comment on line 34"));
    const textarea = screen.getByRole("textbox", { name: /Comment on line 34/ });
    fireEvent.change(textarea, { target: { value: "Also cover turnCount: undefined." } });
    fireEvent.click(screen.getByRole("button", { name: /Send to Grok/ }));
    assert.equal(sent.length, 1);
    assert.match(sent[0]!, /^In src\/OverviewStrip\.test\.ts line 34: Also cover turnCount: undefined\./);
    assert.match(sent[0]!, /turnCount: 3/);
    // Card closes after sending.
    assert.equal(screen.queryByText("Comment on line 34") === null, true);
  });

  it("Ctrl+Enter in the comment textarea also sends", () => {
    const sent: string[] = [];
    render(<ReviewSurface {...baseProps({ onSendToGrok: (t) => sent.push(t) })} />);
    fireEvent.click(screen.getByText(/turnCount: 3/));
    const textarea = screen.getByRole("textbox", { name: /Comment on line 34/ });
    fireEvent.change(textarea, { target: { value: "why not undefined too?" } });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter", ctrlKey: true });
    assert.equal(sent.length, 1);
    assert.match(sent[0]!, /why not undefined too\?/);
  });

  it("Discard closes the card without sending", () => {
    const sent: string[] = [];
    render(<ReviewSurface {...baseProps({ onSendToGrok: (t) => sent.push(t) })} />);
    fireEvent.click(screen.getByText(/turnCount: 3/));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    assert.equal(sent.length, 0);
    assert.equal(screen.queryByText("Comment on line 34") === null, true);
  });
});

describe("ReviewSurface — ask-file field", () => {
  it("typing and pressing Enter sends 'In <path>: <message>'", () => {
    const sent: string[] = [];
    render(<ReviewSurface {...baseProps({ onSendToGrok: (t) => sent.push(t) })} />);
    const field = screen.getByRole("textbox", { name: /Ask Grok to change this file/ });
    fireEvent.change(field, { target: { value: "keep the old key as a deprecated alias" } });
    fireEvent.keyDown(field, { key: "Enter", code: "Enter" });
    assert.deepEqual(sent, ["In src/OverviewStrip.test.ts: keep the old key as a deprecated alias"]);
  });
});

describe("ReviewSurface — Verify and Git columns", () => {
  it("shows the raw output block labeled '<command> · raw output' only when output is actually captured", () => {
    render(
      <ReviewSurface
        {...baseProps({
          verify: {
            state: "ready", runLive: false,
            members: [
              { activityId: "v-1", invocationId: "vi-1", command: "npm test", execution: "executed", outcome: "pass", outcomeUnavailable: false },
              { activityId: "v-2", invocationId: "vi-2", command: "npm run typecheck", execution: "executed", outcome: "pass", outcomeUnavailable: false },
            ],
          },
          verifyOutputByActivityId: new Map([["v-1", "✓ labels a single turn\n✓ labels many turns"]]),
        })}
      />,
    );
    assert.ok(screen.getByText("npm test · raw output"));
    assert.ok(screen.getByText(/labels a single turn/));
    // v-2 has no captured output — Forge never fakes a body for it.
    assert.equal(screen.queryByText("npm run typecheck · raw output") === null, true);
  });

  it("claims all green only once the run is finished — never while checks are still in flight", () => {
    const passed = [
      { activityId: "v-1", invocationId: "vi-1", command: "npm test", execution: "executed", outcome: "pass", outcomeUnavailable: false },
    ] as const;
    // Run still live: every check REPORTED so far passed, but more may follow.
    const { unmount } = render(
      <ReviewSurface {...baseProps({ verify: { state: "ready", members: [...passed], runLive: true } })} />,
    );
    assert.equal(screen.queryByText("all green") === null, true);
    unmount();
    // Run finished: the claim is now something Forge can actually stand behind.
    render(<ReviewSurface {...baseProps({ verify: { state: "ready", members: [...passed], runLive: false } })} />);
    assert.ok(screen.getByText("all green"));
  });

  it("never claims all green when a finished run left a check unknown", () => {
    render(
      <ReviewSurface
        {...baseProps({
          verify: {
            state: "ready",
            runLive: false,
            members: [
              { activityId: "v-1", invocationId: "vi-1", command: "npm test", execution: "executed", outcome: "pass", outcomeUnavailable: false },
              { activityId: "v-2", invocationId: "vi-2", command: "npm run typecheck", execution: "executed", outcome: "unknown", outcomeUnavailable: true },
            ],
          },
        })}
      />,
    );
    assert.equal(screen.queryByText("all green") === null, true);
  });

  it("empty-message placeholder: with no commitMessageDraft, the field is empty with a placeholder, not an invented message", () => {
    render(<ReviewSurface {...baseProps({ commitMessageDraft: null })} />);
    const field = screen.getByRole("textbox", { name: /Commit message/ });
    assert.equal((field as HTMLTextAreaElement).value, "");
    assert.ok((field as HTMLTextAreaElement).placeholder.length > 0);
  });

  it("with a commitMessageDraft, the field is prefilled from it", () => {
    render(
      <ReviewSurface
        {...baseProps({
          commitMessageDraft: { subject: "Rename turns → turnCount in OverviewStrip", body: "" },
        })}
      />,
    );
    const field = screen.getByRole("textbox", { name: /Commit message/ }) as HTMLTextAreaElement;
    assert.match(field.value, /Rename turns → turnCount in OverviewStrip/);
  });

  it("commitMessageDraft arriving late (git/PR evidence loads after the surface is already open) is picked up by the field", () => {
    const { rerender } = render(<ReviewSurface {...baseProps({ commitMessageDraft: null })} />);
    assert.equal((screen.getByRole("textbox", { name: /Commit message/ }) as HTMLTextAreaElement).value, "");
    rerender(
      <ReviewSurface
        {...baseProps({
          commitMessageDraft: { subject: "Rename turns → turnCount in OverviewStrip", body: "" },
        })}
      />,
    );
    const field = screen.getByRole("textbox", { name: /Commit message/ }) as HTMLTextAreaElement;
    assert.match(field.value, /Rename turns → turnCount in OverviewStrip/);
  });

  it("commitMessageDraft arriving late does NOT overwrite text the operator already typed", () => {
    const { rerender } = render(<ReviewSurface {...baseProps({ commitMessageDraft: null })} />);
    const field = screen.getByRole("textbox", { name: /Commit message/ }) as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: "My own commit message" } });
    rerender(
      <ReviewSurface
        {...baseProps({
          commitMessageDraft: { subject: "Rename turns → turnCount in OverviewStrip", body: "" },
        })}
      />,
    );
    assert.equal(
      (screen.getByRole("textbox", { name: /Commit message/ }) as HTMLTextAreaElement).value,
      "My own commit message",
    );
  });

  it("Commit accepted files sends the fixed prompt plus the current field text, labeled with the accepted count", () => {
    const sent: string[] = [];
    render(
      <ReviewSurface
        {...baseProps({
          files: { state: "ready", members: [member({ settlement: "accepted" })] },
          commitMessageDraft: { subject: "Rename turns → turnCount", body: "" },
          onSendToGrok: (t) => sent.push(t),
        })}
      />,
    );
    const commitBtn = screen.getByRole("button", { name: /Commit 1 accepted file/ });
    fireEvent.click(commitBtn);
    assert.deepEqual(sent, ["Commit the accepted files with this message:\n\nRename turns → turnCount"]);
  });

  it("Commit is disabled when nothing is accepted yet", () => {
    render(<ReviewSurface {...baseProps({ files: { state: "ready", members: [member({ settlement: "pending" })] } })} />);
    const commitBtn = screen.getByRole("button", { name: /Commit 0 accepted files/ });
    assert.equal((commitBtn as HTMLButtonElement).disabled, true);
  });
});

describe("ReviewSurface — footer", () => {
  it("Reject all and Accept all call onRejectAll/onAcceptAll; Accept all shows the Ctrl+⇧A hint", () => {
    const calls: string[] = [];
    render(
      <ReviewSurface
        {...baseProps({ onAcceptAll: () => calls.push("accept-all"), onRejectAll: () => calls.push("reject-all") })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Reject all" }));
    const acceptAll = screen.getByRole("button", { name: /Accept all/ });
    assert.ok(within(acceptAll).getByText("Ctrl+⇧A"));
    fireEvent.click(acceptAll);
    assert.deepEqual(calls, ["reject-all", "accept-all"]);
  });

  it("shows the accept/reject footer summary line, scoped to files where recovery is actually available", () => {
    // W3-4: recoveryAvailable is only true when the engine reports it
    // (runChangeList.ts hardcodes false in six branches) — the default test
    // member (recoveryAvailable: false) is exactly that common case, so an
    // unqualified "Reject restores the copy" would already be false here.
    render(<ReviewSurface {...baseProps()} />);
    assert.ok(
      screen.getByText(
        "Accept keeps a file as Grok wrote it. Reject restores the copy Forge kept before the run, where available.",
      ),
    );
  });
});

describe("ReviewSurface — keyboard (A/R/⇧A/⇧R/Ctrl+⇧A on the surface itself)", () => {
  function pendingProps(overrides: Partial<ReviewSurfaceProps> = {}) {
    return baseProps({
      files: { state: "ready", members: [member({ settlement: "pending", requestId: "req-1" })] },
      diffQueue: [{ id: "req-1", path: "src/OverviewStrip.test.ts", diff: TEST_DIFF }],
      ...overrides,
    });
  }

  it("A accepts the focused (selected) file; R rejects it", () => {
    const accepted: string[] = [];
    render(<ReviewSurface {...pendingProps({ onAccept: (id) => accepted.push(id) })} />);
    fireEvent.keyDown(window, { key: "a", code: "KeyA" });
    assert.deepEqual(accepted, ["req-1"]);
  });

  it("⇧A / ⇧R (Shift+A / Shift+R) also accept/reject the selected file", () => {
    const rejected: string[] = [];
    render(<ReviewSurface {...pendingProps({ onReject: (id) => rejected.push(id) })} />);
    fireEvent.keyDown(window, { key: "R", code: "KeyR", shiftKey: true });
    assert.deepEqual(rejected, ["req-1"]);
  });

  it("Ctrl+Shift+A calls onAcceptAll", () => {
    const calls: number[] = [];
    render(<ReviewSurface {...pendingProps({ onAcceptAll: () => calls.push(1) })} />);
    fireEvent.keyDown(window, { key: "a", code: "KeyA", ctrlKey: true, shiftKey: true });
    assert.deepEqual(calls, [1]);
  });

  it("A/R do not fire while a text field inside the surface has focus (inEditable guard)", () => {
    const accepted: string[] = [];
    render(<ReviewSurface {...pendingProps({ onAccept: (id) => accepted.push(id) })} />);
    const askField = screen.getByRole("textbox", { name: /Ask Grok to change this file/ });
    fireEvent.keyDown(askField, { key: "a", code: "KeyA" });
    assert.deepEqual(accepted, []);
  });

  it("Ctrl+Shift+Enter commits (from outside any text field)", () => {
    const sent: string[] = [];
    render(
      <ReviewSurface
        {...pendingProps({
          files: { state: "ready", members: [member({ settlement: "accepted" })] },
          commitMessageDraft: { subject: "Rename turns → turnCount", body: "" },
          onSendToGrok: (t) => sent.push(t),
        })}
      />,
    );
    fireEvent.keyDown(window, { key: "Enter", code: "Enter", ctrlKey: true, shiftKey: true });
    assert.deepEqual(sent, ["Commit the accepted files with this message:\n\nRename turns → turnCount"]);
  });
});
