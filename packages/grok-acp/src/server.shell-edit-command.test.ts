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

test("permission/respond command override is what run_shell executes (YOU 03:00)", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "grok-shell-edit-"));
  const server = new GrokAcpServer();
  (server as any).workspaceRoot = root;
  (server as any).notify = () => {};
  (server as any).respond = () => {};
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
    const running = server.executeTool(
      session,
      call("run_shell", { command: `node -e "console.log('forge-edit-wrong')"` }, "edit-cmd"),
    );
    const started = Date.now();
    while (!(server as any).permissionWaiters.has("edit-cmd")) {
      if (Date.now() - started > 2000) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal((server as any).permissionWaiters.has("edit-cmd"), true);
    await (server as any).onLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 99,
        method: "permission/respond",
        params: {
          id: "edit-cmd",
          decision: "allow_once",
          command: `node -e "console.log('forge-edit-right')"`,
        },
      }),
    );
    const out = await running;
    const parsed = JSON.parse(out) as { exit_code: number; stdout: string; stderr: string };
    assert.equal(parsed.exit_code, 0, `stderr=${parsed.stderr}`);
    assert.match(parsed.stdout, /forge-edit-right/);
    assert.equal(/forge-edit-wrong/.test(parsed.stdout), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
