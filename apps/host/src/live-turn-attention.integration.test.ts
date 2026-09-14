import assert from "node:assert/strict";
import test from "node:test";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import { startHost, type StartedHost } from "./test-support/host-process.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const agent = path.resolve(here, "./test-support/live-turn-burst-agent.mjs");
const clientSessionId = "live-turn-attention";

async function freePort() {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => server.listen(0, "127.0.0.1", resolve).on("error", reject));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function waitOpen(socket: WebSocket) {
  return new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
}

async function startLiveTurnHost(): Promise<{
  host: StartedHost;
  events: any[];
  prompt: (text: string) => Promise<any[]>;
  close: () => Promise<void>;
}> {
  const host = await startHost({
    port: await freePort(),
    env: { GROKFORGE_AGENT_ENTRY: agent, XAI_API_KEY: "fixture" },
  });
  const events: any[] = [];
  const ws = new WebSocket(host.baseUrl.replace(/^http/, "ws") + "/ws");
  ws.on("message", (d) => events.push(JSON.parse(String(d))));
  await waitOpen(ws);

  async function prompt(text: string) {
    const before = events.length;
    await new Promise<void>(async (resolve, reject) => {
      const t = setTimeout(() => {
        ws.off("message", h);
        reject(new Error("prompt contract event timeout"));
      }, 10000);
      const h = (d: any) => {
        const e = JSON.parse(String(d));
        const terminal = e.type === "run_terminal";
        const decision = e.type === "decision_request" && e.payload?.request?.status === "pending";
        if (events.length > before && (terminal || decision)) {
          clearTimeout(t);
          ws.off("message", h);
          resolve();
        }
      };
      ws.on("message", h);
      try {
        const res = await fetch(`${host.baseUrl}/api/prompt`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, sessionId: clientSessionId }),
        });
        if (!res.ok) throw new Error(`prompt HTTP ${res.status}: ${await res.text()}`);
      } catch (error) {
        clearTimeout(t);
        ws.off("message", h);
        reject(error);
      }
    });
    return events.slice(before);
  }

  return {
    host,
    events,
    prompt,
    async close() {
      ws.close();
      await host.stop();
    },
  };
}

function pendingPermissionFromEnvelope(out: any[]) {
  // Dock authority is the envelope. A missing legacy permission_request WS frame is not a failure.
  const decision = out
    .filter((e) => e.type !== "permission_request")
    .find((e) => e.type === "decision_request" && e.payload?.request?.status === "pending");
  assert.ok(decision, "expected envelope decision_request; legacy permission_request is not required");
  return decision.payload.request;
}

test("envelope permission_request pins title Run shell and journals pending decision_request", async () => {
  const live = await startLiveTurnHost();
  try {
    const out = await live.prompt("live-turn burst");
    const request = pendingPermissionFromEnvelope(out);
    assert.equal(request.kind, "permission");
    assert.equal(request.status, "pending");
    assert.equal(request.title, "Run shell");
    assert.equal(request.detail, "echo live-turn-attention");
  } finally {
    await live.close();
  }
});

test("write permission pins title Write file", async () => {
  const live = await startLiveTurnHost();
  try {
    const out = await live.prompt("write-permission");
    const request = pendingPermissionFromEnvelope(out);
    assert.equal(request.kind, "permission");
    assert.equal(request.status, "pending");
    assert.equal(request.title, "Write file");
    assert.equal(request.detail, "notes.md");
  } finally {
    await live.close();
  }
});

test("ask permission pins title Grok has a question", async () => {
  const live = await startLiveTurnHost();
  try {
    const out = await live.prompt("ask-permission");
    const request = pendingPermissionFromEnvelope(out);
    assert.equal(request.kind, "permission");
    assert.equal(request.status, "pending");
    assert.equal(request.title, "Grok has a question");
    assert.match(String(request.detail), /Which copy\?/);
  } finally {
    await live.close();
  }
});
