// Flow-integration: Chat composer PDF attach (SPEC §3 AC-01/02/04a/05a/06a/09/11)
// and tool activity extract-failed paint. Mocks the network boundary only.
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { ToastProvider } from "../thread/Toast";
import { createFakeHost, FakeWebSocket } from "./testFakeHost";
import { reloadSessionsFromDisk } from "../lib/sessions";
import type { ActivityRecord, RunEventEnvelope } from "../projections/runReducer";
import {
  fixtureCorruptPdf,
  fixtureEmptyExtractPdf,
  fixtureEncryptedPdf,
  fixtureTextLayerPdf,
} from "@grokforge/pdf-extract/fixtures";

/**
 * A Contract v1 run-scoped envelope addressed at the exact run/session the
 * app just bound via bindNormalizedRun (see testFakeHost.ts's own
 * `lastPromptRun` doc). Once a real send admits through POST /api/prompt,
 * App.tsx's onServerEvent only reduces this shape — a bare unscoped
 * `{type, ...}` frame is deliberately ignored post-bind.
 */
function envelope(
  target: { runId: string; sessionId: string },
  seq: number,
  payload: RunEventEnvelope["payload"],
): RunEventEnvelope {
  return {
    schemaVersion: 1,
    type: payload.kind,
    sessionId: target.sessionId,
    runId: target.runId,
    eventSeq: seq,
    connectionGeneration: 1,
    occurredAt: "",
    payload,
  };
}

function resetBrowserState(): void {
  localStorage.clear();
  localStorage.setItem(
    "grokforge.firstRun",
    JSON.stringify({
      dismissed: true,
      openedFolder: true,
      signedIn: true,
      sentMessage: true,
      pickedMode: true,
      seenAt: new Date().toISOString(),
    }),
  );
  reloadSessionsFromDisk({ byWorkspace: {}, activeId: {}, pinned: [], expanded: [] });
  FakeWebSocket.reset();
}

function pdfFile(name: string, bytes: Uint8Array): File {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new File([copy.buffer], name, { type: "application/pdf" });
}

function attachViaPicker(files: File[]): void {
  const input = document.getElementById("composer-attach") as HTMLInputElement;
  assert.ok(input, "composer attach input");
  Object.defineProperty(input, "files", { configurable: true, value: files });
  fireEvent.change(input);
}

let originalFetch: typeof fetch;
let originalWebSocket: typeof WebSocket;

before(() => {
  originalFetch = globalThis.fetch;
  originalWebSocket = globalThis.WebSocket;
});

after(() => {
  globalThis.fetch = originalFetch;
  globalThis.WebSocket = originalWebSocket;
});

beforeEach(() => {
  resetBrowserState();
});

afterEach(() => {
  cleanup();
});

