import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { setRuntimePort } from "./api";
import { startReliableRunHost, waitForRunEvent, type ReliableRunHost } from "./test-support/reliable-run-host";
import { flushSessions, reloadSessionsFromDisk } from "./sessions";
import { WebSocket as BrowserWebSocket } from "ws";

class SafeWebSocket extends BrowserWebSocket {
  static instances: SafeWebSocket[] = [];
  constructor(...args: ConstructorParameters<typeof BrowserWebSocket>) {
    super(...args);
    SafeWebSocket.instances.push(this);
    this.on("error", () => undefined);
  }
}
const hosts: ReliableRunHost[] = [];
const originalWebSocket = globalThis.WebSocket;
afterEach(async () => {
  cleanup();
  globalThis.WebSocket = originalWebSocket;
  SafeWebSocket.instances.length = 0;
  while (hosts.length) await hosts.pop()!.close();
});
function currentAppSocket(port: number): SafeWebSocket {
  const sockets = SafeWebSocket.instances.filter((socket) =>
    socket.url.includes(`:${port}/ws`) && socket.readyState === BrowserWebSocket.OPEN,
  );
  const socket = sockets[sockets.length - 1];
  assert.ok(socket, `no current live App socket for port ${port}`);
  return socket;
}
async function host(fixture = "") { const h = await startReliableRunHost(fixture); hosts.push(h); return h; }
async function mountApp(h: ReliableRunHost, mode: "chat" | "code" = "chat", preserveStorage = false) {
  setRuntimePort(Number(new URL(h.baseUrl).port));
  if (!preserveStorage) { localStorage.clear(); reloadSessionsFromDisk({ byWorkspace: {}, activeId: {}, pinned: [], expanded: [] }); }
  localStorage.setItem("grokforge.firstRun", JSON.stringify({ dismissed: true, openedFolder: true, signedIn: true, sentMessage: true, pickedMode: true, seenAt: new Date().toISOString() }));
  await fetch(`${h.baseUrl}/api/mode`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode }) });
  if (mode === "code") {
    await fetch(`${h.baseUrl}/api/workspace`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: h.workspace }) });
  }
  globalThis.WebSocket = SafeWebSocket as unknown as typeof WebSocket;
  render(<App />);
  await screen.findByRole("radio", { name: mode === "chat" ? "Chat" : "Code" });
}
async function activeAppSessionId(): Promise<string> {
  await waitFor(() => {
    const raw = localStorage.getItem("grokforge.sessions.v2");
    const parsed = raw ? JSON.parse(raw) as { activeId?: Record<string, string> } : null;
    assert.ok(parsed?.activeId && Object.values(parsed.activeId).length > 0, "App did not persist an active session");
  });
  const parsed = JSON.parse(localStorage.getItem("grokforge.sessions.v2")!) as { activeId: Record<string, string> };
  return Object.values(parsed.activeId)[0]!;
}
async function prompt(h: ReliableRunHost, sessionId: string, text = "fixture prompt") {
  let response: Response;
  try { response = await fetch(`${h.baseUrl}/api/prompt`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, text, effort: "auto", history: [] }) }); }
  catch (error) { throw new Error(`prompt transport failed: ${String(error)}\nchild pid=${h.process.pid}\nstartup output:\n${h.startupOutput()}`); }
  const body = await response.json() as any;
  assert.equal(response.status, 202);
  assert.equal(body.accepted, true);
  assert.ok(body.run?.runId);
  // Admission may publish run_started before HTTP 202 is observed. Ask the
  // real socket to replay from zero so the listener never depends on timing.
  h.ws.send(JSON.stringify({ type: "resume_runs", cursors: [{ sessionId, runId: body.run.runId, afterEventSeq: 0 }] }));
  return body.run as { runId: string; sessionId: string; connectionGeneration: number; lastEventSeq: number; state: string };
}

