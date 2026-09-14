import assert from "node:assert/strict";
import test from "node:test";
// Vendor prompt completion is advertised ACP, not a Forge classifier.
import { StdioAcpClient } from "./client.js";
import type { HostExecutionProfile } from "./types.js";

const profile: HostExecutionProfile = {
  status: "available",
  platform: "win32",
  osFamily: "windows",
  executable: "C:\\Windows\\System32\\cmd.exe",
  argvPrefix: ["/d", "/s", "/c"],
  displayName: "Command Prompt (cmd.exe)",
  dialect: "cmd",
  pathSeparator: "\\",
  syntax: { quoting: "", chaining: "", redirection: "" },
};

function scriptReturning(result: unknown) {
  return `const r=require('readline').createInterface({input:process.stdin});r.on('line',l=>{const m=JSON.parse(l);if(m.method==='initialize')process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{protocolVersion:1}})+'\\n');if(m.method==='session/new')process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{sessionId:'v1'}})+'\\n');if(m.method==='session/prompt'){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:${JSON.stringify(result)}})+'\\n');}});`;
}

function makeClient(script: string, extra?: { initializePermissionMode?: "default" }) {
  return new StdioAcpClient({
    workspaceRoot: process.cwd(),
    command: process.execPath,
    args: ["-e", script],
    env: Object.freeze({}),
    executionProfile: profile,
    initializePermissionMode: extra?.initializePermissionMode,
  });
}

test("vendor session/prompt RPC result emits done-class (stop) without a done notification", async () => {
  const client = makeClient(scriptReturning({ stopReason: "end_turn" }), {
    initializePermissionMode: "default",
  });
  const events: Array<{ type: string; reason?: string }> = [];
  client.onEvent((ev) => events.push(ev as { type: string; reason?: string }));
  try {
    await client.initialize();
    await client.newSession();
    await client.prompt("v1", "pong", { runId: "r1", connectionGeneration: 1 });
    assert.ok(
      events.some((e) => e.type === "done" && (e.reason === "stop" || e.reason === "end_turn")),
      "RPC completion must surface done-class; discarding the result is the Writing… hang",
    );
  } finally {
    await client.dispose();
  }
});

test("vendor stopReason cancelled maps to done-class cancelled", async () => {
  const client = makeClient(scriptReturning({ stopReason: "cancelled" }), {
    initializePermissionMode: "default",
  });
  const events: Array<{ type: string; reason?: string }> = [];
  client.onEvent((ev) => events.push(ev as { type: string; reason?: string }));
  try {
    await client.initialize();
    await client.newSession();
    await client.prompt("v1", "pong", { runId: "r1", connectionGeneration: 1 });
    assert.ok(events.some((e) => e.type === "done" && e.reason === "cancelled"));
  } finally {
    await client.dispose();
  }
});

test("vendor stopReason error maps to done-class error", async () => {
  const client = makeClient(scriptReturning({ stopReason: "error" }), {
    initializePermissionMode: "default",
  });
  const events: Array<{ type: string; reason?: string }> = [];
  client.onEvent((ev) => events.push(ev as { type: string; reason?: string }));
  try {
    await client.initialize();
    await client.newSession();
    await client.prompt("v1", "pong", { runId: "r1", connectionGeneration: 1 });
    assert.ok(events.some((e) => e.type === "done" && e.reason === "error"));
  } finally {
    await client.dispose();
  }
});

test("grok-acp session/prompt ack without stopReason does not emit done-class", async () => {
  const client = makeClient(scriptReturning({ ok: true, accepted: true }));
  const events: Array<{ type: string; reason?: string }> = [];
  client.onEvent((ev) => events.push(ev as { type: string; reason?: string }));
  try {
    await client.initialize();
    await client.newSession();
    await client.prompt("c1", "hello", { runId: "r1", connectionGeneration: 1 });
    assert.equal(
      events.some((e) => e.type === "done"),
      false,
      "grok-acp {ok,accepted} ack is not turn-end; a done notification follows later",
    );
  } finally {
    await client.dispose();
  }
});
