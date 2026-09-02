import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { createFakeHost, FakeWebSocket } from "./testFakeHost";
import { reloadSessionsFromDisk } from "./sessions";
import {
  CODE_AGENT_CHECKING,
  CODE_AGENT_FALLBACK_CLI,
  CODE_AGENT_HARD_FAIL,
  CODE_AGENT_OFFLINE,
  CODE_AGENT_VENDOR,
} from "./codeAgentComposer";
import { CODE_RUN_VENDOR, CODE_RUN_FALLBACK } from "./codeRunProvenance";
import type { CodeAgentFact } from "./api";
import type { RunEventEnvelope, RunSnapshot } from "./runReducer";

const WORKSPACE = "C:\\repo";
const SESSION_ID = "code-agent-session";
const RUN_ID = "code-agent-run";

const vendorFact: CodeAgentFact = {
  resolveStatus: "ready",
  identity: "vendor",
  fallbackReason: null,
};
const fallbackCliFact: CodeAgentFact = {
  resolveStatus: "ready",
  identity: "fallback",
  fallbackReason: "cli_missing",
};
const hardFailFact: CodeAgentFact = {
  resolveStatus: "hard_fail",
  identity: "hard_fail",
  fallbackReason: null,
};

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
  reloadSessionsFromDisk({
    byWorkspace: {
      [WORKSPACE]: [{
        id: SESSION_ID,
        workspace: WORKSPACE,
        title: "Code agent",
        messages: [{ id: "u1", role: "user", content: "hello" }],
        updatedAt: Date.now(),
        status: "live",
        subagents: [],
        open: true,
      }],
    },
    activeId: { [WORKSPACE]: SESSION_ID },
    pinned: [WORKSPACE],
    expanded: [WORKSPACE],
  });
  FakeWebSocket.reset();
}

function runSnapshot(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    sessionId: SESSION_ID,
    runId: RUN_ID,
    connectionGeneration: 1,
    state: "running",
    acceptedPrompt: "hello",
    admittedAt: "",
    updatedAt: "",
    lastEventSeq: 1,
    policy: { effectiveMode: "review" },
    model: { id: "grok-4.6" },
    terminalKind: null,
    finalAnswer: null,
    answerVouched: false,
    failure: null,
    ...overrides,
  };
}

function envelope(payload: RunEventEnvelope["payload"], seq: number, runId = RUN_ID): RunEventEnvelope {
  return {
    schemaVersion: 1,
    type: payload.kind,
    sessionId: SESSION_ID,
    runId,
    eventSeq: seq,
    connectionGeneration: 1,
    occurredAt: "",
    payload,
  };
}

