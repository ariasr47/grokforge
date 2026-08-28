import test from "node:test";
import assert from "node:assert/strict";
import { StdioAcpClient } from "./client.js";
import type { AcpUiEvent, HostExecutionProfile } from "./types.js";
import {
  NAMED_MCP_JSONRPC_SERVERS_UPDATED,
  NAMED_MCP_JSONRPC_STATUS,
  NAMED_MCP_SESSION_UPDATE,
  mapVendorMcpStatus,
} from "./mcpAdvertisement.js";

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

function childScriptNotifications(notifications: unknown[]): string {
  const payload = JSON.stringify(notifications).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  return `
const r=require('readline').createInterface({input:process.stdin});
const notes=${payload};
r.on('line',l=>{
  let m; try { m=JSON.parse(l); } catch { return; }
  if(m.method==='initialize'){
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{protocolVersion:1}})+'\\n');
    return;
  }
  if(m.method==='session/new'){
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{sessionId:'v1'}})+'\\n');
    for (const n of notes) {
      process.stdout.write(JSON.stringify(n)+'\\n');
    }
  }
});
`;
}

function isMcpSignal(e: AcpUiEvent): boolean {
  if (e.type === "mcp_server" || e.type === "tool_run" || e.type === "child_agent" || e.type === "available_commands") {
    return true;
  }
  if (e.type !== "agent_log") return false;
  return (
    e.message.startsWith("Unmapped vendor sessionUpdate kind") ||
    /malformed|incomplete|mcp/i.test(e.message)
  );
}

async function collectFromNotifications(notifications: unknown[]): Promise<AcpUiEvent[]> {
  const client = new StdioAcpClient({
    workspaceRoot: process.cwd(),
    command: process.execPath,
    args: ["-e", childScriptNotifications(notifications)],
    env: Object.freeze({}),
    executionProfile: profile,
    initializePermissionMode: "default",
  });
  const events: AcpUiEvent[] = [];
  client.onEvent((e) => events.push(e));
  try {
    await client.initialize();
    await client.newSession();
    await waitFor(events, isMcpSignal, "mcp_server, tool_run, or log");
    await new Promise((r) => setTimeout(r, 40));
    return events;
  } finally {
    await client.dispose();
  }
}

function sessionUpdate(update: unknown) {
  return {
    jsonrpc: "2.0",
    method: "session/update",
    params: { sessionId: "v1", update },
  };
}

function mcpStatus(params: Record<string, unknown>) {
  return {
    jsonrpc: "2.0",
    method: NAMED_MCP_JSONRPC_STATUS,
    params: { sessionId: "v1", ...params },
  };
}

test("GATE pin is the live JSON-RPC status method, not an invented sessionUpdate", () => {
  assert.equal(NAMED_MCP_SESSION_UPDATE, "_x.ai/mcp/server_status");
  assert.equal(NAMED_MCP_JSONRPC_STATUS, "_x.ai/mcp/server_status");
  assert.equal(NAMED_MCP_JSONRPC_SERVERS_UPDATED, "_x.ai/mcp/servers_updated");
  assert.equal(mapVendorMcpStatus("ready"), "connected");
  assert.equal(mapVendorMcpStatus("unavailable"), "error");
  assert.equal(mapVendorMcpStatus("idle"), "idle");
  assert.equal(mapVendorMcpStatus("nope"), null);
});

test("named MCP sessionUpdate → mcp_server event", async () => {
  const events = await collectFromNotifications([
    mcpStatus({ name: "railway", status: "ready", source: "local", reason: "initialized" }),
  ]);
  const hit = events.find((e) => e.type === "mcp_server");
  assert.equal(hit?.type, "mcp_server");
  if (hit?.type !== "mcp_server") return;
  assert.equal(hit.serverId, "railway");
  assert.equal(hit.name, "railway");
  assert.equal(hit.status, "connected");
  assert.equal(events.some((e) => e.type === "tool_run"), false);
  assert.equal(events.some((e) => e.type === "child_agent"), false);
  assert.equal(events.some((e) => e.type === "thinking_delta"), false);
  assert.equal(events.some((e) => e.type === "text_delta"), false);
  assert.equal(events.some((e) => e.type === "available_commands"), false);
});

test("incomplete MCP frame → ignore+log; no mcp_server", async () => {
  const events = await collectFromNotifications([
    mcpStatus({ name: "figma" }),
  ]);
  assert.equal(events.some((e) => e.type === "mcp_server"), false);
  assert.equal(
    events.some((e) => e.type === "agent_log" && /incomplete|malformed|mcp/i.test(e.message)),
    true,
  );
});

test("ordinary tool_call still tool_run; never mcp_server", async () => {
  const events = await collectFromNotifications([
    sessionUpdate({
      sessionUpdate: "tool_call",
      toolCallId: "t1",
      title: "chrome-devtools__new_page",
      kind: "other",
      status: "pending",
    }),
  ]);
  assert.equal(events.some((e) => e.type === "tool_run"), true);
  assert.equal(events.some((e) => e.type === "mcp_server"), false);
});

test("available_commands_update never mcp_server", async () => {
  const events = await collectFromNotifications([
    sessionUpdate({
      sessionUpdate: "available_commands_update",
      availableCommands: [{ name: "/compact", description: "Compress" }],
    }),
  ]);
  assert.equal(events.some((e) => e.type === "available_commands"), true);
  assert.equal(events.some((e) => e.type === "mcp_server"), false);
});

test("unknown dedicated kind logs Unmapped vendor sessionUpdate kind", async () => {
  const events = await collectFromNotifications([
    sessionUpdate({ sessionUpdate: "nested_mcp_v2" }),
  ]);
  assert.equal(
    events.some((e) => e.type === "agent_log" && e.message.startsWith("Unmapped vendor sessionUpdate kind")),
    true,
  );
  assert.equal(events.some((e) => e.type === "mcp_server"), false);
  assert.equal(events.some((e) => e.type === "tool_run"), false);
});

test("disconnected/failed-equivalent maps to error", async () => {
  const events = await collectFromNotifications([
    mcpStatus({
      name: "figma",
      status: "unavailable",
      reason: "handshake_failed",
    }),
  ]);
  const hit = events.find((e) => e.type === "mcp_server");
  assert.equal(hit?.type, "mcp_server");
  if (hit?.type !== "mcp_server") return;
  assert.equal(hit.status, "error");
  assert.equal(hit.serverId, "figma");
});

test("servers_updated without status is incomplete; no mcp_server", async () => {
  const events = await collectFromNotifications([
    {
      jsonrpc: "2.0",
      method: NAMED_MCP_JSONRPC_SERVERS_UPDATED,
      params: {
        mcpServers: [{ name: "railway", command: "railway", args: ["mcp"] }],
      },
    },
  ]);
  assert.equal(events.some((e) => e.type === "mcp_server"), false);
  assert.equal(
    events.some((e) => e.type === "agent_log" && /incomplete|malformed|mcp/i.test(e.message)),
    true,
  );
});
