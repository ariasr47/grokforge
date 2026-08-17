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

function harness(root: string) {
  const server = new GrokAcpServer();
  (server as any).workspaceRoot = root;
  const events: any[] = [];
  (server as any).notify = (type: string, params: any) => events.push({ type, params });
  (server as any).waitPermission = async () => "allow_once";
  (server as any).waitEdit = async () => "reject";
  const session: Session = {
    id: "s",
    messages: [],
    pendingEdits: new Map(),
    sessionWrite: false,
    sessionShell: false,
    capability: bindExecutionCapability(profile, root, {}),
  };
  return { server, session, events };
}

test("Trusted write terminal tool_run carries path with diff and editId", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "path-emit-"));
  try {
    const h = harness(root);
    h.session.permissionMode = "trusted_workspace";
    await h.server.executeTool(h.session, call("write_file", { path: "p.txt", content: "hi" }));
    const terminal = h.events.find((e) => e.type === "tool_run" && e.params.lifecycle === "terminal");
    assert.ok(terminal);
    assert.equal(terminal.params.path, "p.txt");
    assert.ok(terminal.params.editId);
    assert.ok(typeof terminal.params.diff === "string" && terminal.params.diff.length > 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Review proposed file_edit carries editId, path, diff, and invocation ids", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "path-emit-review-"));
  try {
    const h = harness(root);
    h.session.permissionMode = "review";
    h.session.sessionWrite = true;
    delete (h.server as any).waitEdit;
    const pending = h.server.executeTool(h.session, call("write_file", { path: "r.txt", content: "one" }, "call-r"));
    let proposed: any;
    for (let i = 0; i < 50 && !proposed; i++) {
      proposed = h.events.find((e) => e.type === "file_edit" && e.params.status === "proposed");
      if (!proposed) await new Promise((r) => setTimeout(r, 10));
    }
    assert.ok(proposed, "expected proposed file_edit");
    assert.equal(proposed.params.path, "r.txt");
    assert.equal(proposed.params.editId, proposed.params.id);
    assert.ok(typeof proposed.params.diff === "string" && proposed.params.diff.length > 0);
    assert.equal(proposed.params.toolCallId, "call-r");
    assert.equal(proposed.params.invocationId, "call-r");
    const waiter = (h.server as any).editWaiters.get(proposed.params.id);
    assert.ok(waiter);
    waiter.resolve("reject");
    await pending;
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
