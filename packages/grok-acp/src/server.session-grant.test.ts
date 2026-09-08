import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GrokAcpServer, type Session } from "./server.js";
import { bindExecutionCapability } from "./executionCapability.js";

const profile = {
  status: "available" as const,
  platform: "win32",
  osFamily: "windows" as const,
  executable: process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe",
  argvPrefix: ["/d", "/s", "/c"] as const,
  displayName: "Command Prompt (cmd.exe)",
  dialect: "cmd" as const,
  pathSeparator: "\\" as const,
  syntax: { quoting: "", chaining: "", redirection: "" },
};

function call(name: string, args: Record<string, unknown>, id = name): any {
  return { id, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

test("session/prompt restores Always-this-chat write and shell grants", async () => {
  const server = new GrokAcpServer();
  const replies: any[] = [];
  (server as any).write = (obj: unknown) => replies.push(obj);
  (server as any).runPrompt = async () => {};
  await (server as any).onLine(JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "session/new",
    params: { cwd: os.tmpdir(), executionProfile: profile },
  }));
  const sessionId = replies.find((r) => r?.result?.sessionId)?.result.sessionId as string;
  const created = (server as any).sessions.get(sessionId) as Session;
  assert.equal(created.sessionWrite, false);
  assert.equal(created.sessionShell, false);

  await (server as any).onLine(JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "session/prompt",
    params: {
      sessionId,
      runId: "run-1",
      connectionGeneration: 1,
      prompt: "hi",
      sessionWrite: true,
      sessionShell: true,
    },
  }));
  const session = (server as any).sessions.get(sessionId) as Session;
  assert.equal(session.sessionWrite, true);
  assert.equal(session.sessionShell, true);
});

test("session/prompt never clears an in-process Always-this-chat grant", async () => {
  const server = new GrokAcpServer();
  const replies: any[] = [];
  (server as any).write = (obj: unknown) => replies.push(obj);
  (server as any).runPrompt = async () => {};
  await (server as any).onLine(JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "session/new",
    params: { cwd: os.tmpdir(), executionProfile: profile },
  }));
  const sessionId = replies.find((r) => r?.result?.sessionId)?.result.sessionId as string;
  const session = (server as any).sessions.get(sessionId) as Session;
  session.sessionWrite = true;
  session.sessionShell = true;
  await (server as any).onLine(JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "session/prompt",
    params: {
      sessionId,
      runId: "run-2",
      connectionGeneration: 1,
      prompt: "again",
    },
  }));
  assert.equal(session.sessionWrite, true);
  assert.equal(session.sessionShell, true);
});

