import test from "node:test";
import assert from "node:assert/strict";
import { GrokAcpServer, type Session } from "./server.js";
import { bindExecutionCapability } from "./executionCapability.js";
import { TOOL_DEFINITIONS, toolPermissionKind } from "./tools.js";

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

function harness() {
  const server = new GrokAcpServer();
  const events: any[] = [];
  const waited: Array<{ kind: string; detail: string }> = [];
  (server as any).workspaceRoot = process.cwd();
  (server as any).notify = (type: string, params: any) => events.push({ type, params });
  (server as any).waitPermission = async (_id: string, kind: string, detail: string) => {
    waited.push({ kind, detail });
    return "option:1";
  };
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
  return { server, session, events, waited };
}

test("catalog exposes ask_user as its own permission kind", () => {
  const names = TOOL_DEFINITIONS.map((t) => t.function.name);
  assert.ok(names.includes("ask_user"));
  assert.equal(toolPermissionKind("ask_user"), "ask");
});

test("ask_user waits on kind ask and returns the chosen option label", async () => {
  const h = harness();
  const out = await h.server.executeTool(
    h.session,
    call(
      "ask_user",
      {
        question: "Which copy for GATE_ASK_POLICY?",
        options: ["keep current", "change it"],
      },
      "ask-1",
    ),
  );
  assert.equal(h.waited.length, 1);
  assert.equal(h.waited[0]!.kind, "ask");
  const detail = JSON.parse(h.waited[0]!.detail) as { question: string; options: string[] };
  assert.equal(detail.question, "Which copy for GATE_ASK_POLICY?");
  assert.deepEqual(detail.options, ["keep current", "change it"]);
  const parsed = JSON.parse(out) as { selected: number; label: string };
  assert.equal(parsed.selected, 1);
  assert.equal(parsed.label, "change it");
});
