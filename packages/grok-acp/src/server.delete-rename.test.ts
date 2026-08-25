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

function harness(root: string, phase: "plan" | "execute" = "execute") {
  const server = new GrokAcpServer();
  (server as any).workspaceRoot = root;
  const events: any[] = [];
  let permissions = 0;
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
  return { server, session, events, get permissions() { return permissions; } };
}

function terminalOf(h: { events: any[] }, id?: string) {
  const events = h.events.filter((e) => e.type === "tool_run" && e.params.lifecycle === "terminal");
  if (!id) return events.at(-1);
  return events.find((e) => e.params.toolCallId === id) ?? events.at(-1);
}

test("Trusted delete_file auto-applies with no permission wait", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tdr-del-"));
  try {
    await fs.writeFile(path.join(root, "x.txt"), "x", "utf8");
    const h = harness(root);
    h.session.permissionMode = "trusted_workspace";
    const out = await h.server.executeTool(h.session, call("delete_file", { path: "x.txt" }));
    assert.match(out, /accepted|ok/);
    assert.equal(h.permissions, 0);
    assert.equal(await fs.stat(path.join(root, "x.txt")).then(() => true, () => false), false);
    const terminal = h.events.find((e) => e.type === "tool_run" && e.params.lifecycle === "terminal");
    assert.equal(terminal.params.kind, "delete");
    assert.equal(terminal.params.path, "x.txt");
    assert.equal(terminal.params.autoApplied, true);
    assert.equal(terminal.params.automaticEligibility, "text_edit");
    assert.ok(terminal.params.editId);
    assert.equal(terminal.params.diff ?? null, null);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Trusted rename_file auto-applies; terminal carries fromPath+toPath", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tdr-ren-"));
  try {
    await fs.writeFile(path.join(root, "a.txt"), "body", "utf8");
    const h = harness(root);
    h.session.permissionMode = "trusted_workspace";
    const out = await h.server.executeTool(
      h.session,
      call("rename_file", { fromPath: "a.txt", toPath: "b.txt" }),
    );
    assert.match(out, /accepted|ok/);
    assert.equal(h.permissions, 0);
    assert.equal(await fs.readFile(path.join(root, "b.txt"), "utf8"), "body");
    assert.equal(await fs.stat(path.join(root, "a.txt")).then(() => true, () => false), false);
    const terminal = h.events.find((e) => e.type === "tool_run" && e.params.lifecycle === "terminal");
    assert.equal(terminal.params.kind, "rename");
    assert.equal(terminal.params.fromPath, "a.txt");
    assert.equal(terminal.params.toPath, "b.txt");
    assert.equal(terminal.params.path, "b.txt");
    assert.equal(terminal.params.autoApplied, true);
    assert.equal(terminal.params.automaticEligibility, "text_edit");
    assert.ok(terminal.params.editId);
    assert.equal(terminal.params.diff ?? null, null);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("directory delete_file → not_executed non_regular_file; no editId", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tdr-dir-"));
  try {
    await fs.mkdir(path.join(root, "d"));
    const h = harness(root);
    h.session.permissionMode = "trusted_workspace";
    await h.server.executeTool(h.session, call("delete_file", { path: "d" }, "del-dir"));
    const terminal = terminalOf(h, "del-dir");
    assert.equal(terminal.params.execution, "not_executed");
    assert.equal(terminal.params.status, "rejected");
    assert.equal(terminal.params.reasonCode, "non_regular_file");
    assert.equal(terminal.params.editId ?? null, null);
    assert.equal(terminal.params.kind ?? null, null);
    assert.equal(h.permissions, 0);
    assert.equal(await fs.stat(path.join(root, "d")).then((s) => s.isDirectory(), () => false), true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("missing delete_file → not_executed missing_target; no editId", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tdr-miss-"));
  try {
    const h = harness(root);
    h.session.permissionMode = "trusted_workspace";
    await h.server.executeTool(h.session, call("delete_file", { path: "gone.txt" }, "del-miss"));
    const terminal = terminalOf(h, "del-miss");
    assert.equal(terminal.params.execution, "not_executed");
    assert.equal(terminal.params.status, "rejected");
    assert.equal(terminal.params.reasonCode, "missing_target");
    assert.equal(terminal.params.editId ?? null, null);
    assert.equal(terminal.params.kind ?? null, null);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Plan phase delete_file/rename_file → plan_phase_refused before prepare", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tdr-plan-"));
  try {
    await fs.writeFile(path.join(root, "keep.txt"), "original", "utf8");
    const h = harness(root, "plan");
    h.session.permissionMode = "trusted_workspace";
    const delOut = await h.server.executeTool(
      h.session,
      call("delete_file", { path: "keep.txt" }, "plan-del"),
    );
    const delTerm = terminalOf(h, "plan-del");
    assert.equal(delTerm.params.lifecycle, "terminal");
    assert.equal(delTerm.params.execution, "not_executed");
    assert.equal(delTerm.params.status, "rejected");
    assert.equal(delTerm.params.reasonCode, "plan_phase_refused");
    assert.equal(delTerm.params.editId ?? null, null);
    assert.equal(h.permissions, 0);
    assert.match(delOut, /plan_phase_refused/);
    assert.equal(await fs.readFile(path.join(root, "keep.txt"), "utf8"), "original");

    const renOut = await h.server.executeTool(
      h.session,
      call("rename_file", { fromPath: "keep.txt", toPath: "moved.txt" }, "plan-ren"),
    );
    const renTerm = terminalOf(h, "plan-ren");
    assert.equal(renTerm.params.reasonCode, "plan_phase_refused");
    assert.equal(renTerm.params.execution, "not_executed");
    assert.match(renOut, /plan_phase_refused/);
    assert.equal(await fs.stat(path.join(root, "moved.txt")).then(() => true, () => false), false);
    assert.equal(await fs.readFile(path.join(root, "keep.txt"), "utf8"), "original");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Review delete_file emits proposed file_edit with kind delete and null diff", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tdr-rev-del-"));
  try {
    await fs.writeFile(path.join(root, "r.txt"), "stay", "utf8");
    const h = harness(root);
    h.session.permissionMode = "review";
    (h.server as any).waitPermission = async () => "allow_once";
    delete (h.server as any).waitEdit;
    const pending = h.server.executeTool(h.session, call("delete_file", { path: "r.txt" }, "call-del"));
    let proposed: any;
    for (let i = 0; i < 50 && !proposed; i++) {
      proposed = h.events.find((e) => e.type === "file_edit" && e.params.status === "proposed");
      if (!proposed) await new Promise((r) => setTimeout(r, 10));
    }
    assert.ok(proposed, "expected proposed file_edit");
    assert.equal(proposed.params.kind, "delete");
    assert.equal(proposed.params.path, "r.txt");
    assert.equal(proposed.params.diff ?? null, null);
    assert.equal(proposed.params.editId, proposed.params.id);
    assert.equal(proposed.params.toolCallId, "call-del");
    assert.equal(await fs.readFile(path.join(root, "r.txt"), "utf8"), "stay");
    const waiter = (h.server as any).editWaiters.get(proposed.params.id);
    assert.ok(waiter);
    waiter.resolve("reject");
    await pending;
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Review rename_file proposed binds path to fromPath", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tdr-rev-ren-"));
  try {
    await fs.writeFile(path.join(root, "from.txt"), "stay", "utf8");
    const h = harness(root);
    h.session.permissionMode = "review";
    (h.server as any).waitPermission = async () => "allow_once";
    delete (h.server as any).waitEdit;
    const pending = h.server.executeTool(
      h.session,
      call("rename_file", { fromPath: "from.txt", toPath: "to.txt" }, "call-ren"),
    );
    let proposed: any;
    for (let i = 0; i < 50 && !proposed; i++) {
      proposed = h.events.find((e) => e.type === "file_edit" && e.params.status === "proposed");
      if (!proposed) await new Promise((r) => setTimeout(r, 10));
    }
    assert.ok(proposed, "expected proposed file_edit");
    assert.equal(proposed.params.kind, "rename");
    assert.equal(proposed.params.path, "from.txt");
    assert.equal(proposed.params.fromPath, "from.txt");
    assert.equal(proposed.params.toPath, "to.txt");
    assert.equal(proposed.params.diff ?? null, null);
    assert.equal(await fs.stat(path.join(root, "from.txt")).then(() => true, () => false), true);
    assert.equal(await fs.stat(path.join(root, "to.txt")).then(() => true, () => false), false);
    const waiter = (h.server as any).editWaiters.get(proposed.params.id);
    assert.ok(waiter);
    waiter.resolve("reject");
    await pending;
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Bypass delete_file auto-applies with automaticEligibility bypass", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tdr-bypass-"));
  try {
    await fs.writeFile(path.join(root, "x.txt"), "x", "utf8");
    const h = harness(root);
    h.session.permissionMode = "bypass_permissions";
    const out = await h.server.executeTool(h.session, call("delete_file", { path: "x.txt" }));
    assert.match(out, /accepted|ok/);
    assert.equal(h.permissions, 0);
    assert.equal(await fs.stat(path.join(root, "x.txt")).then(() => true, () => false), false);
    const terminal = h.events.find((e) => e.type === "tool_run" && e.params.lifecycle === "terminal");
    assert.equal(terminal.params.kind, "delete");
    assert.equal(terminal.params.autoApplied, true);
    assert.equal(terminal.params.automaticEligibility, "bypass");
    assert.ok(terminal.params.editId);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("rename dest_exists refuses not_executed with no editId", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tdr-dest-"));
  try {
    await fs.writeFile(path.join(root, "a.txt"), "a", "utf8");
    await fs.writeFile(path.join(root, "b.txt"), "b", "utf8");
    const h = harness(root);
    h.session.permissionMode = "trusted_workspace";
    await h.server.executeTool(
      h.session,
      call("rename_file", { fromPath: "a.txt", toPath: "b.txt" }, "ren-dest"),
    );
    const terminal = terminalOf(h, "ren-dest");
    assert.equal(terminal.params.execution, "not_executed");
    assert.equal(terminal.params.reasonCode, "dest_exists");
    assert.equal(terminal.params.editId ?? null, null);
    assert.equal(await fs.readFile(path.join(root, "a.txt"), "utf8"), "a");
    assert.equal(await fs.readFile(path.join(root, "b.txt"), "utf8"), "b");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
