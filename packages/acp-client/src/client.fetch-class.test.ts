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

function childScriptMany(updates: unknown[]): string {
  const payload = JSON.stringify(updates);
  return `
const r=require('readline').createInterface({input:process.stdin});
const updates=${payload};
r.on('line',l=>{
  let m; try { m=JSON.parse(l); } catch { return; }
  if(m.method==='initialize'){
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{protocolVersion:1}})+'\\n');
    return;
  }
  if(m.method==='session/new'){
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{sessionId:'v1'}})+'\\n');
    for (const u of updates) {
      process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'session/update',params:{sessionId:'v1',update:u}})+'\\n');
    }
  }
});
`;
}

function isFetchClassSignal(e: AcpUiEvent): boolean {
  if (e.type === "tool_run" || e.type === "child_agent") return true;
  if (e.type !== "agent_log") return false;
  return (
    e.message.startsWith("Unmapped vendor sessionUpdate kind") ||
    e.message.startsWith("ToolKind class seam:") ||
    /incomplete|malformed|missing toolCallId|child/i.test(e.message)
  );
}

async function collectFromUpdates(updates: unknown[]): Promise<AcpUiEvent[]> {
  const client = new StdioAcpClient({
    workspaceRoot: process.cwd(),
    command: process.execPath,
    args: ["-e", childScriptMany(updates)],
    env: Object.freeze({}),
    executionProfile: profile,
    initializePermissionMode: "default",
  });
  const events: AcpUiEvent[] = [];
  client.onEvent((e) => events.push(e));
  try {
    await client.initialize();
    await client.newSession();
    await waitFor(events, isFetchClassSignal, "tool_run, child_agent, or log");
    await new Promise((r) => setTimeout(r, 40));
    return events;
  } finally {
    await client.dispose();
  }
}

async function collectFromUpdate(update: unknown): Promise<AcpUiEvent[]> {
  return collectFromUpdates([update]);
}

test("tool_call kind fetch retains acpToolKind fetch (not title??kind only)", async () => {
  const events = await collectFromUpdate({
    sessionUpdate: "tool_call",
    toolCallId: "f1",
    title: "Open docs",
    kind: "fetch",
    status: "pending",
    rawInput: { url: "https://docs.x.ai" },
  });
  const hit = events.find((e) => e.type === "tool_run" && e.toolCallId === "f1");
  assert.ok(hit && hit.type === "tool_run");
  if (hit?.type !== "tool_run") return;
  assert.equal((hit as { acpToolKind?: string }).acpToolKind, "fetch");
  assert.equal((hit as { url?: string | null }).url, "https://docs.x.ai");
  assert.equal(hit.status, "running");
  assert.equal(hit.lifecycle, "pending");
  assert.notEqual((hit as { acpToolKind?: string }).acpToolKind, undefined);
  assert.equal(events.some((e) => e.type === "child_agent"), false);
});

test("first tool_call already completed → succeeded terminal (no coerce to running)", async () => {
  const events = await collectFromUpdate({
    sessionUpdate: "tool_call",
    toolCallId: "f2",
    title: "Fast fetch",
    kind: "fetch",
    status: "completed",
    rawInput: { url: "https://example.com" },
  });
  const hit = events.find((e) => e.type === "tool_run");
  assert.ok(hit && hit.type === "tool_run");
  if (hit?.type !== "tool_run") return;
  assert.equal(hit.status, "succeeded");
  assert.equal(hit.lifecycle, "terminal");
  assert.equal((hit as { acpToolKind?: string }).acpToolKind, "fetch");
});

test("first tool_call failed stays failed terminal", async () => {
  const events = await collectFromUpdate({
    sessionUpdate: "tool_call",
    toolCallId: "f-fail",
    title: "Boom",
    kind: "fetch",
    status: "failed",
  });
  const hit = events.find((e) => e.type === "tool_run");
  assert.ok(hit && hit.type === "tool_run");
  if (hit?.type !== "tool_run") return;
  assert.equal(hit.status, "failed");
  assert.equal(hit.lifecycle, "terminal");
  assert.equal(hit.execution, "executed");
});