test("real host admits a delayed run and publishes an owned terminal envelope", async () => {
  const h = await host("delayed-final"); await mountApp(h); const sid = await activeAppSessionId(); const run = await prompt(h, sid);
  assert.equal(run.sessionId, sid);
  const started = await waitForRunEvent(h.ws, (e) => e.type === "run_started" && e.runId === run.runId);
  assert.equal(started.payload.kind, "run_started");
  assert.ok(screen.getByRole("radio", { name: "Chat" }));
  await screen.findByText("Answered");
  assert.equal(screen.getAllByText("fixture prompt").length, 1, "accepted prompt must render once");
  assert.equal(screen.getAllByText("delayed final answer").length, 1, "vouched answer must render once");
});
test("reasoning-only fixture never vouches reasoning as an answer", async () => {
  const h = await host("reasoning-only"); await mountApp(h); const run = await prompt(h, await activeAppSessionId());
  const terminal = await waitForRunEvent(h.ws, (e) => e.type === "run_terminal" && e.runId === run.runId);
  assert.equal(terminal.payload.answerVouched, false);
  assert.notEqual(terminal.payload.terminalKind, "answered");
  await screen.findByRole("alert");
  assert.equal(document.querySelector(".assistant-answer"), null, "reasoning must not render as a vouched final answer");
  assert.equal(screen.getAllByText("internal reasoning only").length, 1, "reasoning evidence must render once");
  const retryStarted = waitForRunEvent(h.ws, (e) => e.type === "run_started" && e.runId !== run.runId);
  await userEvent.setup().click(screen.getByRole("button", { name: "Retry prompt" }));
  const retriedRun = await retryStarted;
  assert.equal(retriedRun.sessionId, run.sessionId, "retry must stay owned by the same App session");
  await waitForRunEvent(h.ws, (e) => e.type === "run_terminal" && e.runId === retriedRun.runId);
  await waitFor(() => assert.equal(screen.getAllByText("Run failed", { exact: true }).length, 2, "retry must render the second terminal exactly once"));
});
test("long-run fixture remains live beyond a short client wait", async () => {
  const h = await host("long-run"); await mountApp(h); const run = await prompt(h, await activeAppSessionId());
  const live = await waitForRunEvent(h.ws, (e) => e.runId === run.runId && e.type === "run_state");
  assert.notEqual(live.payload.state, "terminal");
  await waitFor(() => assert.ok(document.querySelector(".run-live"), "App did not render the live owned run"));
});
test("GET run replay returns only events owned by the requesting session", async () => {
  const h = await host(); await mountApp(h); const sid = await activeAppSessionId(); const run = await prompt(h, sid);
  await waitForRunEvent(h.ws, (e) => e.type === "run_started" && e.runId === run.runId);
  const response = await fetch(`${h.baseUrl}/api/runs/${run.runId}?sessionId=${encodeURIComponent(sid)}&after=0`);
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.ok(body.events.every((e: any) => e.sessionId === sid && e.runId === run.runId));
  await screen.findByText("Answered");
});
test("run replay rejects a foreign session", async () => {
  const h = await host(); await mountApp(h); const run = await prompt(h, "owner-session");
  const response = await fetch(`${h.baseUrl}/api/runs/${run.runId}?sessionId=other-session&after=0`);
  assert.equal(response.status, 404);
});
test("same-session overlap is rejected without a second admission", async () => {
  const h = await host("long-run"); await mountApp(h); const sid = await activeAppSessionId(); await prompt(h, sid);
  const response = await fetch(`${h.baseUrl}/api/prompt`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: sid, text: "second" }) });
  assert.equal(response.status, 409);
  assert.equal((await response.json() as any).code, "run_active");
  assert.ok(screen.getAllByRole("button", { name: /Cancel/ }).length >= 1);
});
test("independent client sessions can both be admitted", async () => {
  const h = await host("long-run"); await mountApp(h); const first = await prompt(h, "independent-a"); const second = await prompt(h, "independent-b");
  assert.notEqual(first.runId, second.runId); assert.equal(second.sessionId, "independent-b");
});
test("cancel endpoint returns pending cancellation, not a premature terminal claim", async () => {
  const h = await host("long-run"); await mountApp(h); const sid = await activeAppSessionId(); const run = await prompt(h, sid);
  const response = await fetch(`${h.baseUrl}/api/cancel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: sid, runId: run.runId }) });
  assert.equal(response.status, 202); const body = await response.json() as any;
  assert.equal(body.accepted, true); assert.ok(["cancelling", "terminal"].includes(body.run.state));
  await screen.findByText(/Cancelled|Ending run…/);
});

for (const mode of ["chat", "code"] as const) {
  test(`${mode} real App preserves received answer through authoritative cancellation`, async () => {
    const h = await host("cancel-content"); await mountApp(h, mode);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Message to agent"), `${mode} cancel content`);
    await user.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText(/Run in progress…|Ending run…/);
    await user.click(screen.getByRole("button", { name: "Cancel run" }));
    await screen.findByText("Cancelled", {}, { timeout: 10_000 });
    assert.equal(screen.getAllByText("answer before cancel").length, 1);
    assert.equal(screen.queryByRole("article", { name: /assistant answer/i }), null);
  });

  test(`${mode} cancelled partial survives a full App reload`, async () => {
    const h = await host("cancel-content"); await mountApp(h, mode);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Message to agent"), `${mode} cancel reload`);
    await user.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText(/Run in progress…|Ending run…/);
    await user.click(screen.getByRole("button", { name: "Cancel run" }));
    await screen.findByText("Cancelled", {}, { timeout: 10_000 });
    assert.equal(screen.getAllByText("answer before cancel").length, 1);
    window.dispatchEvent(new Event("pagehide")); flushSessions(); cleanup(); reloadSessionsFromDisk();
    render(<App />);
    await screen.findByRole("radio", { name: mode === "chat" ? "Chat" : "Code" });
    await screen.findByText("Cancelled", {}, { timeout: 10_000 });
    assert.equal(screen.getAllByText("answer before cancel").length, 1);
    assert.equal(screen.queryByRole("article", { name: /assistant answer/i }), null);
  });

  test(`${mode} orphan partial survives host replacement and App reload`, async () => {
    const first = await host("orphan-content"); await mountApp(first, mode);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Message to agent"), `${mode} orphan restart`);
    await user.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("received before restart", {}, { timeout: 10_000 });
    const port = Number(new URL(first.baseUrl).port);
    await first.killPreservingData();
    const replacement = await startReliableRunHost("orphan-content", port, { home: first.home, workspace: first.workspace });
    hosts.push(replacement);
    // A real WebView reload emits pagehide and flushes the active Code/Chat
    // partition before React unmounts. Model that boundary explicitly so the
    // oracle cannot race the debounced session store after rendering the
    // received partial.
    window.dispatchEvent(new Event("pagehide")); flushSessions(); cleanup(); reloadSessionsFromDisk();
    await mountApp(replacement, mode, true);
    await screen.findByText("Run failed", {}, { timeout: 10_000 });
    assert.equal(screen.getAllByText("received before restart").length, 1);
    assert.equal(screen.getAllByText("Run failed", { exact: true }).length, 1);
    assert.equal(screen.queryByRole("article", { name: /assistant answer/i }), null);
    const nextDraft = screen.getByLabelText("Message to agent") as HTMLTextAreaElement;
    await user.type(nextDraft, "next after restart");
    await waitFor(() => assert.equal((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled, false));
  });

  test(`${mode} real App reconciles an owned run after same-port host replacement without reload`, async () => {
    const first = await host("orphan-content");
    await mountApp(first, mode);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Message to agent"), `${mode} replacement without reload`);
    await user.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("received before restart", {}, { timeout: 10_000 });
    const port = Number(new URL(first.baseUrl).port);
    await first.killPreservingData();
    const replacement = await startReliableRunHost("orphan-content", port, { home: first.home, workspace: first.workspace });
    hosts.push(replacement);

    // Keep the mounted App and its durable session intact. The replacement
    // host's health/socket becoming live is not enough; the UI must GET the
    // owned journal and settle the run before enabling the composer.
    await screen.findByText("Run failed", {}, { timeout: 15_000 });
    assert.equal(screen.getAllByText("received before restart").length, 1);
    assert.equal(screen.getAllByText("Run failed", { exact: true }).length, 1);
    assert.equal(screen.queryByText(/Reconnecting — Connection lost/), null);
    const composer = screen.getByLabelText("Message to agent") as HTMLTextAreaElement;
    await waitFor(() => assert.equal(composer.disabled, false));
    await user.type(composer, "next without reload");
    assert.equal((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled, false);
  });
}
test("mutation conflict remains an explicit HTTP error boundary", async () => {
  const h = await host(); await mountApp(h); const response = await fetch(`${h.baseUrl}/api/edit-recovery`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: "missing-session", runId: "missing-run", editId: "missing-edit" }) });
  assert.ok([404, 409].includes(response.status));
  assert.ok((await response.json() as any).code);
});
test("WS resume uses the same run/session cursor envelope", async () => {
  const h = await host(); await mountApp(h); const sid = await activeAppSessionId(); const run = await prompt(h, sid);
  h.ws.send(JSON.stringify({ type: "resume_runs", cursors: [{ sessionId: sid, runId: run.runId, afterEventSeq: 0 }] }));
  const replay = await waitForRunEvent(h.ws, (e) => e.type === "run_started" && e.runId === run.runId);
  assert.equal(replay.sessionId, sid); assert.equal(replay.connectionGeneration, run.connectionGeneration);
  await screen.findByText("Answered");
});

test("Chat production boundary renders an owned run surface in the real App", async () => {
  const h = await host("delayed-final"); await mountApp(h, "chat");
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Message to agent"), "fixture prompt");
  await user.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByText("Answered");
  assert.equal(screen.getAllByText("fixture prompt").length, 1, "App-owned prompt must render once");
  assert.equal(screen.getAllByText("delayed final answer").length, 1, "App-owned answer must render once");
  assert.ok(screen.getByRole("radio", { name: "Chat" }));
});

test("Code production boundary preserves mode and run-owned DOM controls", async () => {
  const h = await host("delayed-final"); const captures: string[] = []; const previousFetch = globalThis.fetch; globalThis.fetch = (async (input, init) => { const response = await previousFetch(input, init); if (String(input).includes("/api/prompt")) captures.push(`${init?.body || ""} -> ${response.status} ${await response.clone().text()}`); return response; }) as typeof fetch; await mountApp(h, "code");
  assert.equal(screen.getByRole("radio", { name: "Code" }).getAttribute("aria-checked"), "true");
  const user = userEvent.setup(); await user.type(screen.getByLabelText("Message to agent"), "inspect this repo"); const send = screen.getByRole("button", { name: "Send" }); assert.equal((send as HTMLButtonElement).disabled, false, "Code Send unexpectedly disabled"); await user.click(send);
  await waitFor(() => assert.ok(captures.length, "Code prompt must cross real fetch boundary"));
  assert.match(captures[0]!, /sessionId/);
  await screen.findByText(/Reasoning|Answered|Failed|Cancelled|Running/);
  globalThis.fetch = previousFetch;
});

test("real App preserves a second-send draft and re-enables after authoritative terminal", async () => {
  const h = await host("long-run"); await mountApp(h, "chat");
  const user = userEvent.setup();
  const composer = screen.getByLabelText("Message to agent") as HTMLTextAreaElement;
  await user.type(composer, "first prompt");
  await user.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByText("Run in progress…");
  await user.type(composer, "second draft must stay intact");
  assert.equal(composer.value, "second draft must stay intact");
  await user.keyboard("{Enter}");
  assert.ok(screen.getByText("A run is in progress"));
  await screen.findByText("Answered", {}, { timeout: 10_000 });
  assert.ok(screen.getAllByText("long run complete").length >= 1);
  assert.equal((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled, false);
  assert.equal(composer.value, "second draft must stay intact");
});

test("real App reports unknown status across an actual socket close and restores the same run", async () => {
  const h = await host("delayed-final"); await mountApp(h, "chat");
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Message to agent"), "disconnect me");
  await user.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByText("Run in progress…");
  let appSocket: SafeWebSocket | undefined;
  await waitFor(() => { appSocket = currentAppSocket(Number(new URL(h.baseUrl).port)); });
  appSocket!.close();
  await screen.findByText(/Reconnecting — Connection lost\. Forge is reconnecting\./);
  assert.ok(screen.getAllByText("disconnect me").length >= 1);
  await screen.findByText("Answered", {}, { timeout: 10_000 });
  assert.equal(screen.getAllByText("delayed final answer").length >= 1, true);
});

test("Code App keeps run ownership through a real socket close and replay", async () => {
  const h = await host("delayed-final"); await mountApp(h, "code");
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Message to agent"), "code disconnect me");
  await user.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByText("Run in progress…");
  let appSocket: SafeWebSocket | undefined;
  await waitFor(() => { appSocket = currentAppSocket(Number(new URL(h.baseUrl).port)); });
  appSocket!.close();
  await screen.findByText(/Reconnecting — Connection lost\. Forge is reconnecting\./);
  assert.ok(screen.getAllByText("code disconnect me").length >= 1);
  await screen.findByText("Answered", {}, { timeout: 10_000 });
  assert.equal(screen.getAllByText("delayed final answer").length >= 1, true);
});

for (const mode of ["chat", "code"] as const) {
  test(`${mode} fast terminal admitted before socket binding is reconciled from the 202 snapshot`, async () => {
    const h = await host(); await mountApp(h, mode);
    const user = userEvent.setup();
    let appSocket: SafeWebSocket | undefined;
    await waitFor(() => { appSocket = currentAppSocket(Number(new URL(h.baseUrl).port)); });
    // Deterministically remove the subscription before admission. The fixture
    // host emits answer+terminal immediately, before the reconnect can bind.
    appSocket!.close();
    await user.type(screen.getByLabelText("Message to agent"), `${mode} fast race`);
    await user.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("Answered", {}, { timeout: 10_000 });
    const runSurface = screen.getByRole("article", { name: `Run ${mode} fast race` });
    const answerMatches = within(runSurface).getAllByText("ok from grok-4.6");
    assert.equal(answerMatches.length, 1, answerMatches.map((node) => node.parentElement?.outerHTML ?? node.outerHTML).join("\n--- duplicate answer surface ---\n"));
    assert.equal(within(runSurface).getAllByText(`${mode} fast race`).length, 1);
    assert.equal(screen.queryByText("Run in progress…"), null);
  });
  test(`${mode} real reload preserves run projection and active session`, async () => {
    const h = await host(); await mountApp(h, mode); const user = userEvent.setup();
    await user.type(screen.getByLabelText("Message to agent"), `${mode} reload`); await user.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("Answered", {}, { timeout: 10_000 });
    await waitFor(() => { const p = JSON.parse(localStorage.getItem("grokforge.runProjection.v1") || "null"); const s = JSON.parse(localStorage.getItem("grokforge.sessions.v2") || "null"); assert.ok(p?.runs?.length, JSON.stringify({ p, s })); assert.ok(Object.values(s?.activeId || {}).includes(p.runs[0].sessionId), JSON.stringify({ p, s })); });
    const before = { projection: localStorage.getItem("grokforge.runProjection.v1"), sessions: localStorage.getItem("grokforge.sessions.v2") };
    window.dispatchEvent(new Event("pagehide")); flushSessions(); cleanup(); reloadSessionsFromDisk();
    assert.equal(localStorage.getItem("grokforge.runProjection.v1"), before.projection, JSON.stringify({ before, after: localStorage.getItem("grokforge.runProjection.v1") }));
    render(<App />); await screen.findByRole("radio", { name: mode === "chat" ? "Chat" : "Code" }); await screen.findByText("Answered", {}, { timeout: 10_000 }); assert.equal(screen.getAllByText("ok from grok-4.6").length, 1);
  });
  test(`${mode} cancel 409 terminal response reconciles through replay`, async () => {
    const h = await host(); await mountApp(h, mode); const user = userEvent.setup();
    let socket: SafeWebSocket | undefined;
    await waitFor(() => { socket = currentAppSocket(Number(new URL(h.baseUrl).port)); });
    const originalWebSocket = globalThis.WebSocket;
    class ReconnectBlockedWebSocket { static readonly OPEN = 1; constructor() { throw new Error("reconnect intentionally blocked by cancel reconciliation oracle"); } }
    globalThis.WebSocket = ReconnectBlockedWebSocket as unknown as typeof WebSocket; socket!.close();
    const originalFetch = globalThis.fetch; let failedReplay = false;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); if (!failedReplay && init?.method !== "POST" && url.includes("/api/runs/")) { failedReplay = true; throw new Error("selective replay fault"); }
      return originalFetch(input, init);
    }) as typeof fetch;
    try {
      await user.type(screen.getByLabelText("Message to agent"), `${mode} cancel409`); await user.click(screen.getByRole("button", { name: "Send" }));
      await screen.findByText("Run in progress…");
      const runId = document.querySelector<HTMLElement>("[data-run-id]")?.dataset.runId; assert.ok(runId);
      const owningSessionId = await activeAppSessionId();
      await waitFor(async () => { const response = await originalFetch(`${h.baseUrl}/api/runs/${runId}?sessionId=${encodeURIComponent(owningSessionId)}&after=0`); const replay = await response.json() as { run?: { state?: string } }; assert.equal(replay.run?.state, "terminal"); });
      await user.click(screen.getByRole("button", { name: "Cancel run" }));
      await screen.findByText("Answered", {}, { timeout: 10_000 });
      await waitFor(() => { assert.equal(screen.queryByText("Ending run…"), null); assert.equal(screen.queryAllByText("Cancelling…").length, 0); assert.equal((screen.getByLabelText("Message to agent") as HTMLTextAreaElement).disabled, false); });
      assert.equal(screen.getAllByText("ok from grok-4.6").length, 1); assert.equal(screen.queryByText(/Run is terminal|selective replay fault/), null);
      const composer = screen.getByLabelText("Message to agent") as HTMLTextAreaElement; await user.type(composer, "next draft"); assert.equal((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled, false);
    } finally { globalThis.fetch = originalFetch; globalThis.WebSocket = originalWebSocket; }
  });


  test(`${mode} real App reconnect replays a terminal run without admitting late tool/decision/edit/error events`, async () => {
    const h = await host("late-events"); await mountApp(h, mode);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Message to agent"), `${mode} all-event reconnect`);
    await user.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("Run in progress…");
    let appSocket: SafeWebSocket | undefined;
    await waitFor(() => { appSocket = currentAppSocket(Number(new URL(h.baseUrl).port)); });
    appSocket!.close();
    await screen.findByText(/Reconnecting — Connection lost\. Forge is reconnecting\./);
    await screen.findByText("Answered", {}, { timeout: 10_000 });
    assert.equal(screen.getAllByText("settled answer").length, 1, "replayed answer must render once");
    assert.equal(screen.queryByText(/late reasoning|late answer|late-tool|late_error/), null, "late classes must not escape the settled owning run");
  });
}

for (const mode of ["chat", "code"] as const) {
  test(`${mode} real App keeps all pre-terminal event classes under one run across disconnect/replay`, async () => {
    const h = await host("all-events"); await mountApp(h, mode);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Message to agent"), `${mode} complete event run`);
    await user.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("Run in progress…");
    let appSocket: SafeWebSocket | undefined;
    await waitFor(() => { appSocket = currentAppSocket(Number(new URL(h.baseUrl).port)); });
    appSocket!.close();
    await screen.findByText(/Reconnecting — Connection lost\. Forge is reconnecting\./);
    const activity = await screen.findByText(/read_file: succeeded/);
    assert.ok(activity);
    const runSurface = screen.getByRole("article", { name: `Run ${mode} complete event run` });
    assert.ok(within(runSurface).getByText(/Model:/));
    assert.ok(within(runSurface).getAllByText(/Policy:/).length >= 1);
    const runId = runSurface.getAttribute("data-run-id");
    assert.ok(runId);
    // Admission GET can paint activity before the host has appended
    // answer_delta (each ACP event is awaited). Wait until the pre-terminal
    // batch is visible, then read the complete journal.
    await screen.findByText("answer received before failure", {}, { timeout: 10_000 });
    const replay = await (await fetch(`${h.baseUrl}/api/runs/${runId}?sessionId=${encodeURIComponent(await activeAppSessionId())}&after=0`)).json() as { events: Array<{ sessionId: string; runId: string; payload: { kind: string; request?: { kind?: string } } }> };
    const kinds = replay.events.map(event => event.payload.kind);
    for (const kind of ["run_started", "reasoning_delta", "activity_update", "decision_request", "answer_delta"]) assert.ok(kinds.includes(kind), `${mode} replay missing ${kind}`);
    const decisionKinds = replay.events.filter(event => event.payload.kind === "decision_request").map(event => event.payload.request?.kind);
    assert.ok(decisionKinds.includes("permission"));
    assert.ok(decisionKinds.includes("diff"));
    assert.ok(replay.events.every(event => event.sessionId === replay.events[0]?.sessionId && event.runId === replay.events[0]?.runId), "replay classes must share one owner");
    await screen.findByText("Run failed", {}, { timeout: 10_000 });
    const surfaces = screen.getAllByRole("article", { name: `Run ${mode} complete event run` });
    assert.equal(surfaces.length, 1, "all event classes must remain under one owning RunSurface");
    assert.ok(within(surfaces[0]!).getByText("pre-terminal reasoning"));
    assert.ok(within(surfaces[0]!).getByText(/read_file: succeeded/));
    assert.ok(within(surfaces[0]!).getByText("Run shell"));
    assert.ok(within(surfaces[0]!).getByText("Edit file"));
    assert.equal(within(surfaces[0]!).getAllByText("answer received before failure").length, 1);
    assert.equal(screen.getAllByText("Run failed", { exact: true }).length, 1);
  });
}