function footerText(): string {
  return document.querySelector(".composer-footer")?.textContent ?? "";
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

describe("spawn-grok-agent — composer voucher + Send gates", () => {
  it("Code vendor + pre-acquire connected:false + no host key: Grok Code chip, Send not Sign-in/Engine offline", async () => {
    const host = createFakeHost({
      mode: "code",
      workspace: WORKSPACE,
      workspaceName: "repo",
      busy: false,
      connected: false,
      hasApiKey: false,
      authMode: "signed_out",
      codeAgent: vendorFact,
    });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    render(<App />);
    await screen.findByLabelText("Message to agent");
    await waitFor(() => {
      assert.ok(screen.getByText(CODE_AGENT_VENDOR));
      assert.equal(screen.queryByText(CODE_AGENT_OFFLINE), null);
    });
    assert.ok(document.querySelector("[data-code-agent='vendor']")?.classList.contains("is-quiet"));
    assert.ok(document.querySelector(".composer-identity"));
    assert.equal(screen.queryByText(CODE_AGENT_FALLBACK_CLI), null);
    assert.equal(screen.queryByText(CODE_AGENT_CHECKING), null);
    const user = userEvent.setup({ delay: null });
    await user.type(screen.getByLabelText("Message to agent"), "ship it");
    const send = screen.getByRole("button", { name: "Send" });
    const reason = send.getAttribute("title") || "";
    assert.equal(send.hasAttribute("disabled"), false);
    assert.doesNotMatch(reason, /sign in/i);
    assert.doesNotMatch(reason, /engine offline/i);
    assert.equal(screen.queryByText(/Engine offline/i), null);
  });

  it("Code fallback without host key still Sign-in gated; chip is Mini-Grok not vendor", async () => {
    const host = createFakeHost({
      mode: "code",
      workspace: WORKSPACE,
      workspaceName: "repo",
      busy: false,
      connected: false,
      hasApiKey: false,
      authMode: "signed_out",
      agentName: "Grok Code",
      codeAgent: fallbackCliFact,
    });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    render(<App />);
    await screen.findByLabelText("Message to agent");
    await waitFor(() => {
      assert.ok(screen.getByText(CODE_AGENT_FALLBACK_CLI));
    });
    assert.equal(
      document.querySelector("[data-code-agent='fallback']")?.classList.contains("is-quiet") ?? false,
      false,
    );
    assert.equal(screen.queryByText(CODE_AGENT_VENDOR), null);
    const user = userEvent.setup({ delay: null });
    await user.type(screen.getByLabelText("Message to agent"), "hello");
    const send = screen.getByRole("button", { name: "Send" });
    assert.equal(send.hasAttribute("disabled"), true);
    assert.match(send.getAttribute("title") || "", /sign in/i);
  });

  it("Code hard_fail disables Send with Couldn't start an agent for Code.", async () => {
    const host = createFakeHost({
      mode: "code",
      workspace: WORKSPACE,
      workspaceName: "repo",
      busy: false,
      connected: false,
      hasApiKey: true,
      codeAgent: hardFailFact,
    });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    render(<App />);
    await screen.findByLabelText("Message to agent");
    await waitFor(() => {
      assert.ok(screen.getByText(CODE_AGENT_HARD_FAIL));
    });
    assert.equal(screen.queryByText(/Mini-Grok/), null);
    const user = userEvent.setup({ delay: null });
    await user.type(screen.getByLabelText("Message to agent"), "hello");
    const send = screen.getByRole("button", { name: "Send" });
    assert.equal(send.hasAttribute("disabled"), true);
    assert.equal(send.getAttribute("title"), CODE_AGENT_HARD_FAIL);
  });

  it("Chat has no Code-engine chip and no Grok Code in the footer", async () => {
    reloadSessionsFromDisk({ byWorkspace: {}, activeId: {}, pinned: [], expanded: [] });
    const host = createFakeHost({
      mode: "chat",
      workspace: null,
      busy: false,
      connected: true,
      hasApiKey: true,
      codeAgent: null,
    });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    render(<App />);
    await screen.findByLabelText("Message to agent");
    await waitFor(() => {
      assert.ok(document.querySelector(".composer-footer"));
    });
    assert.equal(screen.queryByText(CODE_AGENT_VENDOR), null);
    assert.equal(screen.queryByText(CODE_AGENT_CHECKING), null);
    assert.equal(document.querySelector("[data-code-agent]"), null);
    assert.equal(footerText().includes("Grok Code"), false);
  });

  it("resolving shows Checking Grok agent… and never final Grok Code", async () => {
    const host = createFakeHost({
      mode: "code",
      workspace: WORKSPACE,
      workspaceName: "repo",
      busy: false,
      connected: false,
      hasApiKey: true,
      codeAgent: { resolveStatus: "resolving", identity: null, fallbackReason: null },
    });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    render(<App />);
    await screen.findByLabelText("Message to agent");
    await waitFor(() => {
      assert.ok(screen.getByText(CODE_AGENT_CHECKING));
    });
    assert.equal(screen.queryByText(CODE_AGENT_VENDOR), null);
  });

  it("eager cli_missing then acquire vendor overwrites the chip to Grok Code", async () => {
    const host = createFakeHost({
      mode: "code",
      workspace: WORKSPACE,
      workspaceName: "repo",
      busy: false,
      connected: false,
      hasApiKey: true,
      codeAgent: fallbackCliFact,
    });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    render(<App />);
    await waitFor(() => {
      assert.ok(screen.getByText(CODE_AGENT_FALLBACK_CLI));
    });
    await waitFor(() => assert.ok(FakeWebSocket.latest()));
    FakeWebSocket.latest()!.emit({
      type: "state",
      state: { ...host.state, connected: true, codeAgent: vendorFact },
    });
    await waitFor(() => {
      assert.ok(screen.getByText(CODE_AGENT_VENDOR));
    });
    assert.equal(screen.queryByText(CODE_AGENT_FALLBACK_CLI), null);
  });
});

describe("spawn-grok-agent — run provenance + agent_exited", () => {
  it("run_started vendor provenance paints quiet Grok Code on the Code run", async () => {
    const host = createFakeHost({
      mode: "code",
      workspace: WORKSPACE,
      workspaceName: "repo",
      busy: false,
      connected: true,
      hasApiKey: true,
      codeAgent: vendorFact,
    });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    render(<App />);
    await screen.findByLabelText("Message to agent");
    await waitFor(() => assert.ok(FakeWebSocket.latest()));
    const ws = FakeWebSocket.latest()!;
    ws.emit(
      envelope(
        {
          kind: "run_started",
          run: runSnapshot({
            codeAgentProvenance: { identity: "vendor", fallbackReason: null },
          }),
        },
        1,
      ) as unknown as Record<string, unknown>,
    );
    await waitFor(() => {
      assert.ok(document.querySelector("[data-code-run-provenance='vendor']"));
    });
    const chip = document.querySelector("[data-code-run-provenance='vendor']");
    assert.equal(chip?.textContent, CODE_RUN_VENDOR);
    const composer = document.querySelector("[data-code-agent='vendor']");
    assert.ok(composer?.classList.contains("is-quiet"));
    assert.ok(chip?.classList.contains("is-quiet"));
    assert.ok(chip?.closest(".you"));
  });

  it("later generation on a new run id does not rewrite prior provenance", async () => {
    const host = createFakeHost({
      mode: "code",
      workspace: WORKSPACE,
      workspaceName: "repo",
      busy: false,
      connected: true,
      hasApiKey: true,
      codeAgent: vendorFact,
    });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    render(<App />);
    await waitFor(() => assert.ok(FakeWebSocket.latest()));
    const ws = FakeWebSocket.latest()!;
    ws.emit(
      envelope(
        {
          kind: "run_started",
          run: runSnapshot({
            codeAgentProvenance: { identity: "vendor", fallbackReason: null },
          }),
        },
        1,
      ) as unknown as Record<string, unknown>,
    );
    ws.emit(
      envelope(
        {
          kind: "run_terminal",
          terminalKind: "answered",
          finalAnswer: "done",
          answerVouched: true,
          failure: null,
          terminalAt: "",
        },
        2,
      ) as unknown as Record<string, unknown>,
    );
    ws.emit(
      envelope(
        {
          kind: "run_started",
          run: runSnapshot({
            runId: "code-agent-run-2",
            acceptedPrompt: "second",
            codeAgentProvenance: { identity: "fallback", fallbackReason: "spawn_failed" },
          }),
        },
        1,
        "code-agent-run-2",
      ) as unknown as Record<string, unknown>,
    );
    await waitFor(() => {
      assert.ok(document.querySelector("[data-code-run-provenance='vendor']"));
      assert.ok(document.querySelector("[data-code-run-provenance='fallback']"));
    });
    assert.match(
      document.querySelector("[data-code-run-provenance='fallback']")?.textContent ?? "",
      new RegExp(CODE_RUN_FALLBACK),
    );
  });

  it("agent_exited paints failed terminal, not healthy in-flight", async () => {
    const host = createFakeHost({
      mode: "code",
      workspace: WORKSPACE,
      workspaceName: "repo",
      busy: false,
      connected: true,
      hasApiKey: true,
      codeAgent: vendorFact,
    });
    globalThis.fetch = host.fetchImpl;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    render(<App />);
    await waitFor(() => assert.ok(FakeWebSocket.latest()));
    const ws = FakeWebSocket.latest()!;
    ws.emit(
      envelope(
        {
          kind: "run_started",
          run: runSnapshot({
            codeAgentProvenance: { identity: "vendor", fallbackReason: null },
          }),
        },
        1,
      ) as unknown as Record<string, unknown>,
    );
    ws.emit(
      envelope(
        {
          kind: "run_terminal",
          terminalKind: "failed",
          finalAnswer: null,
          answerVouched: false,
          failure: {
            code: "agent_exited",
            message: "Agent exited",
            retryable: true,
            recoveryAction: "retry_prompt",
          },
          terminalAt: "",
        },
        2,
      ) as unknown as Record<string, unknown>,
    );
    await waitFor(() => {
      assert.ok(screen.getByText("Run failed"));
    });
    assert.equal(screen.queryByText("Run in progress…"), null);
    assert.ok(screen.getAllByText(CODE_AGENT_VENDOR).length >= 1);
    assert.equal(screen.queryByText(/Mini-Grok/), null);
  });

  it("live vendor ends (answered, cancelled, failed, agent-exit) keep Grok Code and do not paint Mini-Grok", async () => {
    const ends: Array<{ seq: number; payload: RunEventEnvelope["payload"] }> = [
      {
        seq: 2,
        payload: {
          kind: "run_terminal",
          terminalKind: "answered",
          finalAnswer: "pong",
          answerVouched: true,
          failure: null,
          terminalAt: "",
        },
      },
      {
        seq: 2,
        payload: {
          kind: "run_terminal",
          terminalKind: "cancelled",
          finalAnswer: null,
          answerVouched: false,
          failure: null,
          terminalAt: "",
        },
      },
      {
        seq: 2,
        payload: {
          kind: "run_terminal",
          terminalKind: "failed",
          finalAnswer: null,
          answerVouched: false,
          failure: {
            code: "missing_final_answer",
            message: "Missing final answer",
            retryable: true,
            recoveryAction: "retry_prompt",
          },
          terminalAt: "",
        },
      },
      {
        seq: 2,
        payload: {
          kind: "run_terminal",
          terminalKind: "failed",
          finalAnswer: null,
          answerVouched: false,
          failure: {
            code: "agent_exited",
            message: "Agent exited",
            retryable: true,
            recoveryAction: "retry_prompt",
          },
          terminalAt: "",
        },
      },
    ];
    for (const end of ends) {
      cleanup();
      resetBrowserState();
      const host = createFakeHost({
        mode: "code",
        workspace: WORKSPACE,
        workspaceName: "repo",
        busy: false,
        connected: true,
        hasApiKey: true,
        codeAgent: vendorFact,
      });
      globalThis.fetch = host.fetchImpl;
      globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
      render(<App />);
      await waitFor(() => assert.ok(FakeWebSocket.latest()));
      const ws = FakeWebSocket.latest()!;
      ws.emit(
        envelope(
          {
            kind: "run_started",
            run: runSnapshot({
              codeAgentProvenance: { identity: "vendor", fallbackReason: null },
            }),
          },
          1,
        ) as unknown as Record<string, unknown>,
      );
      ws.emit(envelope(end.payload, end.seq) as unknown as Record<string, unknown>);
      await waitFor(() => {
        assert.ok(screen.getAllByText(CODE_AGENT_VENDOR).length >= 1);
      });
      assert.equal(screen.queryByText(/Mini-Grok/), null);
      assert.equal(screen.queryByText(CODE_AGENT_HARD_FAIL), null);
    }
  });
});