test("cancelled / rejected → rejected + not_executed (withhold elevation)", async () => {
  const events = await collectFromUpdate({
    sessionUpdate: "tool_call",
    toolCallId: "f-deny",
    title: "Denied",
    kind: "fetch",
    status: "cancelled",
  });
  const hit = events.find((e) => e.type === "tool_run");
  assert.ok(hit && hit.type === "tool_run");
  if (hit?.type !== "tool_run") return;
  assert.equal(hit.status, "rejected");
  assert.equal(hit.execution, "not_executed");
  assert.equal(hit.lifecycle, "terminal");
  assert.equal((hit as { acpToolKind?: string }).acpToolKind, "fetch");
});

test("omitted / in_progress status maps to vouched running", async () => {
  const omitted = await collectFromUpdate({
    sessionUpdate: "tool_call",
    toolCallId: "f-omit",
    title: "Open",
    kind: "fetch",
  });
  const omitHit = omitted.find((e) => e.type === "tool_run");
  assert.equal(omitHit && omitHit.type === "tool_run" ? omitHit.status : null, "running");

  const progress = await collectFromUpdate({
    sessionUpdate: "tool_call",
    toolCallId: "f-prog",
    title: "Open",
    kind: "fetch",
    status: "in_progress",
  });
  const progHit = progress.find((e) => e.type === "tool_run");
  assert.equal(progHit && progHit.type === "tool_run" ? progHit.status : null, "running");
});

test("fetch content type image → snapshotJournaled true", async () => {
  const events = await collectFromUpdates([
    {
      sessionUpdate: "tool_call",
      toolCallId: "f3",
      title: "Shot",
      kind: "fetch",
      status: "pending",
      rawInput: { url: "https://example.com" },
    },
    {
      sessionUpdate: "tool_call_update",
      toolCallId: "f3",
      status: "completed",
      content: [{ type: "image", mimeType: "image/png", data: "aaa" }],
    },
  ]);
  const hits = events.filter((e) => e.type === "tool_run" && e.toolCallId === "f3");
  assert.ok(hits.length >= 1);
  const terminal = [...hits].reverse().find((e) => e.type === "tool_run" && e.lifecycle === "terminal");
  assert.ok(terminal && terminal.type === "tool_run");
  if (terminal?.type !== "tool_run") return;
  assert.equal((terminal as { snapshotJournaled?: boolean }).snapshotJournaled, true);
  assert.equal((terminal as { acpToolKind?: string }).acpToolKind, "fetch");
  assert.equal(typeof terminal.output === "string" || terminal.output === null, true);
  assert.equal(JSON.stringify(terminal).includes("aaa"), false);
  assert.equal(JSON.stringify(terminal).includes("image/png"), false);
});

test("caption-only: no image content → snapshotJournaled false", async () => {
  const events = await collectFromUpdate({
    sessionUpdate: "tool_call",
    toolCallId: "f-noimg",
    title: "Page",
    kind: "fetch",
    status: "completed",
    rawInput: { url: "https://example.com" },
  });
  const hit = events.find((e) => e.type === "tool_run");
  assert.ok(hit && hit.type === "tool_run");
  if (hit?.type !== "tool_run") return;
  assert.equal((hit as { snapshotJournaled?: boolean }).snapshotJournaled, false);
});

test("ToolKind other → tool_run + ToolKind class seam log; no fetch class", async () => {
  const events = await collectFromUpdate({
    sessionUpdate: "tool_call",
    toolCallId: "x1",
    title: "Browse something",
    kind: "other",
    status: "pending",
  });
  assert.equal(events.some((e) => e.type === "tool_run"), true);
  const run = events.find((e) => e.type === "tool_run");
  assert.notEqual((run as { acpToolKind?: string } | undefined)?.acpToolKind, "fetch");
  assert.equal(
    events.some(
      (e) => e.type === "agent_log" && e.message.startsWith("ToolKind class seam:"),
    ),
    true,
  );
  assert.equal(
    events.some(
      (e) => e.type === "agent_log" && e.message.startsWith("Unmapped vendor sessionUpdate kind"),
    ),
    false,
  );
});

test("ToolKind execute → tool_run + ToolKind class seam log; no fetch", async () => {
  const events = await collectFromUpdate({
    sessionUpdate: "tool_call",
    toolCallId: "x2",
    title: "Run browse",
    kind: "execute",
    status: "pending",
  });
  assert.equal(events.some((e) => e.type === "tool_run"), true);
  assert.notEqual(
    (events.find((e) => e.type === "tool_run") as { acpToolKind?: string } | undefined)?.acpToolKind,
    "fetch",
  );
  assert.equal(
    events.some((e) => e.type === "agent_log" && e.message.startsWith("ToolKind class seam:")),
    true,
  );
});

