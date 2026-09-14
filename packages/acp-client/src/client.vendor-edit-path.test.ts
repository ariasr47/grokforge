import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
// Vendor edit path is advertised ACP, not a Forge file editor.
import { StdioAcpClient } from "./client.js";
import type { AcpUiEvent, HostExecutionProfile, ToolRunEvent } from "./types.js";

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

function childScript(update: unknown): string {
  const payload = JSON.stringify([update]);
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

async function rmQuiet(root: string): Promise<void> {
  for (let i = 0; i < 8; i++) {
    try {
      await fs.rm(root, { recursive: true, force: true });
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EBUSY" && code !== "ENOTEMPTY") throw err;
      await new Promise((r) => setTimeout(r, 40 * (i + 1)));
    }
  }
}

test("vendor Write title stamps fs path onto tool_run for File changes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "forge-title-"));
  const rel = "docs/dogfood/LOOP.md";
  const abs = path.join(root, rel);
  const script = childScript({
    sessionUpdate: "tool_call",
    toolCallId: "w1",
    title: `Write \`${abs}\``,
    kind: "edit",
    status: "completed",
  });
  const client = new StdioAcpClient({
    workspaceRoot: root,
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
    await client.newSession();
    await new Promise((r) => setTimeout(r, 80));
    const hit = events.find((e): e is ToolRunEvent => e.type === "tool_run");
    assert.ok(hit);
    assert.equal(hit.path, rel);
    assert.equal(hit.path?.includes(":") || /\\/.test(String(hit.path)), false, "display path is workspace-relative");
    assert.equal(hit.kind, "content");
    assert.equal(hit.editId, "w1");
  } finally {
    await client.dispose();
    await rmQuiet(root);
  }
});

test("vendor write file_path + content stamps relative path and a new-file diff", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "forge-new-"));
  const rel = "docs/dogfood/REL.md";
  const abs = path.join(root, rel);
  const script = childScript({
    sessionUpdate: "tool_call",
    toolCallId: "w2",
    title: "write",
    kind: "edit",
    status: "completed",
    rawInput: {
      file_path: abs,
      content: "REL-OK\n",
    },
  });
  const client = new StdioAcpClient({
    workspaceRoot: root,
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
    await client.newSession();
    await new Promise((r) => setTimeout(r, 80));
    const hit = events.find((e): e is ToolRunEvent => e.type === "tool_run");
    assert.ok(hit);
    assert.equal(hit.path, rel.replace(/\\/g, "/"));
    assert.equal(hit.kind, "content");
    assert.equal(hit.editId, "w2");
    assert.match(String(hit.diff), /\+REL-OK/);
    assert.match(String(hit.diff), /\/dev\/null/);
    assert.match(String(hit.diff), /docs\/dogfood\/REL\.md/);
  } finally {
    await client.dispose();
    await rmQuiet(root);
  }
});

test("vendor search_replace stamps a hunk from old_string to new_string", async () => {
  const script = childScript({
    sessionUpdate: "tool_call",
    toolCallId: "sr1",
    title: "search replace",
    kind: "edit",
    status: "completed",
    rawInput: {
      path: "apps/shell/src/RunSurface.tsx",
      old_string: "      <p>\n        Policy: review\n      </p>",
      new_string: "      {showPolicy ? (\n        <p>\n          Policy: review\n        </p>\n      ) : null}",
    },
  });
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
    await client.newSession();
    await new Promise((r) => setTimeout(r, 80));
    const hit = events.find((e): e is ToolRunEvent => e.type === "tool_run");
    assert.ok(hit);
    assert.equal(hit.path, "apps/shell/src/RunSurface.tsx");
    assert.match(String(hit.diff), /--- a\/apps\/shell\/src\/RunSurface\.tsx/);
    assert.match(String(hit.diff), /-      <p>/);
    assert.match(String(hit.diff), /\+      \{showPolicy \? \(/);
    assert.equal(String(hit.diff).includes("/dev/null"), false);
  } finally {
    await client.dispose();
  }
});

test("stale vendor old_string uses the on-disk baseline as the minus side", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "forge-stale-"));
  const rel = "docs/dogfood/STALE.md";
  const abs = path.join(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, "NEXT-TWO\n", "utf8");
  const script = childScript({
    sessionUpdate: "tool_call",
    toolCallId: "sr-stale",
    title: "search replace",
    kind: "edit",
    status: "completed",
    rawInput: {
      path: abs,
      old_string: "NEXT-OK\n",
      new_string: "NEXT-THREE\n",
    },
  });
  const client = new StdioAcpClient({
    workspaceRoot: root,
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
    await client.newSession();
    await new Promise((r) => setTimeout(r, 80));
    const hit = events.find((e): e is ToolRunEvent => e.type === "tool_run");
    assert.ok(hit);
    const diff = String(hit.diff);
    assert.match(diff, /-NEXT-TWO/);
    assert.match(diff, /\+NEXT-THREE/);
    assert.equal(diff.includes("-NEXT-OK"), false);
  } finally {
    await client.dispose();
    await rmQuiet(root);
  }
});

