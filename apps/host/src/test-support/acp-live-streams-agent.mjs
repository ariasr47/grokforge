#!/usr/bin/env node
import { createInterface } from "node:readline";
function write(obj) { process.stdout.write(JSON.stringify(obj) + "\n"); }
function toolRun(overrides) {
  return {
    schemaVersion: 2,
    type: "tool_run",
    activityId: "read-1",
    toolCallId: "read-1",
    lifecycle: "pending",
    execution: null,
    status: "running",
    name: "read_file",
    input: { path: "notes.md" },
    summary: "Read notes.md",
    title: "Reading notes.md",
    command: null,
    output: null,
    error: null,
    reasonCode: null,
    reason: null,
    shellDisplayName: null,
    detailAvailable: true,
    ...overrides,
  };
}
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === "initialize") { write({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: 1 } }); return; }
  if (msg.method === "session/new") { write({ jsonrpc: "2.0", id: msg.id, result: { sessionId: "als-session" } }); return; }
  if (msg.method === "session/cancel") {
    write({ jsonrpc: "2.0", id: msg.id, result: { ok: true } });
    write({ jsonrpc: "2.0", method: "done", params: { reason: "cancelled" } });
    return;
  }
  if (msg.method !== "session/prompt") return;
  const prompt = String(msg.params?.prompt ?? "");
  write({ jsonrpc: "2.0", id: msg.id, result: { ok: true, accepted: true } });
  setTimeout(() => {
    if (prompt.includes("fixture:chat-cas-only")) {
      write({ jsonrpc: "2.0", method: "text_delta", params: { text: "Chat mid-turn answer" } });
      write({ jsonrpc: "2.0", method: "done", params: { reason: "stop" } });
      return;
    }
    if (prompt.includes("fixture:whitespace-only")) {
      write({ jsonrpc: "2.0", method: "text_delta", params: { text: "  \n\t" } });
      write({ jsonrpc: "2.0", method: "done", params: { reason: "stop" } });
      return;
    }
    if (prompt.includes("fixture:post-tool-provider") || prompt.includes("fixture:reachable")) {
      write({ jsonrpc: "2.0", method: "thinking_delta", params: { text: "considering" } });
      write({ jsonrpc: "2.0", method: "text_delta", params: { text: "I will read the file." } });
      write({ jsonrpc: "2.0", method: "tool_run", params: toolRun({ lifecycle: "pending", execution: null, status: "running" }) });
      setTimeout(() => {
        write({
          jsonrpc: "2.0",
          method: "tool_run",
          params: toolRun({
            lifecycle: "terminal",
            execution: "executed",
            status: "succeeded",
            output: "hello",
          }),
        });
        setTimeout(() => {
          write({ jsonrpc: "2.0", method: "text_delta", params: { text: "I will read the file. Done." } });
          write({ jsonrpc: "2.0", method: "done", params: { reason: "stop" } });
        }, 30);
      }, 30);
      return;
    }
    if (prompt.includes("fixture:post-tool-decision")) {
      write({ jsonrpc: "2.0", method: "thinking_delta", params: { text: "need permission" } });
      write({ jsonrpc: "2.0", method: "text_delta", params: { text: "about to run shell" } });
      write({ jsonrpc: "2.0", method: "tool_run", params: toolRun({
        activityId: "shell-1",
        toolCallId: "shell-1",
        name: "run_shell",
        input: { command: "echo hi" },
        summary: "Run echo hi",
        title: "Running echo hi",
        command: "echo hi",
      }) });
      write({ jsonrpc: "2.0", method: "permission_request", params: { id: "perm-1", kind: "shell", detail: "echo hi" } });
      write({
        jsonrpc: "2.0",
        method: "tool_run",
        params: toolRun({
          activityId: "shell-1",
          toolCallId: "shell-1",
          name: "run_shell",
          input: { command: "echo hi" },
          summary: "Run echo hi",
          title: "Running echo hi",
          command: "echo hi",
          lifecycle: "terminal",
          execution: "not_executed",
          status: "rejected",
          reasonCode: "authorization_refused",
          reason: "waiting for permission",
        }),
      });
      return;
    }
    if (prompt.includes("fixture:burst")) {
      let i = 0;
      const next = () => {
        i += 1;
        const id = `burst-${i}`;
        write({ jsonrpc: "2.0", method: "tool_run", params: toolRun({
          activityId: id,
          toolCallId: id,
          name: "read_file",
          input: { path: `${id}.txt` },
          summary: `Read ${id}.txt`,
          title: `Reading ${id}.txt`,
        }) });
        setTimeout(() => {
          write({ jsonrpc: "2.0", method: "tool_run", params: toolRun({
            activityId: id,
            toolCallId: id,
            name: "read_file",
            input: { path: `${id}.txt` },
            summary: `Read ${id}.txt`,
            title: `Reading ${id}.txt`,
            lifecycle: "terminal",
            execution: "executed",
            status: "succeeded",
            output: "ok",
          }) });
          if (i < 3) setTimeout(next, 20);
          else {
            write({ jsonrpc: "2.0", method: "text_delta", params: { text: "burst done" } });
            write({ jsonrpc: "2.0", method: "done", params: { reason: "stop" } });
          }
        }, 20);
      };
      next();
      return;
    }
    if (prompt.includes("fixture:cancel-midturn")) {
      write({ jsonrpc: "2.0", method: "text_delta", params: { text: "partial words" } });
      return;
    }
    write({ jsonrpc: "2.0", method: "text_delta", params: { text: "default" } });
    write({ jsonrpc: "2.0", method: "done", params: { reason: "stop" } });
  }, 20);
});
process.stdin.on("end", () => process.exit(0));
