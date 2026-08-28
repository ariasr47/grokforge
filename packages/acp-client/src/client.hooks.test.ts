import test from "node:test";
import assert from "node:assert/strict";
import { StdioAcpClient } from "./client.js";
import type { AcpUiEvent, HostExecutionProfile } from "./types.js";
import {
  NAMED_HOOKS_EXECUTION_KIND,
  NAMED_HOOKS_JSONRPC_LIST,
  NAMED_HOOKS_JSONRPC_METHOD,
  NAMED_HOOKS_SESSION_UPDATE,
  mapVendorHookStatus,
} from "./hooksAdvertisement.js";
import { NAMED_MCP_JSONRPC_STATUS } from "./mcpAdvertisement.js";

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

function childScript(opts: { notifications?: unknown[]; listResult?: unknown }): string {
  const payload = JSON.stringify(opts.notifications ?? []).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const list = JSON.stringify(opts.listResult ?? { result: { hooks: [], projectTrusted: true } }).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  return `
const r=require('readline').createInterface({input:process.stdin});
const notes=${payload};
const list=${list};
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
    return;
  }
  if(m.method==='${NAMED_HOOKS_JSONRPC_LIST}'){
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:list})+'\\n');
  }
});
`;
}

function isHookSignal(e: AcpUiEvent): boolean {
  if (e.type === "hook" || e.type === "tool_run" || e.type === "child_agent" || e.type === "available_commands" || e.type === "mcp_server") {
    return true;
  }
  if (e.type !== "agent_log") return false;
  return (
    e.message.startsWith("Unmapped vendor sessionUpdate kind") ||
    e.message.startsWith("Unmapped vendor hooks") ||
    /malformed|incomplete|hooks/i.test(e.message)
  );
}