test("Always this session skips waitEdit for a later write in Review", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "session-grant-write-"));
  try {
    const server = new GrokAcpServer();
    (server as any).workspaceRoot = root;
    let editPrompts = 0;
    (server as any).waitPermission = async () => {
      throw new Error("waitPermission should not run when sessionWrite is set");
    };
    (server as any).waitEdit = async () => {
      editPrompts += 1;
      return "reject";
    };
    const session: Session = {
      id: "s",
      messages: [],
      pendingEdits: new Map(),
      sessionWrite: true,
      sessionShell: false,
      capability: bindExecutionCapability(profile, root, {}),
      permissionMode: "review",
    };
    const out = await server.executeTool(session, call("write_file", { path: "notes.txt", content: "hello" }));
    assert.match(out, /accepted/);
    assert.equal(editPrompts, 0);
    assert.equal(await fs.readFile(path.join(root, "notes.txt"), "utf8"), "hello");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Always-this-session later Review write stamps autoApplied so Changes can list it", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "session-grant-later-"));
  try {
    const server = new GrokAcpServer();
    (server as any).workspaceRoot = root;
    const events: any[] = [];
    (server as any).notify = (type: string, params: any) => events.push({ type, params });
    (server as any).waitPermission = async () => {
      throw new Error("waitPermission should not run when sessionWrite is set");
    };
    (server as any).waitEdit = async () => {
      throw new Error("waitEdit should not run when sessionWrite is set");
    };
    const session: Session = {
      id: "s",
      messages: [],
      pendingEdits: new Map(),
      sessionWrite: true,
      sessionShell: false,
      capability: bindExecutionCapability(profile, root, {}),
      permissionMode: "review",
    };
    await server.executeTool(session, call("write_file", { path: "a.js", content: "a" }, "call-a"));
    await server.executeTool(session, call("write_file", { path: "b.js", content: "b" }, "call-b"));
    const terminals = events.filter((e) => e.type === "tool_run" && e.params.lifecycle === "terminal");
    assert.equal(terminals.length, 2);
    assert.deepEqual(
      terminals.map((e) => e.params.path),
      ["a.js", "b.js"],
    );
    for (const t of terminals) {
      assert.equal(t.params.autoApplied, true);
      assert.equal(t.params.automaticEligibility, "text_edit");
      assert.equal(t.params.kind, "content");
      assert.ok(t.params.editId);
      assert.ok(typeof t.params.diff === "string" && t.params.diff.length > 0);
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Always-this-session does not auto-apply a write the user already denied", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "session-grant-denied-"));
  try {
    const server = new GrokAcpServer();
    (server as any).workspaceRoot = root;
    let permissions = 0;
    const permissionQueue: string[] = ["deny"];
    (server as any).waitPermission = async () => {
      permissions += 1;
      return permissionQueue.shift() ?? "deny";
    };
    (server as any).waitEdit = async () => {
      throw new Error("waitEdit should not run for a still-denied path");
    };
    const session: Session = {
      id: "s",
      messages: [],
      pendingEdits: new Map(),
      sessionWrite: false,
      sessionShell: false,
      capability: bindExecutionCapability(profile, root, {}),
      permissionMode: "review",
    };
    const denied = await server.executeTool(
      session,
      call("write_file", { path: "fold.js", content: "// G6-DENY\n" }, "deny-1"),
    );
    assert.match(denied, /denied|rejected/);
    assert.equal(permissions, 1);
    assert.equal(await fs.stat(path.join(root, "fold.js")).then(() => true, () => false), false);

    session.sessionWrite = true;
    const later = await server.executeTool(
      session,
      call("write_file", { path: "other.js", content: "ok" }, "other"),
    );
    assert.match(later, /accepted/);
    assert.equal(await fs.readFile(path.join(root, "other.js"), "utf8"), "ok");
    assert.equal(permissions, 1);

    const retry = await server.executeTool(
      session,
      call("write_file", { path: "fold.js", content: "// G6-DENY\n" }, "deny-2"),
    );
    assert.match(retry, /denied|rejected/);
    assert.equal(permissions, 2, "Retry of a denied write must Review even after sessionWrite");
    assert.equal(await fs.stat(path.join(root, "fold.js")).then(() => true, () => false), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("session/prompt restores denied write paths so sessionWrite cannot cover them", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "session-grant-denied-restore-"));
  try {
    const server = new GrokAcpServer();
    (server as any).workspaceRoot = root;
    const replies: any[] = [];
    (server as any).write = (obj: unknown) => replies.push(obj);
    (server as any).runPrompt = async () => {};
    let permissions = 0;
    (server as any).waitPermission = async () => {
      permissions += 1;
      return "deny";
    };
    (server as any).waitEdit = async () => {
      throw new Error("waitEdit should not run for a restored denied path");
    };
    await (server as any).onLine(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "session/new",
      params: { cwd: root, executionProfile: profile },
    }));
    const sessionId = replies.find((r) => r?.result?.sessionId)?.result.sessionId as string;
    await (server as any).onLine(JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "session/prompt",
      params: {
        sessionId,
        runId: "run-1",
        connectionGeneration: 1,
        prompt: "retry denied write",
        sessionWrite: true,
        deniedWritePaths: ["docs\\dogfood\\fold.js"],
      },
    }));
    const session = (server as any).sessions.get(sessionId) as Session;
    assert.equal(session.sessionWrite, true);
    const retry = await server.executeTool(
      session,
      call("write_file", { path: "docs/dogfood/fold.js", content: "// G6-DENY\n" }, "restore-deny"),
    );
    assert.match(retry, /denied|rejected/);
    assert.equal(permissions, 1);
    assert.equal(await fs.stat(path.join(root, "docs", "dogfood", "fold.js")).then(() => true, () => false), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
