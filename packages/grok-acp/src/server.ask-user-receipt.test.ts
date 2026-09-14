import test from "node:test";
import assert from "node:assert/strict";
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

test("ask_user pending and terminal tool_run summaries are the question, not JSON", async () => {
  const server = new GrokAcpServer();
  const events: any[] = [];
  (server as any).workspaceRoot = process.cwd();
  (server as any).notify = (type: string, params: any) => events.push({ type, params });
  (server as any).waitPermission = async () => "option:0";
  const session: Session = {
    id: "s",
    messages: [],
    pendingEdits: new Map(),
    sessionWrite: false,
    sessionShell: false,
    capability: bindExecutionCapability(profile, process.cwd(), {
      Path: process.env.Path ?? process.env.PATH ?? "",
      PATHEXT: process.env.PATHEXT ?? ".EXE",
    }),
  };
  await server.executeTool(
    session,
    call(
      "ask_user",
      {
        question: "Which copy for GATE_ASK_POLICY?",
        options: ["keep current", "change it"],
      },
      "ask-1",
    ),
  );
  const runs = events.filter((e) => e.type === "tool_run").map((e) => e.params);
  const pending = runs.find((e) => e.lifecycle === "pending" && e.name === "ask_user");
  const terminal = runs.find((e) => e.lifecycle === "terminal" && e.name === "ask_user");
  assert.ok(pending, "expected pending ask_user tool_run");
  assert.ok(terminal, "expected terminal ask_user tool_run");
  assert.equal(pending.summary, "Which copy for GATE_ASK_POLICY?");
  assert.equal(terminal.summary, "Which copy for GATE_ASK_POLICY?");
});
