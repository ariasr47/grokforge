import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GrokAcpServer, turnBudgetFinalText, type Session } from "./server.js";
import { bindExecutionCapability } from "./executionCapability.js";

test("turnBudgetFinalText uses singular round for 1 (live YOU 02:20)", () => {
  assert.equal(
    turnBudgetFinalText(1),
    "Stopped after 1 tool round without a final answer. Retry to continue.",
  );
  assert.equal(
    turnBudgetFinalText(2),
    "Stopped after 2 tool rounds without a final answer. Retry to continue.",
  );
});

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

function response(chunks: string[]) {
  let index = 0;
  return new Response(
    new ReadableStream({
      pull(controller) {
        if (index >= chunks.length) return controller.close();
        controller.enqueue(new TextEncoder().encode(chunks[index++]));
      },
    }),
    { status: 200 },
  );
}

const frame = (obj: object) => `data: ${JSON.stringify(obj)}\n`;

function toolOnlyListDir(id: string) {
  return response([
    frame({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id,
                type: "function",
                function: { name: "list_dir", arguments: "{\"path\":\".\"}" },
              },
            ],
          },
        },
      ],
    }),
    frame({ choices: [{ finish_reason: "tool_calls" }] }),
    "data: [DONE]\n",
  ]);
}

test("tool-only turns that exhaust the budget vouch a final instead of missing_final_answer", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "grok-budget-"));
  const oldFetch = globalThis.fetch;
  const oldKey = process.env.XAI_API_KEY;
  const oldTurns = process.env.GROKFORGE_MAX_TURNS;
  process.env.XAI_API_KEY = "fixture";
  process.env.GROKFORGE_MAX_TURNS = "2";
  let n = 0;
  globalThis.fetch = (async () => {
    n += 1;
    return toolOnlyListDir(`call-budget-${n}`);
  }) as typeof fetch;
  const server = new GrokAcpServer();
  (server as any).workspaceRoot = root;
  const events: Array<{ type: string; params: Record<string, unknown> }> = [];
  (server as any).notify = (type: string, params: Record<string, unknown>) => events.push({ type, params });
  const session: Session = {
    id: "s",
    messages: [],
    pendingEdits: new Map(),
    sessionWrite: false,
    sessionShell: false,
    capability: bindExecutionCapability(profile, root, {
      Path: process.env.Path ?? process.env.PATH ?? "",
      PATHEXT: process.env.PATHEXT ?? ".EXE",
    }),
  };
  try {
    await (server as any).runPrompt(session, "explore the repo", {
      model: "m",
      owner: { sessionId: "s", runId: "r", connectionGeneration: 1 },
      signal: new AbortController().signal,
    });
    const errors = events.filter((e) => e.type === "error");
    assert.equal(
      errors.some((e) => e.params.code === "missing_final_answer"),
      false,
      `missing_final_answer after tools: ${JSON.stringify(errors)}`,
    );
    const finals = events
      .filter((e) => e.type === "text_delta")
      .map((e) => String(e.params.text ?? ""))
      .join("");
    assert.match(finals, /turn budget|tool rounds/i);
    assert.equal(events.filter((e) => e.type === "done").at(-1)?.params.reason, "stop");
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = oldKey;
    if (oldTurns === undefined) delete process.env.GROKFORGE_MAX_TURNS;
    else process.env.GROKFORGE_MAX_TURNS = oldTurns;
    await fs.rm(root, { recursive: true, force: true });
  }
});

function emptyStop() {
  return response([
    frame({ choices: [{ delta: {}, finish_reason: "stop" }] }),
    "data: [DONE]\n",
  ]);
}

test("tools then empty stop vouches a final instead of missing_final_answer (live shell/inspection 2026-09-10)", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "grok-early-stop-"));
  const oldFetch = globalThis.fetch;
  const oldKey = process.env.XAI_API_KEY;
  const oldTurns = process.env.GROKFORGE_MAX_TURNS;
  process.env.XAI_API_KEY = "fixture";
  delete process.env.GROKFORGE_MAX_TURNS;
  let n = 0;
  globalThis.fetch = (async () => {
    n += 1;
    if (n === 1) return toolOnlyListDir("call-early-1");
    return emptyStop();
  }) as typeof fetch;
  const server = new GrokAcpServer();
  (server as any).workspaceRoot = root;
  const events: Array<{ type: string; params: Record<string, unknown> }> = [];
  (server as any).notify = (type: string, params: Record<string, unknown>) =>
    events.push({ type, params });
  const session: Session = {
    id: "s",
    messages: [],
    pendingEdits: new Map(),
    sessionWrite: false,
    sessionShell: false,
    capability: bindExecutionCapability(profile, root, {
      Path: process.env.Path ?? process.env.PATH ?? "",
      PATHEXT: process.env.PATHEXT ?? ".EXE",
    }),
  };
  try {
    await (server as any).runPrompt(session, "run the test", {
      model: "m",
      owner: { sessionId: "s", runId: "r", connectionGeneration: 1 },
      signal: new AbortController().signal,
    });
    const errors = events.filter((e) => e.type === "error");
    assert.equal(
      errors.some((e) => e.params.code === "missing_final_answer"),
      false,
      `missing_final_answer after tools then empty stop: ${JSON.stringify(errors)}`,
    );
    const finals = events
      .filter((e) => e.type === "text_delta")
      .map((e) => String(e.params.text ?? ""))
      .join("");
    assert.equal(finals, turnBudgetFinalText(1));
    assert.equal(events.filter((e) => e.type === "done").at(-1)?.params.reason, "stop");
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = oldKey;
    if (oldTurns === undefined) delete process.env.GROKFORGE_MAX_TURNS;
    else process.env.GROKFORGE_MAX_TURNS = oldTurns;
    await fs.rm(root, { recursive: true, force: true });
  }
});
