// Deterministic ACP child used only by the shell's real-host integration lane.
// It emits every run-owned class before a terminal error so replay can prove
// that the projection keeps the complete pre-terminal history together.
import { createInterface } from "node:readline";
function write(obj) { process.stdout.write(JSON.stringify(obj) + "\n"); }
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === "initialize") { write({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: 1 } }); return; }
  if (msg.method === "session/new") { write({ jsonrpc: "2.0", id: msg.id, result: { sessionId: "all-events-session" } }); return; }
  if (msg.method !== "session/prompt") return;
  write({ jsonrpc: "2.0", id: msg.id, result: { ok: true, accepted: true } });
  setTimeout(() => {
    write({ jsonrpc: "2.0", method: "thinking_delta", params: { text: "pre-terminal reasoning" } });
    write({ jsonrpc: "2.0", method: "tool_run", params: { schemaVersion: 2, type: "tool_run", activityId: "all-tool", toolCallId: "all-tool", lifecycle: "terminal", execution: "executed", status: "succeeded", name: "read_file", input: { path: "README.md" }, summary: null, command: null, output: "tool output", error: null, reasonCode: null, reason: null, shellDisplayName: null, detailAvailable: true, automaticEligibility: "read", autoApplied: false, editId: null, diff: null, recovery: null } });
    write({ jsonrpc: "2.0", method: "permission_request", params: { id: "all-permission", kind: "shell", detail: "Allow the inspected command?" } });
    write({ jsonrpc: "2.0", method: "file_edit", params: { id: "all-edit", invocationId: "all-edit-invocation", status: "proposed", path: "README.md" } });
    write({ jsonrpc: "2.0", method: "text_delta", params: { text: "answer received before failure" } });
    setTimeout(() => write({ jsonrpc: "2.0", method: "error", params: { code: "provider_unavailable", message: "provider stopped after owned events" } }), 500);
  }, 30);
});
