import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import { GrokAcpServer } from "./server.js";

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