async function collect(opts: {
  notifications?: unknown[];
  listResult?: unknown;
  listAfter?: boolean;
}): Promise<AcpUiEvent[]> {
  const client = new StdioAcpClient({
    workspaceRoot: process.cwd(),
    command: process.execPath,
    args: ["-e", childScript(opts)],
    env: Object.freeze({}),
    executionProfile: profile,
    initializePermissionMode: "default",
  });
  const events: AcpUiEvent[] = [];
  client.onEvent((e) => events.push(e));
  try {
    await client.initialize();
    const sid = await client.newSession();
    if (opts.listAfter) {
      await client.listVendorHooks(sid);
    }
    await waitFor(events, isHookSignal, "hook, tool_run, or log");
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

function hookExecution(runs: unknown[], extra: Record<string, unknown> = {}) {
  return {
    jsonrpc: "2.0",
    method: NAMED_HOOKS_JSONRPC_METHOD,
    params: {
      sessionId: "v1",
      update: {
        sessionUpdate: NAMED_HOOKS_EXECUTION_KIND,
        event_name: "pre_tool_use",
        tool_name: "write",
        runs,
        ...extra,
      },
    },
  };
}

test("GATE pin is the live JSON-RPC session_notification + list, not an invented sessionUpdate", () => {
  assert.equal(NAMED_HOOKS_JSONRPC_METHOD, "_x.ai/session_notification");
  assert.equal(NAMED_HOOKS_JSONRPC_LIST, "_x.ai/hooks/list");
  assert.equal(NAMED_HOOKS_SESSION_UPDATE, "");
  assert.equal(NAMED_HOOKS_EXECUTION_KIND, "hook_execution");
  assert.equal(mapVendorHookStatus(false), "idle");
  assert.equal(mapVendorHookStatus(true), "idle");
  assert.equal(mapVendorHookStatus("success"), "done");
  assert.equal(mapVendorHookStatus("failed"), "failed");
  assert.equal(mapVendorHookStatus("skipped"), "idle");
  assert.equal(mapVendorHookStatus("running"), null);
  assert.equal(mapVendorHookStatus("nope"), null);
});

test("named hooks advertisement → hook event", async () => {
  const events = await collect({
    notifications: [
      hookExecution([
        { name: "project/spire-path-guard:pre_tool_use[0].hooks[0]", status: { status: "success", elapsed_ms: 246 } },
      ]),
    ],
  });
  const hit = events.find((e) => e.type === "hook");
  assert.equal(hit?.type, "hook");
  if (hit?.type !== "hook") return;
  assert.equal(hit.hookId, "project/spire-path-guard:pre_tool_use[0].hooks[0]");
  assert.equal(hit.name, "project/spire-path-guard:pre_tool_use[0].hooks[0]");
  assert.equal(hit.status, "done");
  assert.equal(events.some((e) => e.type === "tool_run"), false);
  assert.equal(events.some((e) => e.type === "child_agent"), false);
  assert.equal(events.some((e) => e.type === "thinking_delta"), false);
  assert.equal(events.some((e) => e.type === "text_delta"), false);
  assert.equal(events.some((e) => e.type === "available_commands"), false);
  assert.equal(events.some((e) => e.type === "mcp_server"), false);
});

test("incomplete hooks frame → ignore+log; no hook", async () => {
  const events = await collect({
    notifications: [hookExecution([{ name: "project/settings:pre_tool_use[0].hooks[0]" }])],
  });
  assert.equal(events.some((e) => e.type === "hook"), false);
  assert.equal(
    events.some((e) => e.type === "agent_log" && /incomplete|malformed|hooks/i.test(e.message)),
    true,
  );
});

test("ordinary tool_call still tool_run; never hook", async () => {
  const events = await collect({
    notifications: [
      sessionUpdate({
        sessionUpdate: "tool_call",
        toolCallId: "t1",
        title: "write",
        kind: "edit",
        status: "pending",
      }),
    ],
  });
  assert.equal(events.some((e) => e.type === "tool_run"), true);
  assert.equal(events.some((e) => e.type === "hook"), false);
});

test("available_commands_update never hook", async () => {
  const events = await collect({
    notifications: [
      sessionUpdate({
        sessionUpdate: "available_commands_update",
        availableCommands: [{ name: "/compact", description: "Compress" }],
      }),
    ],
  });
  assert.equal(events.some((e) => e.type === "available_commands"), true);
  assert.equal(events.some((e) => e.type === "hook"), false);
});

test("MCP _x.ai/mcp/server_status never hook", async () => {
  const events = await collect({
    notifications: [
      {
        jsonrpc: "2.0",
        method: NAMED_MCP_JSONRPC_STATUS,
        params: { sessionId: "v1", name: "railway", status: "ready", source: "local" },
      },
    ],
  });
  assert.equal(events.some((e) => e.type === "mcp_server"), true);
  assert.equal(events.some((e) => e.type === "hook"), false);
});

test("unknown dedicated method/kind logs Unmapped; not silent success", async () => {
  const events = await collect({
    notifications: [sessionUpdate({ sessionUpdate: "nested_hooks_v2" })],
  });
  assert.equal(
    events.some((e) => e.type === "agent_log" && e.message.startsWith("Unmapped vendor sessionUpdate kind")),
    true,
  );
  assert.equal(events.some((e) => e.type === "hook"), false);
  assert.equal(events.some((e) => e.type === "tool_run"), false);
});

test("invented sessionUpdate hooks kind without GATE evidence must not emit hook", async () => {
  const events = await collect({
    notifications: [
      sessionUpdate({
        sessionUpdate: NAMED_HOOKS_EXECUTION_KIND || "hook_execution",
        runs: [{ name: "invented", status: { status: "success" } }],
      }),
    ],
  });
  assert.equal(events.some((e) => e.type === "hook"), false);
  assert.equal(
    events.some((e) => e.type === "agent_log" && e.message.startsWith("Unmapped vendor sessionUpdate kind")),
    true,
  );
});

test("hooks list roster maps disabled boolean to idle and does not invent a name", async () => {
  const events = await collect({
    listAfter: true,
    listResult: {
      result: {
        hooks: [
          {
            name: "project/spire-path-guard:pre_tool_use[0].hooks[0]",
            event: "pre_tool_use",
            handlerType: "command",
            matcher: "Write|Edit",
            command: "node .grok/tools/path_guard.js --protocol grok",
            url: null,
            timeoutMs: 30000,
            sourceDir: "C:/Dev/grokforge/.grok/hooks",
            disabled: false,
          },
        ],
        projectTrusted: true,
      },
    },
    notifications: [],
  });
  const hit = events.find((e) => e.type === "hook");
  assert.equal(hit?.type, "hook");
  if (hit?.type !== "hook") return;
  assert.equal(hit.hookId, "project/spire-path-guard:pre_tool_use[0].hooks[0]");
  assert.equal(hit.status, "idle");
  assert.notEqual(hit.name, "path_guard");
});
