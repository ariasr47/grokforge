import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
// Trusted command tests cover grok-acp host policy, not a Forge auto-mode.
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

test("session/prompt freezes trustedCommandClasses for the next tool call", async () => {
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
  assert.ok(sessionId);
  const created = (server as any).sessions.get(sessionId);
  assert.deepEqual(created.trustedCommandClasses, []);

  await (server as any).onLine(JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "session/prompt",
    params: {
      sessionId,
      runId: "run-1",
      connectionGeneration: 1,
      prompt: "hi",
      policy: { effectiveMode: "trusted_workspace" },
      trustedCommandClasses: ["npm", "git:show"],
    },
  }));
  const session = (server as any).sessions.get(sessionId);
  assert.equal(session.permissionMode, "trusted_workspace");
  assert.deepEqual(session.trustedCommandClasses, ["npm", "git:show"]);
});

function call(name: string, args: Record<string, unknown>, id = name): any {
  return { id, type: "function", function: { name, arguments: JSON.stringify(args) } };
}
function harness(root: string, env: Record<string, string> = {}, decision: "deny" | "allow_once" = "deny") {
  const server = new GrokAcpServer();
  (server as any).workspaceRoot = root;
  const events: any[] = [];
  let permissions = 0;
  (server as any).notify = (type: string, params: any) => events.push({ type, params });
  (server as any).waitPermission = async () => {
    permissions += 1;
    return decision;
  };
  (server as any).waitEdit = async () => "reject";
  const session: Session = {
    id: "s",
    messages: [],
    pendingEdits: new Map(),
    sessionWrite: false,
    sessionShell: false,
    capability: bindExecutionCapability(profile, root, env),
    permissionMode: "trusted_workspace",
    trustedCommandClasses: [],
  };
  return { server, session, events, get permissions() { return permissions; } };
}
function terminalOf(h: { events: any[] }, id?: string) {
  const rows = h.events.filter((e) => e.type === "tool_run" && e.params.lifecycle === "terminal");
  return id ? rows.filter((e) => e.params.toolCallId === id).at(-1) : rows.at(-1);
}
async function plantNpm(root: string) {
  await fs.writeFile(path.join(root, "npm.cmd"), "@echo off\r\necho fake-npm\r\n");
  return { Path: root, PATHEXT: ".CMD;.EXE" };
}

