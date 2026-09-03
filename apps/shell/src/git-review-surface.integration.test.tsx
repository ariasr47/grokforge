import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { setRuntimePort } from "./api";
import { startReliableRunHost, waitForRunEvent, type ReliableRunHost } from "./test-support/reliable-run-host";
import { flushSessions, reloadSessionsFromDisk } from "./sessions";
import { WebSocket as BrowserWebSocket } from "ws";
import { CHANGES_DOCK_LABEL, GIT_REVIEW_LOADING } from "./ChangesDock";

// Git review moved from an in-stream RunSurface section into the (tabbed)
// Changes dock in Task 9 — see ChangesDock.tsx. "View output" (jumping from
// a row to its Activity receipt) was dropped in that redesign; the dock is a
// rows-only surface now, so these journeys open the dock's Git tab instead
// of expanding an in-stream accordion, and no longer click through to a row.

const agentPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "host",
  "src",
  "test-support",
  "git-review-surface-agent.mjs",
);

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
  for (const ws of SafeWebSocket.instances) {
    try { ws.close(); } catch { /* already closed */ }
  }
  SafeWebSocket.instances.length = 0;
  while (hosts.length) await hosts.pop()!.close();
});

async function agentAvailable(): Promise<boolean> {
  try {
    await access(agentPath);
    return true;
  } catch {
    return false;
  }
}

async function host() {
  const h = await startReliableRunHost("git-review-surface");
  hosts.push(h);
  return h;
}

async function mountApp(h: ReliableRunHost, preserveStorage = false) {
  setRuntimePort(Number(new URL(h.baseUrl).port));
  if (!preserveStorage) {
    localStorage.clear();
    reloadSessionsFromDisk({ byWorkspace: {}, activeId: {}, pinned: [], expanded: [] });
  }
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
  await fetch(`${h.baseUrl}/api/mode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "code" }),
  });
  await fetch(`${h.baseUrl}/api/workspace`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: h.workspace }),
  });
  globalThis.WebSocket = SafeWebSocket as unknown as typeof WebSocket;
  render(<App />);
  await screen.findByRole("radio", { name: "Code" });
}

async function sendPrompt(text: string) {
  const user = userEvent.setup();
  const composer = screen.getByLabelText("Message to agent");
  await user.clear(composer);
  await user.type(composer, text);
  await user.click(screen.getByRole("button", { name: "Send" }));
}

async function waitForGitReview(): Promise<HTMLElement> {
  const dock = await screen.findByRole("region", { name: CHANGES_DOCK_LABEL }, { timeout: 15_000 });
  const user = userEvent.setup();
  await user.click(within(dock).getByRole("tab", { name: /Git/i }));
  await waitFor(() => {
    assert.equal(within(dock).queryByText(GIT_REVIEW_LOADING) === null, true);
  }, { timeout: 15_000 });
  return dock;
}

const present = await agentAvailable();

test("git-review reachable agent is present for host→App spine", { skip: !present }, () => {
  assert.equal(present, true);
});

test("Trusted-shaped status+diff list on Code Git review (AC-01/02/31)", { skip: !present, timeout: 60_000 }, async () => {
  const h = await host();
  await mountApp(h);
  await sendPrompt("inspect git status and diff");
  await waitForRunEvent(h.ws, (event) => event.type === "activity_update" && event.payload?.activity?.command === "git diff", 15_000);
  const dock = await waitForGitReview();
  assert.ok(within(dock).getByText("Status"));
  assert.ok(within(dock).getByText("Diff"));
  const text = (dock.textContent ?? "").toLowerCase();
  assert.equal(text.includes("dirty"), false);
  assert.equal(text.includes("open link"), false);
});

test("fixed-inspection Status member is listed (AC-32)", { skip: !present, timeout: 60_000 }, async () => {
  const h = await host();
  await mountApp(h);
  await sendPrompt("fixed-status");
  await waitForRunEvent(h.ws, (event) => event.type === "activity_update" && String(event.payload?.activity?.command ?? "").includes("git status"), 15_000);
  const dock = await waitForGitReview();
  assert.ok(within(dock).getByText("Status"));
  assert.ok(within(dock).getByText("git status --short"));
});

test("Review-shaped Diff member is listed (AC-31)", { skip: !present, timeout: 60_000 }, async () => {
  const h = await host();
  await mountApp(h);
  await sendPrompt("review-diff");
  await waitForRunEvent(h.ws, (event) => event.type === "activity_update" && String(event.payload?.activity?.command ?? "").includes("git diff"), 15_000);
  const dock = await waitForGitReview();
  assert.ok(within(dock).getByText("Diff"));
  assert.ok(within(dock).getByText("git diff --stat"));
});

test("executed gh pr is a PR member by durable command (AC-05)", { skip: !present, timeout: 60_000 }, async () => {
  const h = await host();
  await mountApp(h);
  await sendPrompt("gh-pr");
  await waitForRunEvent(h.ws, (event) => event.type === "activity_update" && String(event.payload?.activity?.command ?? "").startsWith("gh pr"), 15_000);
  const dock = await waitForGitReview();
  assert.ok(within(dock).getByText("PR"));
  assert.ok(within(dock).getByText("gh pr view"));
  const text = (dock.textContent ?? "").toLowerCase();
  assert.equal(text.includes("open link"), false);
  assert.equal(text.includes("pr ready"), false);
});

test("force-push still cards a permission decision (AC-20)", { skip: !present, timeout: 60_000 }, async () => {
  const h = await host();
  await mountApp(h);
  await sendPrompt("force-push");
  await waitForRunEvent(
    h.ws,
    (event) =>
      event.type === "decision_request" ||
      event.payload?.request?.kind === "permission" ||
      event.method === "permission_request",
    15_000,
  );
  const dock = await screen.findByRole("region", { name: /Pending/i }, { timeout: 15_000 });
  const dockText = (dock.textContent ?? "").toLowerCase();
  assert.ok(
    dockText.includes("push") || dockText.includes("shell") || dockText.includes("allow"),
    "force-push must still surface a permission card",
  );
  assert.equal(screen.queryByRole("button", { name: /force push/i }) === null, true);
});

test("reconnect restores the same Git review membership (AC-11/12)", { skip: !present, timeout: 60_000 }, async () => {
  const first = await host();
  await mountApp(first);
  await sendPrompt("inspect git status and diff");
  await waitForRunEvent(first.ws, (event) => event.type === "activity_update" && event.payload?.activity?.command === "git diff", 15_000);
  const before = await waitForGitReview();
  assert.ok(within(before).getByText("Status"));
  assert.ok(within(before).getByText("Diff"));
  const port = Number(new URL(first.baseUrl).port);
  await first.killPreservingData();
  const replacement = await startReliableRunHost("git-review-surface", port, {
    home: first.home,
    workspace: first.workspace,
  });
  hosts.push(replacement);
  window.dispatchEvent(new Event("pagehide"));
  flushSessions();
  cleanup();
  reloadSessionsFromDisk();
  await mountApp(replacement, true);
  const after = await waitForGitReview();
  assert.ok(within(after).getByText("Status"));
  assert.ok(within(after).getByText("Diff"));
});

test("git-review reachable spine waits on BE fixture agent when missing", { skip: present }, () => {
  assert.ok(!present);
});
