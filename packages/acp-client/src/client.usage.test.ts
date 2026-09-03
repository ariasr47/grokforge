import test from "node:test";
import assert from "node:assert/strict";
import { StdioAcpClient } from "./client.js";

const profile = {
  status: "available" as const,
  platform: "win32",
  osFamily: "windows" as const,
  executable: "C:\\Windows\\System32\\cmd.exe",
  argvPrefix: ["/d", "/s", "/c"] as const,
  displayName: "Command Prompt (cmd.exe)",
  dialect: "cmd" as const,
  pathSeparator: "\\" as const,
  syntax: { quoting: "", chaining: "", redirection: "" },
};

const usageParams = { schemaVersion: 1, type: "usage", promptTokens: 4321, contextWindow: 500_000 };
const nullWindowParams = { schemaVersion: 1, type: "usage", promptTokens: 12, contextWindow: null };

function childScript(method: string, params: unknown) {
  return `const r=require('readline').createInterface({input:process.stdin}); r.on('line',l=>{const m=JSON.parse(l); if(m.method==='initialize') process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{}})+'\\n'); if(m.method==='session/new') process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{sessionId:'capture'}})+'\\n'); if(m.method==='session/prompt'){ process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{ok:true}})+'\\n'); process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:${JSON.stringify(method)},params:${JSON.stringify(params)}})+'\\n'); }});`;
}

async function collectEvent(method: string, params: unknown) {
  const client = new StdioAcpClient({
    workspaceRoot: process.cwd(),
    command: process.execPath,
    args: ["-e", childScript(method, params)],
    env: Object.freeze({}),
    executionProfile: profile,
  });
  const seen = new Promise<any>((resolve) => {
    client.onEvent((event) => resolve(event));
  });
  try {
    await client.initialize();
    await client.newSession();
    await client.prompt("capture", "hi", { runId: "run-1", connectionGeneration: 1 });
    return await Promise.race([
      seen,
      new Promise((_, reject) => setTimeout(() => reject(new Error("event timeout")), 1500)),
    ]);
  } finally {
    await client.dispose();
  }
}

test("bare usage notification emits typed event with the real prompt token count", async () => {
  const event = await collectEvent("usage", usageParams);
  assert.equal(event.type, "usage");
  assert.equal(event.schemaVersion, 1);
  assert.equal(event.promptTokens, 4321);
  assert.equal(event.contextWindow, 500_000);
});

test("agent/usage dual-form accepted", async () => {
  const event = await collectEvent("agent/usage", usageParams);
  assert.equal(event.type, "usage");
  assert.equal(event.promptTokens, 4321);
});

test("null contextWindow passes through — the shell hides the ring rather than the client inventing a number", async () => {
  const event = await collectEvent("usage", nullWindowParams);
  assert.equal(event.type, "usage");
  assert.equal(event.promptTokens, 12);
  assert.equal(event.contextWindow, null);
});

test("malformed usage (missing promptTokens) ignored with agent_log warn", async () => {
  const event = await collectEvent("usage", { schemaVersion: 1, type: "usage", contextWindow: 500_000 });
  assert.equal(event.type, "agent_log");
  assert.equal(event.level, "warn");
  assert.match(event.message, /Malformed usage/);
});

test("malformed usage (non-numeric contextWindow) ignored with agent_log warn — never coerced", async () => {
  const event = await collectEvent("usage", { schemaVersion: 1, type: "usage", promptTokens: 10, contextWindow: "unknown" });
  assert.equal(event.type, "agent_log");
  assert.equal(event.level, "warn");
  assert.match(event.message, /Malformed usage/);
});
