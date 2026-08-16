#!/usr/bin/env node
// Deterministic ACP fixture for the frontend/browser and desktop visual path.
// It deliberately emits no secrets and is only used when GROKFORGE_AGENT_ENTRY
// points at this file.
import readline from "node:readline";

const out = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let request;
  try { request = JSON.parse(line); } catch { return; }
  const id = request.id;
  if (request.method === "initialize") out({ jsonrpc: "2.0", id, result: {} });
  else if (request.method === "session/new") out({ jsonrpc: "2.0", id, result: { sessionId: "fixture" } });
  else if (request.method === "permission/respond" || request.method === "edit/respond") {
    out({ jsonrpc: "2.0", id, result: { ok: true } });
  }
  else if (request.method === "session/prompt") {
    out({ jsonrpc: "2.0", id, result: { ok: true } });
    for (let i = 0; i < 45; i += 1) {
      if (i === 10) out({ jsonrpc: "2.0", method: "permission_request", params: { type: "permission_request", id: "perm-10", kind: "shell", detail: "fixture" } });
      if (i === 20) out({ jsonrpc: "2.0", method: "file_edit", params: { type: "file_edit", id: "diff-20", path: "fixture.md", diff: "@@", status: "proposed" } });
      const activityId = `fixture-${i}`;
      out({ jsonrpc: "2.0", method: "tool_run", params: {
        schemaVersion: 2, type: "tool_run", activityId, toolCallId: activityId,
        lifecycle: "terminal", execution: i === 43 ? "not_executed" : "executed",
        status: i === 43 ? "rejected" : i === 41 ? "failed" : "succeeded",
        name: "run_shell", input: { command: `echo fixture-${i}` }, summary: `fixture-${i}`,
        command: `echo fixture-${i}`, output: i === 41 ? null : `fixture output ${i}`,
        error: i === 41 ? "fixture failure" : null,
        reasonCode: i === 43 ? "leading_command_unresolved" : null,
        reason: i === 43 ? "fixture command unresolved" : null,
        shellDisplayName: "Command Prompt (cmd.exe)", detailAvailable: i !== 44,
      }});
    }
    out({ jsonrpc: "2.0", method: "done", params: { reason: "stop" } });
  }
});
