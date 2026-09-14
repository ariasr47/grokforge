import test from "node:test";
import assert from "node:assert/strict";
// Project instructions are host-supplied, not a Forge skills catalog.
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

const includedParams = {
  schemaVersion: 1,
  type: "project_instructions",
  status: "present",
  inclusion: "included",
  path: "AGENTS.md",
  bodyByteLength: 12,
};

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

test("bare project_instructions notification emits typed event", async () => {
  const event = await collectEvent("project_instructions", includedParams);
  assert.equal(event.type, "project_instructions");
  assert.equal(event.schemaVersion, 1);
  assert.equal(event.status, "present");
  assert.equal(event.inclusion, "included");
  assert.equal(event.path, "AGENTS.md");
  assert.equal(event.bodyByteLength, 12);
});

test("agent/project_instructions dual-form accepted", async () => {
  const event = await collectEvent("agent/project_instructions", includedParams);
  assert.equal(event.type, "project_instructions");
  assert.equal(event.inclusion, "included");
  assert.equal(event.path, "AGENTS.md");
});

test("malformed project_instructions ignored with agent_log warn", async () => {
  const event = await collectEvent("project_instructions", {
    schemaVersion: 2,
    type: "project_instructions",
    status: "present",
    inclusion: "included",
    path: "AGENTS.md",
    bodyByteLength: 12,
  });
  assert.equal(event.type, "agent_log");
  assert.equal(event.level, "warn");
  assert.match(event.message, /Malformed project_instructions/);
});
