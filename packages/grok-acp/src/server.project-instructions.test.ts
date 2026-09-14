import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
// Project-instruction tests cover host-read AGENTS.md, not a Forge skills catalog.
import { GrokAcpServer } from "./server.js";
import { PROJECT_INSTRUCTIONS_MAX_BYTES } from "./project-instructions.js";

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

async function withRoot(fn: (root: string) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-acp-"));
  try { await fn(root); }
  finally { await fs.rm(root, { recursive: true, force: true }); }
}

function promptHarness() {
  const server = new GrokAcpServer();
  const replies: any[] = [];
  const events: any[] = [];
  (server as any).write = (obj: unknown) => replies.push(obj);
  (server as any).notify = (type: string, params: unknown, owner?: unknown) => {
    events.push({ type, params, owner });
  };
  (server as any).runPrompt = async () => {};
  return { server, replies, events };
}

async function newSession(h: ReturnType<typeof promptHarness>, root: string) {
  await (h.server as any).onLine(JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "session/new",
    params: { cwd: root, executionProfile: profile },
  }));
  const sessionId = h.replies.find((r) => r?.result?.sessionId)?.result.sessionId as string;
  assert.ok(sessionId);
  return sessionId;
}

async function prompt(h: ReturnType<typeof promptHarness>, sessionId: string, text: string, id = 2) {
  await (h.server as any).onLine(JSON.stringify({
    jsonrpc: "2.0",
    id,
    method: "session/prompt",
    params: {
      sessionId,
      runId: `run-${id}`,
      connectionGeneration: 1,
      prompt: text,
    },
  }));
}

function inclusionEvents(events: any[]) {
  return events.filter((e) => e.type === "project_instructions");
}

describe("project-instructions session/prompt", { concurrency: false }, () => {
  const prevMode = process.env.GROKFORGE_MODE;

  test("Code prompt with AGENTS.md recomposes messages[0] with delimited section", async () => {
    process.env.GROKFORGE_MODE = "code";
    await withRoot(async (root) => {
      await fs.writeFile(path.join(root, "AGENTS.md"), "Rule A\n", "utf8");
      const h = promptHarness();
      const sessionId = await newSession(h, root);
      await prompt(h, sessionId, "hello");
      const session = (h.server as any).sessions.get(sessionId);
      assert.match(session.messages[0].content, /## Project instructions \(`AGENTS.md`\)/);
      assert.match(session.messages[0].content, /Rule A/);
      const notes = inclusionEvents(h.events);
      assert.equal(notes.length, 1);
      assert.equal(notes[0].params.inclusion, "included");
      assert.equal(notes[0].params.path, "AGENTS.md");
      assert.equal(notes[0].params.status, "present");
      assert.equal(h.events.some((e) => e.type === "tool_run"), false);
    });
  });

  test("missing recipe → base only + inclusion not_included", async () => {
    process.env.GROKFORGE_MODE = "code";
    await withRoot(async (root) => {
      const h = promptHarness();
      const sessionId = await newSession(h, root);
      await prompt(h, sessionId, "hello");
      const session = (h.server as any).sessions.get(sessionId);
      assert.equal(session.messages[0].content.includes("## Project instructions"), false);
      const notes = inclusionEvents(h.events);
      assert.equal(notes.length, 1);
      assert.equal(notes[0].params.inclusion, "not_included");
      assert.equal(notes[0].params.path, null);
      assert.equal(notes[0].params.bodyByteLength, null);
    });
  });

  test("failed oversize → base only + inclusion failed; no CLAUDE fallthrough in notify path", async () => {
    process.env.GROKFORGE_MODE = "code";
    await withRoot(async (root) => {
      await fs.writeFile(path.join(root, "AGENTS.md"), " ".repeat(PROJECT_INSTRUCTIONS_MAX_BYTES), "utf8");
      await fs.writeFile(path.join(root, "CLAUDE.md"), "should-not-win", "utf8");
      const h = promptHarness();
      const sessionId = await newSession(h, root);
      await prompt(h, sessionId, "hello");
      const session = (h.server as any).sessions.get(sessionId);
      assert.equal(session.messages[0].content.includes("should-not-win"), false);
      assert.equal(session.messages[0].content.includes("## Project instructions"), false);
      const notes = inclusionEvents(h.events);
      assert.equal(notes.length, 1);
      assert.equal(notes[0].params.inclusion, "failed");
      assert.equal(notes[0].params.path, "AGENTS.md");
      assert.equal(notes[0].params.status, "failed");
    });
  });

  test("second prompt after edit uses new body (freshness)", async () => {
    process.env.GROKFORGE_MODE = "code";
    await withRoot(async (root) => {
      await fs.writeFile(path.join(root, "AGENTS.md"), "text-A", "utf8");
      const h = promptHarness();
      const sessionId = await newSession(h, root);
      await prompt(h, sessionId, "first", 2);
      let session = (h.server as any).sessions.get(sessionId);
      assert.match(session.messages[0].content, /text-A/);
      await fs.writeFile(path.join(root, "AGENTS.md"), "text-B", "utf8");
      await prompt(h, sessionId, "second", 3);
      session = (h.server as any).sessions.get(sessionId);
      assert.match(session.messages[0].content, /text-B/);
      assert.equal(session.messages[0].content.includes("text-A"), false);
    });
  });

  test("Chat mode skips discovery and emits no project_instructions notification", async () => {
    process.env.GROKFORGE_MODE = "chat";
    await withRoot(async (root) => {
      await fs.writeFile(path.join(root, "AGENTS.md"), "Chat must not load this\n", "utf8");
      const h = promptHarness();
      const sessionId = await newSession(h, root);
      await prompt(h, sessionId, "hello");
      const session = (h.server as any).sessions.get(sessionId);
      assert.equal(session.messages[0].content.includes("## Project instructions"), false);
      assert.equal(session.messages[0].content.includes("Chat must not load this"), false);
      assert.equal(inclusionEvents(h.events).length, 0);
    });
  });

  test("recipe load does not emit read_file tool_run", async () => {
    process.env.GROKFORGE_MODE = "code";
    await withRoot(async (root) => {
      await fs.writeFile(path.join(root, "AGENTS.md"), "Rule A\n", "utf8");
      const h = promptHarness();
      const sessionId = await newSession(h, root);
      await prompt(h, sessionId, "hello");
      const toolRuns = h.events.filter((e) => e.type === "tool_run");
      assert.equal(toolRuns.length, 0);
      assert.equal(toolRuns.some((e) => e.params?.name === "read_file"), false);
    });
  });

  test.after(() => {
    if (prevMode === undefined) delete process.env.GROKFORGE_MODE;
    else process.env.GROKFORGE_MODE = prevMode;
  });
});
