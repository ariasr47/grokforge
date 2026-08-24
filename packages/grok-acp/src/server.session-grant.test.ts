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
