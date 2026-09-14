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
    sessionShell: true,
    capability: bindExecutionCapability(profile, root, {
      Path: process.env.Path ?? process.env.PATH ?? "",
      PATHEXT: process.env.PATHEXT ?? ".EXE",
    }),
  };
  return { server, session };
}

test("node -e console.log stdout is captured through cmd /d /s /c", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "grok-shell-stdout-"));
  try {
    const h = harness(root);
    const command = `node -e "console.log('forge-gate-enter')"`;
    const out = await h.server.executeTool(h.session, call("run_shell", { command }, "ne"));
    const parsed = JSON.parse(out) as { exit_code: number; stdout: string; stderr: string };
    assert.equal(parsed.exit_code, 0, `stderr=${parsed.stderr}`);
    assert.match(parsed.stdout, /forge-gate-enter/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
