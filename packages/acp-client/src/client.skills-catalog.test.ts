import test from "node:test";
import assert from "node:assert/strict";
// Skills catalog is vendor-advertised, not a Forge skills engine.
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

/** Same shape on both twin sites. Junk-last-only is insufficient. */
const INTERIOR_JUNK_CASES: Array<{ label: string; junk: unknown }> = [
  { label: "whitespace-name", junk: { name: "has space" } },
  { label: "number", junk: 1 },
  { label: "null", junk: null },
  { label: "raw-string", junk: "raw" },
];

function interiorJunkPayload(junk: unknown) {
  return [
    { name: "/a", description: null },
    junk,
    { name: "/b", description: "bee" },
  ];
}

const EXPECTED_AFTER_SKIP = [
  { name: "/a", description: null },
  { name: "/b", description: "bee" },
];

for (const { label, junk } of INTERIOR_JUNK_CASES) {
  test(`interior-junk (${label}) emits valid with /a and /b`, async () => {
    const events = await collectFromUpdate({
      sessionUpdate: "available_commands_update",
      availableCommands: interiorJunkPayload(junk),
    });
    const hit = events.find((e) => e.type === "available_commands");
    assert.equal(hit?.type, "available_commands");
    if (hit?.type !== "available_commands") return;
    assert.equal(hit.valid, true);
    assert.deepEqual(hit.commands, EXPECTED_AFTER_SKIP);
  });
}

test("non-empty all-skipped emits valid:false (not ready-empty)", async () => {
  const events = await collectFromUpdate({
    sessionUpdate: "available_commands_update",
    availableCommands: [{ name: "has space" }, 1, null],
  });
  const hit = events.find((e) => e.type === "available_commands");
  assert.equal(hit?.type, "available_commands");
  if (hit?.type !== "available_commands") return;
  assert.equal(hit.valid, false);
  assert.equal(hit.commands, null);
});

test("ACP names without slash normalize to /name", async () => {
  const events = await collectFromUpdate({
    sessionUpdate: "available_commands_update",
    availableCommands: [
      { name: "web", description: "Search the web" },
      { name: "/ok" },
      { name: "plan", description: "Create a plan" },
    ],
  });
  const hit = events.find((e) => e.type === "available_commands");
  assert.equal(hit?.type, "available_commands");
  if (hit?.type !== "available_commands") return;
  assert.equal(hit.valid, true);
  assert.deepEqual(hit.commands, [
    { name: "/web", description: "Search the web" },
    { name: "/ok", description: null },
    { name: "/plan", description: "Create a plan" },
  ]);
});

test("mixed junk-last still valid with accepted /ok", async () => {
  const events = await collectFromUpdate({
    sessionUpdate: "available_commands_update",
    availableCommands: [{ name: "/ok" }, { name: "has space" }],
  });
  const hit = events.find((e) => e.type === "available_commands");
  assert.equal(hit?.type, "available_commands");
  if (hit?.type !== "available_commands") return;
  assert.equal(hit.valid, true);
  assert.deepEqual(hit.commands, [{ name: "/ok", description: null }]);
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

test("session_info_update and user_message_chunk are known no-ops, not unmapped", async () => {
  for (const kind of ["session_info_update", "user_message_chunk", "current_mode_update"]) {
    const client = new StdioAcpClient({
      workspaceRoot: process.cwd(),
      command: process.execPath,
      args: ["-e", childScript({ sessionUpdate: kind })],
      env: Object.freeze({}),
      executionProfile: profile,
      initializePermissionMode: "default",
    });
    const events: AcpUiEvent[] = [];
    client.onEvent((e) => events.push(e));
    try {
      await client.initialize();
      await client.newSession();
      await new Promise((r) => setTimeout(r, 80));
      assert.equal(
        events.some((e) => e.type === "agent_log" && e.message.startsWith("Unmapped vendor sessionUpdate kind")),
        false,
        kind,
      );
    } finally {
      await client.dispose();
    }
  }
});

test("mixed invalid available_commands members skip as one summary warn", async () => {
  const events = await collectFromUpdate({
    sessionUpdate: "available_commands_update",
    availableCommands: [
      { name: "/ok", description: "ok" },
      { name: "has space" },
      1,
      null,
    ],
  });
  const skips = events.filter((e) => e.type === "agent_log" && /Skipped \d+ unusable available_commands members/.test(e.message));
  assert.equal(skips.length, 1);
  assert.equal(skips[0]?.type === "agent_log" && skips[0].message, "Skipped 3 unusable available_commands members.");
});
