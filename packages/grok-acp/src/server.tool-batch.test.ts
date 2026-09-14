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

function call(name: string, args: Record<string, unknown>, id: string): any {
  return { id, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

test("two shell calls in one batch both request permission before either is answered", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "grok-batch-"));
  const server = new GrokAcpServer();
  const events: any[] = [];
  (server as any).workspaceRoot = root;
  (server as any).notify = (type: string, params: any) => events.push({ type, params });
  const session: Session = {
    id: "s",
    messages: [],
    pendingEdits: new Map(),
    sessionWrite: false,
    sessionShell: false,
    permissionMode: "review",
    capability: bindExecutionCapability(profile, root, {
      Path: process.env.Path ?? process.env.PATH ?? "",
      PATHEXT: process.env.PATHEXT ?? ".EXE",
    }),
  };
  try {
    const running = (server as any).executeTools(session, [
      call("run_shell", { command: "echo q1" }, "t1"),
      call("run_shell", { command: "echo q2" }, "t2"),
    ]);
    const started = Date.now();
    while (events.filter((e) => e.type === "permission_request").length < 2) {
      if (Date.now() - started > 2000) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    const perms = events.filter((e) => e.type === "permission_request");
    assert.equal(perms.length, 2, `expected two live permission_request, got ${perms.length}`);
    for (const waiter of (server as any).permissionWaiters.values()) {
      waiter.resolve("allow_once");
    }
    await running;
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