test("message chunk after a vendor tool starts a new paragraph", async () => {
  const script = `
const r=require('readline').createInterface({input:process.stdin});
r.on('line',l=>{
  let m; try { m=JSON.parse(l); } catch { return; }
  if(m.method==='initialize'){
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{protocolVersion:1}})+'\\n');
    return;
  }
  if(m.method==='session/new'){
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{sessionId:'v1'}})+'\\n');
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'session/update',params:{sessionId:'v1',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'I will write then stop.'}}}})+'\\n');
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'session/update',params:{sessionId:'v1',update:{sessionUpdate:'tool_call',toolCallId:'w1',title:'Write notes.md',kind:'edit',status:'completed'}}})+'\\n');
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'session/update',params:{sessionId:'v1',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Wrote notes.md.'}}}})+'\\n');
  }
});
`;
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
    await client.newSession();
    await new Promise((r) => setTimeout(r, 80));
    const texts = events.filter((e) => e.type === "text_delta").map((e) => e.text);
    assert.deepEqual(texts, ["I will write then stop.", "\n\nWrote notes.md."]);
  } finally {
    await client.dispose();
  }
});

test("thought chunk after a vendor tool starts a new paragraph", async () => {
  const script = `
const r=require('readline').createInterface({input:process.stdin});
r.on('line',l=>{
  let m; try { m=JSON.parse(l); } catch { return; }
  if(m.method==='initialize'){
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{protocolVersion:1}})+'\\n');
    return;
  }
  if(m.method==='session/new'){
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{sessionId:'v1'}})+'\\n');
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'session/update',params:{sessionId:'v1',update:{sessionUpdate:'agent_thought_chunk',content:{type:'text',text:'I will write.'}}}})+'\\n');
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'session/update',params:{sessionId:'v1',update:{sessionUpdate:'tool_call',toolCallId:'w1',title:'Write notes.md',kind:'edit',status:'completed'}}})+'\\n');
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'session/update',params:{sessionId:'v1',update:{sessionUpdate:'agent_thought_chunk',content:{type:'text',text:'The write is done.'}}}})+'\\n');
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'session/update',params:{sessionId:'v1',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Wrote notes.md.'}}}})+'\\n');
  }
});
`;
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
    await client.newSession();
    await new Promise((r) => setTimeout(r, 80));
    const thoughts = events.filter((e) => e.type === "thinking_delta").map((e) => e.text);
    const texts = events.filter((e) => e.type === "text_delta").map((e) => e.text);
    assert.deepEqual(thoughts, ["I will write.", "\n\nThe write is done."]);
    assert.deepEqual(texts, ["\n\nWrote notes.md."]);
  } finally {
    await client.dispose();
  }
});