describe("Chat PDF attach journeys", () => {
  it("attaches a text PDF into the draft and the next send uses that text", async () => {
    const host = createFakeHost({ mode: "chat", workspace: null, busy: false });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(
      <ToastProvider>
        <App />
      </ToastProvider>,
    );
    const composer = await screen.findByLabelText("Message to agent");
    attachViaPicker([pdfFile("notes.pdf", await fixtureTextLayerPdf())]);

    await waitFor(() => {
      const value = (composer as HTMLTextAreaElement).value;
      // An attach now inserts the file as an @mention plus its contents in the
      // same shape a mention expands to — `@name` + MENTION_ATTACH_MARKER +
      // `--- File: name ---` (1341742, contextAttach.ts). The old
      // `--- Attached: name ---` block no longer exists anywhere.
      assert.match(value, /^\s*@notes\.pdf\b/);
      assert.match(value, /--- File: notes\.pdf ---/);
      assert.match(value, /--- End: notes\.pdf ---/);
      assert.match(value, /Hello PDF/);
      assert.doesNotMatch(value, /PDF binary not extracted/);
    });
    await waitFor(() => {
      assert.ok(screen.getByText("Attached 1 file as text"));
    });
    assert.equal(
      host.callsTo("/api/chat-pack").filter((c) => c.body?.action === "pin_file").length,
      0,
      "composer PDF extract must not pin a pack member",
    );
    assert.equal(screen.queryByText(/OCR/i) === null, true);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      const prompts = host.callsTo("/api/prompt");
      assert.ok(prompts.length >= 1);
      const text = String(prompts[prompts.length - 1]!.body?.text ?? "");
      assert.match(text, /--- File: notes\.pdf ---/);
      assert.match(text, /Hello PDF/);
    });
  });

  it("toasts extract-failed as-is for encrypted / empty-extract / unreadable without an Attached block", async () => {
    const host = createFakeHost({ mode: "chat", workspace: null, busy: false });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(
      <ToastProvider>
        <App />
      </ToastProvider>,
    );
    const composer = await screen.findByLabelText("Message to agent");

    attachViaPicker([pdfFile("secret.pdf", await fixtureEncryptedPdf())]);
    await waitFor(() => {
      assert.ok(
        screen.getByText(
          "Couldn't extract text from secret.pdf. (encrypted) Export to .txt/.md or paste the text.",
        ),
      );
    });
    assert.doesNotMatch((composer as HTMLTextAreaElement).value, /--- File: secret\.pdf ---/);
    assert.equal(screen.queryByText(/^secret\.pdf:/) === null, true);

    attachViaPicker([pdfFile("scan.pdf", await fixtureEmptyExtractPdf())]);
    await waitFor(() => {
      assert.ok(
        screen.getByText(
          "Couldn't extract text from scan.pdf. (empty-extract) Export to .txt/.md or paste the text.",
        ),
      );
    });
    assert.doesNotMatch((composer as HTMLTextAreaElement).value, /--- File: scan\.pdf ---/);

    attachViaPicker([pdfFile("bad.pdf", fixtureCorruptPdf())]);
    await waitFor(() => {
      assert.ok(
        screen.getByText(
          "Couldn't extract text from bad.pdf. (unreadable) Export to .txt/.md or paste the text.",
        ),
      );
    });
    assert.doesNotMatch((composer as HTMLTextAreaElement).value, /--- File: bad\.pdf ---/);
    assert.equal(screen.queryByText(/OCR/i) === null, true);
  });

  it("keeps a successful sibling when a PDF extract-fails in the same attach", async () => {
    const host = createFakeHost({ mode: "chat", workspace: null, busy: false });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(
      <ToastProvider>
        <App />
      </ToastProvider>,
    );
    const composer = await screen.findByLabelText("Message to agent");
    attachViaPicker([
      pdfFile("ok.pdf", await fixtureTextLayerPdf()),
      pdfFile("bad.pdf", await fixtureEncryptedPdf()),
    ]);

    await waitFor(() => {
      const value = (composer as HTMLTextAreaElement).value;
      // Same shape as above. Matching the block that ships also makes the
      // exclusion real: against the old `--- Attached: ---` wording it passed
      // whatever happened, because no block used that wording any more.
      assert.match(value, /--- File: ok\.pdf ---/);
      assert.match(value, /Hello PDF/);
      assert.doesNotMatch(value, /--- File: bad\.pdf ---/);
      assert.doesNotMatch(value, /@bad\.pdf/);
    });
    await waitFor(() => {
      assert.ok(screen.getByText("Attached 1 file as text"));
      assert.ok(
        screen.getByText(
          "Couldn't extract text from bad.pdf. (encrypted) Export to .txt/.md or paste the text.",
        ),
      );
    });
    assert.equal(screen.queryByText(/^bad\.pdf:/) === null, true);
  });

  it("paints agent read_file extract-failed as settled failed with vouched class", async () => {
    const host = createFakeHost({ mode: "chat", workspace: null, busy: false });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    render(
      <ToastProvider>
        <App />
      </ToastProvider>,
    );
    const user = userEvent.setup();
    const composer = await screen.findByLabelText("Message to agent");
    await user.type(composer, "read the pdf");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => assert.ok(host.callsTo("/api/prompt").length >= 1));
    await waitFor(() => assert.ok(FakeWebSocket.latest()));
    const ws = FakeWebSocket.latest()!;
    await waitFor(() => assert.ok(host.lastPromptRun));
    const target = host.lastPromptRun!;
    const output = JSON.stringify({
      path: "enc.pdf",
      bytes: 0,
      content: "",
      extract_failed: true,
      extract_failure_class: "encrypted",
      error: "Couldn't extract text from enc.pdf.",
    });
    const pendingActivity: ActivityRecord = {
      activityId: "pdf-extract-act",
      invocationId: "pdf-extract-1",
      name: "read_file",
      lifecycle: "pending",
      execution: null,
      status: "running",
      input: { path: "enc.pdf" },
      output: null,
      error: null,
      diff: null,
      path: null,
      policy: {},
      automaticEligibility: "not_eligible",
      autoApplied: false,
      command: null,
      editId: null,
      recovery: null,
      summary: "enc.pdf",
    };
    const failedActivity: ActivityRecord = {
      ...pendingActivity,
      lifecycle: "terminal",
      execution: "executed",
      status: "failed",
      output,
      error: "Couldn't extract text from enc.pdf.",
    };
    ws.emit(envelope(target, 1, { kind: "activity_update", activity: pendingActivity }) as unknown as Record<string, unknown>);
    ws.emit(envelope(target, 2, { kind: "activity_update", activity: failedActivity }) as unknown as Record<string, unknown>);

    await waitFor(() => {
      assert.ok(document.querySelector(".ri-dot.tone-fail"), "row must be marked failed, not settled clean");
      assert.ok(screen.getByText("Couldn't extract text from enc.pdf. (encrypted)"));
    });
    assert.equal(screen.queryByText(/OCR/i) === null, true);
  });
});
