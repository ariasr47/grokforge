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

function harness(root: string, phase: "plan" | "execute" = "plan") {
  const server = new GrokAcpServer();
  (server as any).workspaceRoot = root;
  const events: any[] = [];
  let permissions = 0;
  let prepared = 0;
  (server as any).notify = (type: string, params: any) => events.push({ type, params });
  (server as any).waitPermission = async () => {
    permissions += 1;
    return "deny";
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
    executionPhase: phase,
  };
  return { server, session, events, get permissions() { return permissions; }, get prepared() { return prepared; } };
}

test("plan phase refuses write_file before prepareWriteEdit — not_executed+rejected", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "grok-plan-write-"));
  try {
    await fs.writeFile(path.join(root, "keep.txt"), "original");
    const h = harness(root, "plan");
    const out = await h.server.executeTool(h.session, call("write_file", { path: "keep.txt", content: "mutated" }, "w1"));
    const terminal = h.events.filter((e) => e.type === "tool_run" && e.params.toolCallId === "w1").at(-1);
    assert.equal(terminal.params.lifecycle, "terminal");
    assert.equal(terminal.params.execution, "not_executed");
    assert.equal(terminal.params.status, "rejected");
    assert.equal(terminal.params.reasonCode, "plan_phase_refused");
    assert.equal(terminal.params.editId ?? null, null);
    assert.equal(h.permissions, 0);
    assert.match(out, /plan_phase_refused/);
    assert.equal(await fs.readFile(path.join(root, "keep.txt"), "utf8"), "original");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("plan phase refuses generic shell including Trusted list-auto shape", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "grok-plan-npm-"));
  try {
    const h = harness(root, "plan");
    h.session.permissionMode = "trusted_workspace";
    h.session.trustedCommandClasses = ["npm"];
    await h.server.executeTool(h.session, call("run_shell", { command: "npm test" }, "npm-test"));
    const terminal = h.events.filter((e) => e.type === "tool_run" && e.params.toolCallId === "npm-test").at(-1);
    assert.equal(terminal.params.execution, "not_executed");
    assert.equal(terminal.params.status, "rejected");
    assert.equal(terminal.params.reasonCode, "plan_phase_refused");
    assert.equal(terminal.params.command, "npm test");
    assert.equal(h.permissions, 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("plan phase refuses shell under bypass_permissions snapshot", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "grok-plan-bypass-"));
  try {
    const h = harness(root, "plan");
    h.session.permissionMode = "bypass_permissions";
    await h.server.executeTool(h.session, call("run_shell", { command: "echo hi" }, "echo"));
    const terminal = h.events.filter((e) => e.type === "tool_run" && e.params.toolCallId === "echo").at(-1);
    assert.equal(terminal.params.execution, "not_executed");
    assert.equal(terminal.params.status, "rejected");
    assert.equal(terminal.params.reasonCode, "plan_phase_refused");
    assert.equal(h.permissions, 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("plan phase allows compileFixedInspection shell (git status)", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "grok-plan-git-"));
  try {
    const h = harness(root, "plan");
    await h.server.executeTool(h.session, call("run_shell", { command: "git status" }, "git-status"));
    const terminal = h.events.filter((e) => e.type === "tool_run" && e.params.toolCallId === "git-status").at(-1);
    assert.notEqual(terminal.params.reasonCode, "plan_phase_refused");
    assert.notEqual(terminal.params.execution, "not_executed");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("plan phase allows read_file / list_dir / grep", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "grok-plan-read-"));
  try {
    await fs.writeFile(path.join(root, "note.txt"), "needle here");
    const h = harness(root, "plan");
    await h.server.executeTool(h.session, call("read_file", { path: "note.txt" }, "read"));
    await h.server.executeTool(h.session, call("list_dir", { path: "." }, "list"));
    await h.server.executeTool(h.session, call("grep", { pattern: "needle", path: "." }, "grep"));
    for (const id of ["read", "list", "grep"]) {
      const terminal = h.events.filter((e) => e.type === "tool_run" && e.params.toolCallId === id).at(-1);
      assert.equal(terminal.params.execution, "executed");
      assert.equal(terminal.params.status, "succeeded");
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("execute phase still auto-applies Trusted text_edit (unchanged)", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "grok-exec-write-"));
  try {
    const h = harness(root, "execute");
    h.session.permissionMode = "trusted_workspace";
    await h.server.executeTool(h.session, call("write_file", { path: "out.txt", content: "trusted text" }, "tw"));
    const terminal = h.events.filter((e) => e.type === "tool_run" && e.params.toolCallId === "tw").at(-1);
    assert.equal(terminal.params.execution, "executed");
    assert.equal(terminal.params.status, "succeeded");
    assert.ok(terminal.params.editId);
    assert.equal(await fs.readFile(path.join(root, "out.txt"), "utf8"), "trusted text");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