test("title-only missing kind → tool_run + ToolKind class seam log; no fetch", async () => {
  const events = await collectFromUpdate({
    sessionUpdate: "tool_call",
    toolCallId: "x3",
    title: "Browse https://evil.example",
    status: "pending",
  });
  assert.equal(events.some((e) => e.type === "tool_run"), true);
  assert.notEqual(
    (events.find((e) => e.type === "tool_run") as { acpToolKind?: string } | undefined)?.acpToolKind,
    "fetch",
  );
  assert.equal(
    events.some((e) => e.type === "agent_log" && e.message.startsWith("ToolKind class seam:")),
    true,
  );
});

test("missing kind ordinary write/read → tool_run; no ToolKind class seam spam", async () => {
  for (const title of ["Write file", "Read notes.md", "search_replace"]) {
    const events = await collectFromUpdate({
      sessionUpdate: "tool_call",
      toolCallId: "m1",
      title,
      status: "pending",
    });
    assert.equal(events.some((e) => e.type === "tool_run"), true, title);
    assert.equal(
      events.some((e) => e.type === "agent_log" && e.message.startsWith("ToolKind class seam:")),
      false,
      title,
    );
    assert.notEqual(
      (events.find((e) => e.type === "tool_run") as { acpToolKind?: string } | undefined)?.acpToolKind,
      "fetch",
      title,
    );
  }
});

test("ordinary kind read → tool_run; no ToolKind class seam spam; no fetch", async () => {
  const events = await collectFromUpdate({
    sessionUpdate: "tool_call",
    toolCallId: "r1",
    title: "Read notes",
    kind: "read",
    status: "pending",
  });
  assert.equal(events.some((e) => e.type === "tool_run"), true);
  assert.equal(
    events.some(
      (e) => e.type === "agent_log" && e.message.startsWith("ToolKind class seam:"),
    ),
    false,
  );
  assert.notEqual(
    (events.find((e) => e.type === "tool_run") as { acpToolKind?: string } | undefined)?.acpToolKind,
    "fetch",
  );
});

test("missing toolCallId → ignore+log; no tool_run", async () => {
  const events = await collectFromUpdate({
    sessionUpdate: "tool_call",
    title: "No id",
    kind: "fetch",
    status: "pending",
  });
  assert.equal(events.some((e) => e.type === "tool_run"), false);
  assert.equal(
    events.some((e) => e.type === "agent_log" && /missing toolCallId|malformed/i.test(e.message)),
    true,
  );
});

test("locations[0].path used when rawInput.url absent", async () => {
  const events = await collectFromUpdate({
    sessionUpdate: "tool_call",
    toolCallId: "f4",
    title: "Loc",
    kind: "fetch",
    status: "pending",
    locations: [{ path: "https://via-location.example" }],
  });
  const hit = events.find((e) => e.type === "tool_run");
  assert.equal((hit as { url?: string | null } | undefined)?.url, "https://via-location.example");
});

test("tool_call_update running→succeeded preserves acpToolKind from prior map", async () => {
  const events = await collectFromUpdates([
    {
      sessionUpdate: "tool_call",
      toolCallId: "f5",
      title: "Docs",
      kind: "fetch",
      status: "pending",
      rawInput: { url: "https://docs.x.ai" },
    },
    {
      sessionUpdate: "tool_call_update",
      toolCallId: "f5",
      status: "completed",
    },
  ]);
  const runs = events.filter((e) => e.type === "tool_run" && e.toolCallId === "f5");
  assert.ok(runs.length >= 2);
  const first = runs[0];
  const last = runs[runs.length - 1];
  assert.equal(first && first.type === "tool_run" ? first.status : null, "running");
  assert.equal(last && last.type === "tool_run" ? last.status : null, "succeeded");
  assert.equal((last as { acpToolKind?: string } | undefined)?.acpToolKind, "fetch");
  assert.equal((last as { url?: string | null } | undefined)?.url, "https://docs.x.ai");
  assert.equal(events.some((e) => e.type === "child_agent"), false);
});
