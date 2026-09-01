import assert from "node:assert/strict";
import test from "node:test";
import {
  ACP_PROMPT_RPC_TIMEOUT_MS,
  ACP_RPC_TIMEOUT_MS,
  StdioAcpClient,
} from "./client.js";
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

test("session/prompt is not on the 120s handshake clock", () => {
  assert.equal(ACP_PROMPT_RPC_TIMEOUT_MS, 0);
  assert.equal(ACP_RPC_TIMEOUT_MS, 120_000);
});

test("session/prompt still resolves after the handshake timeout window would have fired if applied", async () => {
  const delayMs = 80;
  const script = `const r=require('readline').createInterface({input:process.stdin});r.on('line',l=>{const m=JSON.parse(l);if(m.method==='initialize')process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{protocolVersion:1}})+'\\n');if(m.method==='session/new')process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{sessionId:'v1'}})+'\\n');if(m.method==='session/prompt'){setTimeout(()=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{stopReason:'end_turn'}})+'\\n'),${delayMs});}});`;
  const client = new StdioAcpClient({
    workspaceRoot: process.cwd(),
    command: process.execPath,
    args: ["-e", script],
    env: Object.freeze({}),
    executionProfile: profile,
    initializePermissionMode: "default",
  });
  const errors: string[] = [];
  client.onEvent((ev) => {
    if (ev.type === "error") errors.push(ev.code ?? "");
  });
  try {
    await client.initialize();
    await client.newSession();
    await client.prompt("v1", "slow", { runId: "r1", connectionGeneration: 1 });
    assert.equal(errors.includes("rpc_timeout"), false);
  } finally {
    await client.dispose();
  }
});
