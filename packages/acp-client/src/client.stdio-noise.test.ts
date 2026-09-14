import assert from "node:assert/strict";
import test from "node:test";
import { StdioAcpClient } from "./client.js";
import type { AcpUiEvent, HostExecutionProfile } from "./types.js";

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

test("pdfjs canvas Warning on stdout is agent_log, not parse_error", async () => {
  const warn =
    'Warning: Cannot load "@napi-rs/canvas" package: "Error: Cannot find module \'@napi-rs/canvas\'"';
  const script = `const r=require('readline').createInterface({input:process.stdin});
r.on('line',l=>{
  const m=JSON.parse(l);
  if(m.method==='initialize'){
    process.stdout.write(${JSON.stringify(warn)}+'\\n');
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{protocolVersion:1}})+'\\n');
  }
});`;
  const client = new StdioAcpClient({
    workspaceRoot: process.cwd(),
    command: process.execPath,
    args: ["-e", script],
    env: Object.freeze({}),
    executionProfile: profile,
    initializePermissionMode: "default",
  });
  const events: AcpUiEvent[] = [];
  client.onEvent((e) => events.push(e));
  try {
    await client.initialize();
    const logs = events.filter((e) => e.type === "agent_log");
    const errors = events.filter((e) => e.type === "error");
    assert.equal(errors.length, 0);
    assert.equal(logs.length, 1);
    assert.equal(logs[0]?.type === "agent_log" && logs[0].level, "warn");
    assert.match(String(logs[0]?.type === "agent_log" ? logs[0].message : ""), /napi-rs\/canvas/);
  } finally {
    await client.dispose();
  }
});