test("pending then completed tool_call does not double-break thought", async () => {
  const script = `
const r=require('readline').createInterface({input:process.stdin});
r.on('line',l=>{
  let m; try { m=JSON.parse(l); } catch { return; }
  if(m.method==='initialize'){
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{protocolVersion:1}})+'\\n');
    return;
  }
  if(m.method==='session/new'){
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{sessionId:'v1'}})+'\\n');
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'session/update',params:{sessionId:'v1',update:{sessionUpdate:'agent_thought_chunk',content:{type:'text',text:'Will write.'}}}})+'\\n');
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'session/update',params:{sessionId:'v1',update:{sessionUpdate:'tool_call',toolCallId:'w1',title:'Write notes.md',kind:'edit',status:'pending'}}})+'\\n');
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'session/update',params:{sessionId:'v1',update:{sessionUpdate:'tool_call_update',toolCallId:'w1',status:'completed'}}})+'\\n');
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'session/update',params:{sessionId:'v1',update:{sessionUpdate:'agent_thought_chunk',content:{type:'text',text:'Done writing.'}}}})+'\\n');
  }
});
`;
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
    await client.newSession();
    await new Promise((r) => setTimeout(r, 80));
    const thoughts = events.filter((e) => e.type === "thinking_delta").map((e) => e.text);
    assert.deepEqual(thoughts, ["Will write.", "\n\nDone writing."]);
  } finally {
    await client.dispose();
  }
});

test("overwrite of an existing file diffs against the on-disk before-image", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "forge-ow-"));
  const rel = "docs/dogfood/CHIPS.md";
  await fs.mkdir(path.join(root, "docs/dogfood"), { recursive: true });
  await fs.writeFile(path.join(root, rel), "CHIPS-OK\n", "utf8");
  const script = childScript({
    sessionUpdate: "tool_call",
    toolCallId: "w3",
    title: "write",
    kind: "edit",
    status: "completed",
    rawInput: {
      file_path: path.join(root, rel),
      content: "CHIPS-TWO\n",
    },
  });
  const client = new StdioAcpClient({
    workspaceRoot: root,
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
    await client.newSession();
    await new Promise((r) => setTimeout(r, 80));
    const hit = events.find((e): e is ToolRunEvent => e.type === "tool_run");
    assert.ok(hit);
    assert.equal(hit.path, rel.replace(/\\/g, "/"));
    assert.match(String(hit.diff), /--- a\/docs\/dogfood\/CHIPS\.md/);
    assert.match(String(hit.diff), /-CHIPS-OK/);
    assert.match(String(hit.diff), /\+CHIPS-TWO/);
    assert.equal(String(hit.diff).includes("/dev/null"), false);
  } finally {
    await client.dispose();
    await rmQuiet(root);
  }
});

test("late snapshot of an already-written file still stamps a new-file diff", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "forge-late-"));
  const rel = "docs/dogfood/THOUGHT.md";
  await fs.mkdir(path.join(root, "docs/dogfood"), { recursive: true });
  await fs.writeFile(path.join(root, rel), "THOUGHT-OK\n", "utf8");
  const script = childScript({
    sessionUpdate: "tool_call",
    toolCallId: "w-late",
    title: "write",
    kind: "edit",
    status: "completed",
    rawInput: {
      file_path: path.join(root, rel),
      content: "THOUGHT-OK\n",
    },
  });
  const client = new StdioAcpClient({
    workspaceRoot: root,
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
    await client.newSession();
    await new Promise((r) => setTimeout(r, 80));
    const hit = events.find((e): e is ToolRunEvent => e.type === "tool_run");
    assert.ok(hit);
    assert.match(String(hit.diff), /\+THOUGHT-OK/);
    assert.match(String(hit.diff), /\/dev\/null/);
  } finally {
    await client.dispose();
    await rmQuiet(root);
  }
});

