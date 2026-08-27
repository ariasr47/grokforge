import test from "node:test";
import assert from "node:assert/strict";
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

function waitFor(events: AcpUiEvent[], pred: (e: AcpUiEvent) => boolean, label: string, ms = 2000): Promise<AcpUiEvent> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      const hit = events.find(pred);
      if (hit) return resolve(hit);
      if (Date.now() - start > ms) return reject(new Error(`timeout waiting for ${label}`));
      setTimeout(tick, 10);
    };
    tick();
  });
}

function childScript(update: unknown): string {
  const payload = JSON.stringify(update).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  return `
const r=require('readline').createInterface({input:process.stdin});
r.on('line',l=>{
  let m; try { m=JSON.parse(l); } catch { return; }
  if(m.method==='initialize'){
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{protocolVersion:1}})+'\\n');
    return;
  }
  if(m.method==='session/new'){
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{sessionId:'v1'}})+'\\n');
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'session/update',params:{sessionId:'v1',update:${payload}}})+'\\n');
  }
});
`;
}

async function collectFromUpdate(update: unknown): Promise<AcpUiEvent[]> {
  const client = new StdioAcpClient({
    workspaceRoot: process.cwd(),
    command: process.execPath,
    args: ["-e", childScript(update)],
    env: Object.freeze({}),
    executionProfile: profile,
    initializePermissionMode: "default",
  });
  const events: AcpUiEvent[] = [];
  client.onEvent((e) => events.push(e));
  try {
    await client.initialize();
    await client.newSession();
    await waitFor(
      events,
      (e) => e.type === "available_commands" || (e.type === "agent_log" && e.message.startsWith("Unmapped vendor sessionUpdate kind")),
      "catalog or unmapped",
    );
    return events;
  } finally {
    await client.dispose();
  }
}

test("available_commands_update emits parsed members", async () => {
  const events = await collectFromUpdate({
    sessionUpdate: "available_commands_update",
    availableCommands: [
      { name: "/forge-skill-fixture", description: "Forge skill fixture" },
      { name: "/ok" },
    ],
  });
  const hit = events.find((e) => e.type === "available_commands");
  assert.equal(hit?.type, "available_commands");
  if (hit?.type !== "available_commands") return;
  assert.equal(hit.valid, true);
  assert.deepEqual(hit.commands, [
    { name: "/forge-skill-fixture", description: "Forge skill fixture" },
    { name: "/ok", description: null },
  ]);
});

test("available_commands_update empty list is valid ready-empty", async () => {
  const events = await collectFromUpdate({
    sessionUpdate: "available_commands_update",
    availableCommands: [],
  });
  const hit = events.find((e) => e.type === "available_commands");
  assert.equal(hit?.type, "available_commands");
  if (hit?.type !== "available_commands") return;
  assert.equal(hit.valid, true);
  assert.deepEqual(hit.commands, []);
});

test("malformed member emits valid:false", async () => {
  const events = await collectFromUpdate({
    sessionUpdate: "available_commands_update",
    availableCommands: [{ name: "/ok" }, { name: "no-slash" }],
  });
  const hit = events.find((e) => e.type === "available_commands");
  assert.equal(hit?.type, "available_commands");
  if (hit?.type !== "available_commands") return;
  assert.equal(hit.valid, false);
  assert.equal(hit.commands, null);
});

test("unknown sessionUpdate kind still logs Unmapped vendor sessionUpdate kind", async () => {
  const events = await collectFromUpdate({
    sessionUpdate: "not_a_catalog_kind",
  });
  assert.equal(
    events.some((e) => e.type === "agent_log" && e.message.startsWith("Unmapped vendor sessionUpdate kind")),
    true,
  );
  assert.equal(events.some((e) => e.type === "available_commands"), false);
});