test("Trusted list-auto residual git skips the card and carries list provenance when executed", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tcc-git-"));
  try {
    const h = harness(root, { Path: process.env.Path ?? "", PATHEXT: process.env.PATHEXT ?? ".EXE" });
    h.session.trustedCommandClasses = ["git:status", "git:show"];
    await h.server.executeTool(h.session, call("run_shell", { command: "git status -sb" }, "git-sb"));
    assert.equal(h.permissions, 0);
    const terminal = terminalOf(h, "git-sb");
    assert.equal(terminal.params.command, "git status -sb");
    if (terminal.params.execution === "executed") {
      assert.equal(terminal.params.automaticEligibility, "trusted_command_class");
      assert.equal(terminal.params.autoApplied, true);
    } else {
      assert.notEqual(terminal.params.automaticEligibility, "trusted_command_class");
      assert.equal(Boolean(terminal.params.autoApplied), false);
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Trusted planted npm.cmd list-auto skips the card and carries list provenance", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tcc-npm-"));
  try {
    const h = harness(root, await plantNpm(root));
    h.session.trustedCommandClasses = ["npm"];
    await h.server.executeTool(h.session, call("run_shell", { command: "npm.cmd test" }, "npm-auto"));
    assert.equal(h.permissions, 0);
    const terminal = terminalOf(h, "npm-auto");
    assert.equal(terminal.params.command, "npm.cmd test");
    assert.equal(terminal.params.execution, "executed");
    assert.equal(terminal.params.automaticEligibility, "trusted_command_class");
    assert.equal(terminal.params.autoApplied, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Review with a saved list still asks for generic shell", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tcc-review-"));
  try {
    const h = harness(root, await plantNpm(root));
    h.session.permissionMode = "review";
    h.session.trustedCommandClasses = ["npm"];
    await h.server.executeTool(h.session, call("run_shell", { command: "npm test" }, "npm-review"));
    assert.equal(h.permissions, 1);
    const terminal = terminalOf(h, "npm-review");
    assert.notEqual(terminal.params.automaticEligibility, "trusted_command_class");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Trusted multi-statement matching prefix still asks", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tcc-chain-"));
  try {
    const h = harness(root, await plantNpm(root));
    h.session.trustedCommandClasses = ["npm"];
    await h.server.executeTool(h.session, call("run_shell", { command: "npm test && del x" }, "chain"));
    assert.equal(h.permissions, 1);
    const terminal = terminalOf(h, "chain");
    assert.notEqual(terminal.params.automaticEligibility, "trusted_command_class");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Trusted non-catalog git still asks", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tcc-push-"));
  try {
    const h = harness(root, { Path: process.env.Path ?? "", PATHEXT: process.env.PATHEXT ?? ".EXE" });
    h.session.trustedCommandClasses = ["git:status", "git:diff", "git:log", "git:show"];
    await h.server.executeTool(h.session, call("run_shell", { command: "git push --force" }, "push"));
    assert.equal(h.permissions, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("W1 git global options are non-matching and still ask", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tcc-pager-"));
  try {
    const h = harness(root, { Path: process.env.Path ?? "", PATHEXT: process.env.PATHEXT ?? ".EXE" });
    h.session.trustedCommandClasses = ["git:status"];
    await h.server.executeTool(h.session, call("run_shell", { command: "git --no-pager status" }, "pager"));
    assert.equal(h.permissions, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Trusted empty list still asks for residual git", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tcc-empty-"));
  try {
    const h = harness(root, { Path: process.env.Path ?? "", PATHEXT: process.env.PATHEXT ?? ".EXE" });
    h.session.trustedCommandClasses = [];
    await h.server.executeTool(h.session, call("run_shell", { command: "git show HEAD" }, "empty-git"));
    assert.equal(h.permissions, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Windows ls hard-negative never carries list provenance", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tcc-ls-"));
  try {
    const h = harness(root, { Path: "", PATHEXT: ".EXE" });
    h.session.trustedCommandClasses = ["npm"];
    await h.server.executeTool(h.session, call("run_shell", { command: "ls" }, "ls"));
    const terminal = terminalOf(h, "ls");
    assert.equal(h.permissions, 0);
    assert.equal(terminal.params.execution, "not_executed");
    assert.notEqual(terminal.params.automaticEligibility, "trusted_command_class");
    assert.equal(Boolean(terminal.params.autoApplied), false);
    assert.equal(terminal.params.command, "ls");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("protected recursive delete never carries list provenance", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tcc-del-"));
  try {
    const h = harness(root);
    h.session.trustedCommandClasses = ["npm"];
    await h.server.executeTool(h.session, call("run_shell", { command: `rd /s /q ${root}` }, "del"));
    const terminal = terminalOf(h, "del");
    assert.equal(h.permissions, 0);
    assert.equal(terminal.params.execution, "not_executed");
    assert.equal(terminal.params.reasonCode, "protected_recursive_delete");
    assert.notEqual(terminal.params.automaticEligibility, "trusted_command_class");
    assert.equal(Boolean(terminal.params.autoApplied), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("fixed inspection stays fixed_inspection even with an empty class list", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tcc-fix-"));
  try {
    const h = harness(root, { Path: process.env.Path ?? "", PATHEXT: process.env.PATHEXT ?? ".EXE" });
    h.session.trustedCommandClasses = [];
    await h.server.executeTool(h.session, call("run_shell", { command: "git status --short" }, "fix"));
    assert.equal(h.permissions, 0);
    const terminal = terminalOf(h, "fix");
    assert.equal(terminal.params.automaticEligibility, "fixed_inspection");
    assert.notEqual(terminal.params.automaticEligibility, "trusted_command_class");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
