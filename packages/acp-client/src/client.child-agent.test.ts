import test from "node:test";
import assert from "node:assert/strict";
// Child-agent spawn is vendor ACP, not a Forge subagent engine.
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

function isChildAgentSignal(e: AcpUiEvent): boolean {
  if (e.type === "child_agent" || e.type === "tool_run") return true;
  if (e.type !== "agent_log") return false;
  return (
    e.message.startsWith("Unmapped vendor sessionUpdate kind") ||
    /incomplete|malformed|child/i.test(e.message)
  );
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
    await waitFor(events, isChildAgentSignal, "child_agent, tool_run, or log");
    await new Promise((r) => setTimeout(r, 40));
    return events;
  } finally {
    await client.dispose();
  }
}

test("sessionUpdate agent complete → child_agent event", async () => {
  const events = await collectFromUpdate({
    sessionUpdate: "agent",
    childId: "child-1",
    identityLabel: "Researcher",
    status: "running",
  });
  const hit = events.find((e) => e.type === "child_agent");
  assert.equal(hit?.type, "child_agent");
  if (hit?.type !== "child_agent") return;
  assert.equal(hit.childId, "child-1");
  assert.equal(hit.identityLabel, "Researcher");
  assert.equal(hit.status, "running");
  assert.equal(events.some((e) => e.type === "tool_run"), false);
  assert.equal(events.some((e) => e.type === "thinking_delta"), false);
  assert.equal(events.some((e) => e.type === "text_delta"), false);
});

test("sessionUpdate agent first-frame done is legal", async () => {
  const events = await collectFromUpdate({
    sessionUpdate: "agent",
    childId: "child-2",
    identityLabel: "Fast",
    status: "done",
  });
  const hit = events.find((e) => e.type === "child_agent");
  assert.equal(hit?.type, "child_agent");
  if (hit?.type !== "child_agent") return;
  assert.equal(hit.status, "done");
});

test("incomplete agent frame → ignore+log; no child_agent", async () => {
  const events = await collectFromUpdate({
    sessionUpdate: "agent",
    childId: "child-3",
    identityLabel: "MissingStatus",
  });
  assert.equal(events.some((e) => e.type === "child_agent"), false);
  assert.equal(
    events.some((e) => e.type === "agent_log" && /incomplete|malformed|child/i.test(e.message)),
    true,
  );
});

test("ordinary tool_call still emits tool_run; never child_agent", async () => {
  const events = await collectFromUpdate({
    sessionUpdate: "tool_call",
    toolCallId: "t1",
    title: "Read notes",
    kind: "read",
    status: "pending",
  });
  assert.equal(events.some((e) => e.type === "tool_run"), true);
  assert.equal(events.some((e) => e.type === "child_agent"), false);
});

test("unknown dedicated kind logs Unmapped vendor sessionUpdate kind", async () => {
  const events = await collectFromUpdate({ sessionUpdate: "nested_agent_v2" });
  assert.equal(
    events.some((e) => e.type === "agent_log" && e.message.startsWith("Unmapped vendor sessionUpdate kind")),
    true,
  );
  assert.equal(events.some((e) => e.type === "child_agent"), false);
  assert.equal(events.some((e) => e.type === "tool_run"), false);
});
