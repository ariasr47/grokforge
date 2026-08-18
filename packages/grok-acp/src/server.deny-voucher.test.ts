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

function harness(
  root: string,
  decision: "deny" | "allow_once" | "cancelled" | "reject-cancelled" = "deny",
) {
  const server = new GrokAcpServer();
  (server as any).workspaceRoot = root;
  const events: any[] = [];
  let permissions = 0;
  (server as any).notify = (type: string, params: any) => events.push({ type, params });
  (server as any).waitPermission = async () => {
    permissions += 1;
    if (decision === "reject-cancelled") throw new Error("cancelled");
    return decision === "cancelled" ? "cancelled" : decision;
  };
  (server as any).waitEdit = async () => "reject";
  const session: Session = {
    id: "s",
    messages: [],
    pendingEdits: new Map(),
    sessionWrite: false,
    sessionShell: false,
    capability: bindExecutionCapability(profile, root, {
      Path: process.env.Path ?? "",
      PATHEXT: process.env.PATHEXT ?? ".EXE",
    }),
    permissionMode: "review",
  };
  return { server, session, events, get permissions() { return permissions; } };
}

test("Review deny of allowlisted npm test journals not_executed+rejected (GATE Z)", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "grok-deny-"));
  try {
    const h = harness(root, "deny");
    await h.server.executeTool(h.session, call("run_shell", { command: "npm test" }, "npm-test"));
    assert.equal(h.permissions, 1);
    const terminal = h.events.filter((e) => e.type === "tool_run" && e.params.toolCallId === "npm-test").at(-1);
    assert.ok(terminal);
    assert.equal(terminal.params.lifecycle, "terminal");
    assert.equal(terminal.params.execution, "not_executed");
    assert.equal(terminal.params.status, "rejected");
    assert.equal(terminal.params.command, "npm test");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("permission decision cancelled journals not_executed+rejected (GATE Z)", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "grok-cancel-res-"));
  try {
    const h = harness(root, "cancelled");
    await h.server.executeTool(h.session, call("run_shell", { command: "npm test" }, "c1"));
    const terminal = h.events.filter((e) => e.type === "tool_run" && e.params.toolCallId === "c1").at(-1);
    assert.equal(terminal.params.execution, "not_executed");
    assert.equal(terminal.params.status, "rejected");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("waitPermission reject cancelled journals not_executed+rejected (GATE Z)", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "grok-cancel-rej-"));
  try {
    const h = harness(root, "reject-cancelled");
    await h.server.executeTool(h.session, call("run_shell", { command: "npx vitest" }, "c2"));
    const terminal = h.events.filter((e) => e.type === "tool_run" && e.params.toolCallId === "c2").at(-1);
    assert.equal(terminal.params.execution, "not_executed");
    assert.equal(terminal.params.status, "rejected");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("executed non-zero exit remains executed+failed", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "grok-fail-"));
  try {
    const h = harness(root, "allow_once");
    const out = await h.server.executeTool(
      h.session,
      call("run_shell", { command: "exit /b 7" }, "fail"),
    );
    const terminal = h.events.filter((e) => e.type === "tool_run" && e.params.toolCallId === "fail").at(-1);
    assert.equal(terminal.params.execution, "executed");
    assert.equal(terminal.params.status, "failed");
    assert.match(out, /exit_code/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
