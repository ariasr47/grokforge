import { createInterface } from "node:readline";
function write(obj) { process.stdout.write(JSON.stringify(obj) + "\n"); }
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === "initialize") { write({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: 1 } }); return; }
  if (msg.method === "session/new") { write({ jsonrpc: "2.0", id: msg.id, result: { sessionId: "live-turn-session" } }); return; }
  if (msg.method !== "session/prompt") return;
  const prompt = String(msg.params?.prompt ?? msg.params?.text ?? "");
  write({ jsonrpc: "2.0", id: msg.id, result: { ok: true, accepted: true } });
  if (prompt.includes("write-permission")) {
    setTimeout(() => {
      write({
        jsonrpc: "2.0", method: "permission_request",
        params: { id: "live-perm-write", kind: "write", detail: "notes.md" },
      });
    }, 20);
    return;
  }
  if (prompt.includes("ask-permission")) {
    setTimeout(() => {
      write({
        jsonrpc: "2.0", method: "permission_request",
        params: {
          id: "live-perm-ask",
          kind: "ask",
          detail: JSON.stringify({
            question: "Which copy?",
            options: ["keep current", "change it"],
          }),
        },
      });
    }, 20);
    return;
  }
  let i = 0;
  const tick = () => {
    i += 1;
    write({
      jsonrpc: "2.0", method: "tool_run",
      params: {
        schemaVersion: 2, type: "tool_run",
        activityId: `burst-${i}`, toolCallId: `burst-${i}`,
        lifecycle: "terminal",
        execution: "executed",
        status: i === 3 ? "failed" : "succeeded",
        name: "read_file", input: { path: `f${i}.txt` },
        summary: null, command: null,
        output: `out-${i}`, error: i === 3 ? "boom" : null,
        reasonCode: null, reason: null, shellDisplayName: null,
        detailAvailable: true, automaticEligibility: "read", autoApplied: false,
        editId: null, diff: null, recovery: null,
      },
    });
    if (i < 16) { setTimeout(tick, 15); return; }
    write({
      jsonrpc: "2.0", method: "permission_request",
      params: { id: "live-perm-1", kind: "shell", detail: "echo live-turn-attention" },
    });
  };
  setTimeout(tick, 20);
});