test("completed write without rawInput content uses on-disk body for the diff", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "forge-disk-"));
  const rel = "docs/dogfood/DISK.md";
  await fs.mkdir(path.join(root, "docs/dogfood"), { recursive: true });
  await fs.writeFile(path.join(root, rel), "DISK-OK\n", "utf8");
  const script = childScript({
    sessionUpdate: "tool_call",
    toolCallId: "w-disk",
    title: `Write \`${path.join(root, rel)}\``,
    kind: "edit",
    status: "completed",
  });
  const client = new StdioAcpClient({
    workspaceRoot: root,
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
    await client.newSession();
    await new Promise((r) => setTimeout(r, 80));
    const hit = events.find((e): e is ToolRunEvent => e.type === "tool_run");
    assert.ok(hit);
    assert.match(String(hit.diff), /\+DISK-OK/);
  } finally {
    await client.dispose();
    await rmQuiet(root);
  }
});

test("vendor completed shell with non-zero exit_code is failed, not succeeded", async () => {
  const script = childScript({
    sessionUpdate: "tool_call",
    toolCallId: "sh-fail",
    title: "run terminal command",
    kind: "execute",
    status: "completed",
    command: 'node -e "process.exit(2)"',
    rawOutput: { stdout: "", stderr: "", exit_code: 2 },
  });
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
    await client.newSession();
    await new Promise((r) => setTimeout(r, 80));
    const hit = events.find((e): e is ToolRunEvent => e.type === "tool_run");
    assert.ok(hit);
    assert.equal(hit.status, "failed");
    assert.equal(hit.execution, "executed");
    assert.equal(hit.lifecycle, "terminal");
  } finally {
    await client.dispose();
  }
});

test("vendor completed shell with exit_code 0 stays succeeded", async () => {
  const script = childScript({
    sessionUpdate: "tool_call",
    toolCallId: "sh-ok",
    title: "run terminal command",
    kind: "execute",
    status: "completed",
    command: "echo ok",
    rawOutput: { stdout: "ok\n", stderr: "", exit_code: 0 },
  });
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
    await client.newSession();
    await new Promise((r) => setTimeout(r, 80));
    const hit = events.find((e): e is ToolRunEvent => e.type === "tool_run");
    assert.ok(hit);
    assert.equal(hit.status, "succeeded");
  } finally {
    await client.dispose();
  }
});

test("stale old_string still diffs against the permission-time on-disk body", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "forge-lag-"));
  const rel = "docs/dogfood/NEXT.md";
  const abs = path.join(root, rel);
  await fs.mkdir(path.join(root, "docs/dogfood"), { recursive: true });
  await fs.writeFile(abs, "NEXT-THREE\n", "utf8");
  const script = `
const fs=require('fs');
const r=require('readline').createInterface({input:process.stdin});
const abs=${JSON.stringify(abs)};
r.on('line',l=>{
  let m; try { m=JSON.parse(l); } catch { return; }
  if(m.method==='initialize'){
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{protocolVersion:1}})+'\\n');
    return;
  }
  if(m.method==='session/new'){
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{sessionId:'v1'}})+'\\n');
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'session/update',params:{sessionId:'v1',update:{sessionUpdate:'tool_call',toolCallId:'sr-lag',title:'search replace',kind:'edit',status:'pending',rawInput:{file_path:abs,old_string:'NEXT-OK',new_string:'NEXT-FOUR'}}}})+'\\n');
    setTimeout(()=>{
      fs.writeFileSync(abs, 'NEXT-FOUR\\n');
      process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'session/update',params:{sessionId:'v1',update:{sessionUpdate:'tool_call_update',toolCallId:'sr-lag',status:'completed'}}})+'\\n');
    }, 40);
  }
});
`;
  const client = new StdioAcpClient({
    workspaceRoot: root,
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
    await client.newSession();
    await new Promise((r) => setTimeout(r, 200));
    const hit = events.filter((e): e is ToolRunEvent => e.type === "tool_run").at(-1);
    assert.ok(hit);
    assert.match(String(hit.diff), /-NEXT-THREE/);
    assert.match(String(hit.diff), /\+NEXT-FOUR/);
    assert.equal(String(hit.diff).includes("NEXT-OK"), false);
  } finally {
    await client.dispose();
    await rmQuiet(root);
  }
});

