import test, { after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { App } from "./App";
import { setRuntimePort } from "./api";
import { startReliableRunHost, waitForRunEvent, type ReliableRunHost } from "./test-support/reliable-run-host";
import { reloadSessionsFromDisk } from "./sessions";
import { WebSocket as BrowserWebSocket } from "ws";

const TURN_COPY = "Your turn — type the next message below";
const agentPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "host",
  "src",
  "test-support",
  "live-turn-burst-agent.mjs",
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
const proto = HTMLElement.prototype;
const originalClientHeight = Object.getOwnPropertyDescriptor(proto, "clientHeight");
const originalScrollHeight = Object.getOwnPropertyDescriptor(proto, "scrollHeight");
const originalScrollTop = Object.getOwnPropertyDescriptor(proto, "scrollTop");

function restoreFollowGeometry(): void {
  restoreGeometryProperty("clientHeight", originalClientHeight);
  restoreGeometryProperty("scrollHeight", originalScrollHeight);
  restoreGeometryProperty("scrollTop", originalScrollTop);
}

function restoreGeometryProperty(
  name: "clientHeight" | "scrollHeight" | "scrollTop",
  original: PropertyDescriptor | undefined,
): void {
  if (original) {
    Object.defineProperty(proto, name, original);
    return;
  }
  // jsdom keeps these getters on Element.prototype; the follow patch
  // installs own properties on HTMLElement.prototype that must be deleted.
  delete (proto as unknown as Record<string, unknown>)[name];
}

afterEach(async () => {
  cleanup();
  restoreFollowGeometry();
  globalThis.WebSocket = originalWebSocket;
  for (const ws of SafeWebSocket.instances) {
    try { ws.close(); } catch { /* already closed */ }
  }
  SafeWebSocket.instances.length = 0;
  while (hosts.length) await hosts.pop()!.close();
});

after(() => {
  restoreFollowGeometry();
});

function installFollowGeometry(): void {
  const scrollTops = new WeakMap<HTMLElement, number>();
  Object.defineProperty(proto, "clientHeight", {
    configurable: true,
    get() {
      return (this as HTMLElement).classList?.contains("tool-activity-body") ? 80 : 600;
    },
  });
  Object.defineProperty(proto, "scrollHeight", {
    configurable: true,
    get() {
      const el = this as HTMLElement;
      if (el.classList?.contains("tool-activity-body")) {
        return el.querySelectorAll(".tool-row").length * 24;
      }
      return Math.max(800, el.children.length * 40);
    },
  });
  Object.defineProperty(proto, "scrollTop", {
    configurable: true,
    get() {
      return scrollTops.get(this as HTMLElement) ?? 0;
    },
    set(value: number) {
      scrollTops.set(this as HTMLElement, value);
    },
  });
}

async function agentAvailable(): Promise<boolean> {
  try {
    await access(agentPath);
    return true;
  } catch {
    return false;
  }
}

async function host() {
  const h = await startReliableRunHost("live-turn-burst");
  hosts.push(h);
  return h;
}

async function mountApp(h: ReliableRunHost, mode: "chat" | "code") {
  setRuntimePort(Number(new URL(h.baseUrl).port));
  localStorage.clear();
  reloadSessionsFromDisk({ byWorkspace: {}, activeId: {}, pinned: [], expanded: [] });
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
    body: JSON.stringify({ mode }),
  });
  if (mode === "code") {
    await fetch(`${h.baseUrl}/api/workspace`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: h.workspace }),
    });
  }
  globalThis.WebSocket = SafeWebSocket as unknown as typeof WebSocket;
  installFollowGeometry();
  render(<App />);
  await screen.findByRole("radio", { name: mode === "chat" ? "Chat" : "Code" });
}

async function observeSpine(mode: "chat" | "code") {
  const h = await host();
  await mountApp(h, mode);
  const composer = screen.getByLabelText("Message to agent");
  fireEvent.change(composer, { target: { value: mode === "code" ? "live-turn burst" : "live-turn burst chat" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitForRunEvent(h.ws, (event) => event.type === "decision_request" && event.payload?.request?.kind === "permission", 15_000);

  const dock = await screen.findByRole("region", { name: "Pending agent actions" }, { timeout: 15_000 });
  assert.ok(within(dock).getByRole("button", { name: "Allow once" }), "AC6: dock must show permission settle");
  assert.equal(screen.queryByText(TURN_COPY), null, "AC10: Your turn withheld while waiting on permission");
  assert.ok(screen.getByRole("button", { name: "Cancel" }), "AC10: live wait uses Cancel chrome");
  assert.ok(screen.getByText("Permission requested: shell"), "AC5 rail: permission chip present");

  const body = await screen.findByRole("region", { name: "Tool activity details" }, { timeout: 10_000 });
  const rows = body.querySelectorAll(".tool-row");
  assert.ok(rows.length >= 16, `AC1: expected a long burst, got ${rows.length} rows`);
  const last = rows[rows.length - 1] as HTMLElement;
  assert.ok(body.contains(last));
  const maxTop = Math.max(0, body.scrollHeight - body.clientHeight);
  assert.ok(
    Math.abs(body.scrollTop - maxTop) <= 2,
    `AC1: inner follow should keep at-end (scrollTop=${body.scrollTop} max=${maxTop})`,
  );
}

const present = await agentAvailable();

test(
  "Observe spine Chat: long burst + shell permission through host→App",
  { skip: !present },
  async () => {
    await observeSpine("chat");
  },
);

test(
  "Observe spine Code: long burst + shell permission through host→App",
  { skip: !present },
  async () => {
    await observeSpine("code");
  },
);

test("Observe spine waits on BE B1 live-turn-burst agent when missing", { skip: present }, () => {
  assert.ok(!present);
});

test("installFollowGeometry restores HTMLElement prototype geometry", () => {
  const el = document.createElement("div");
  installFollowGeometry();
  assert.equal(el.clientHeight, 600, "sanity: geometry patch is active");
  assert.ok(Object.getOwnPropertyDescriptor(proto, "clientHeight"), "own clientHeight getter while patched");
  restoreFollowGeometry();
  assert.equal(el.clientHeight, 0);
  assert.equal(el.scrollHeight, 0);
  assert.equal(el.scrollTop, 0);
  assert.equal(Object.getOwnPropertyDescriptor(proto, "clientHeight"), undefined);
  assert.equal(Object.getOwnPropertyDescriptor(proto, "scrollHeight"), undefined);
  assert.equal(Object.getOwnPropertyDescriptor(proto, "scrollTop"), undefined);
});
