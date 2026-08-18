#!/usr/bin/env node
/**
 * Fake ACP agent for the AC8 retry-interception test (effort-fallback-retry.test.ts).
 *
 * Implements just enough of the stdio JSON-RPC wire protocol (mirrors
 * packages/grok-acp/src/server.ts's shape) to drive session.ts's `onEvent` fallback path without
 * a live xAI call: `initialize` / `session/new` ack immediately; `session/prompt` acks immediately
 * (matching real grok-acp, which responds before running the turn) then, async, emits either a
 * fake `api_error` 400 + `done reason:"error"` pair (when the requested model equals
 * FAKE_AGENT_FAIL_MODEL) or a `text_delta` + `done reason:"stop"` pair otherwise.
 */
import { createInterface } from "node:readline";
import fs from "node:fs";

const FAIL_MODEL = process.env.FAKE_AGENT_FAIL_MODEL || "";
const FIXTURE = process.env.GROKFORGE_FIXTURE || "";

function write(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return;
  }
  const { id, method, params } = msg;
  if (!method) return;

  switch (method) {
    case "initialize":
      write({ jsonrpc: "2.0", id, result: { protocolVersion: 1 } });
      break;
    case "session/new":
      write({ jsonrpc: "2.0", id, result: { sessionId: "fake-session-1" } });
      break;
    case "session/prompt": {
      // Real grok-acp responds to the RPC immediately, then runs the turn async — session.ts's
      // `client.prompt()` await only waits for this ack, not the full turn.
      write({ jsonrpc: "2.0", id, result: { ok: true, accepted: true } });
      const model = params && typeof params.model === "string" ? params.model : "";
      setTimeout(() => {
        if (FIXTURE === "reasoning-only") {
          write({ jsonrpc: "2.0", method: "thinking_delta", params: { text: "internal reasoning only" } });
          write({ jsonrpc: "2.0", method: "done", params: { reason: "stop" } });
          return;
        }
        if (FIXTURE === "delayed-final") {
          write({ jsonrpc: "2.0", method: "thinking_delta", params: { text: "reasoning" } });
          setTimeout(() => {
            write({ jsonrpc: "2.0", method: "text_delta", params: { text: "delayed final answer" } });
            write({ jsonrpc: "2.0", method: "done", params: { reason: "stop" } });
          }, 250);
          return;
        }
        if (FIXTURE === "long-run") {
          let ticks = 0;
          const timer = setInterval(() => {
            ticks += 1;
            write({ jsonrpc: "2.0", method: "run_phase", params: { phase: "reasoning", detail: `heartbeat-${ticks}` } });
            if (ticks >= 4) { clearInterval(timer); write({ jsonrpc: "2.0", method: "text_delta", params: { text: "long run complete" } }); write({ jsonrpc: "2.0", method: "done", params: { reason: "stop" } }); }
          }, 150);
          return;
        }
        if (FIXTURE === "orphan-content") {
          write({ jsonrpc: "2.0", method: "text_delta", params: { text: "received before restart" } });
          return;
        }
        if (FIXTURE === "cancel-content") {
          write({ jsonrpc: "2.0", method: "thinking_delta", params: { text: "reasoning before cancel" } });
          write({ jsonrpc: "2.0", method: "text_delta", params: { text: "answer before cancel" } });
          return;
        }
        if (FIXTURE === "late-events") {
          write({ jsonrpc: "2.0", method: "text_delta", params: { text: "settled answer" } });
          write({ jsonrpc: "2.0", method: "done", params: { reason: "stop" } });
          setTimeout(() => {
            write({ jsonrpc: "2.0", method: "thinking_delta", params: { text: "late reasoning" } });
            write({ jsonrpc: "2.0", method: "text_delta", params: { text: "late answer" } });
            write({ jsonrpc: "2.0", method: "tool_run", params: { activityId: "late-tool", toolCallId: "late-tool", lifecycle: "terminal", execution: "executed", status: "succeeded", name: "write_file", output: "late" } });
            write({ jsonrpc: "2.0", method: "permission_request", params: { id: "late-perm", kind: "shell", detail: "late" } });
            write({ jsonrpc: "2.0", method: "file_edit", params: { id: "late-edit", status: "proposed", path: "late.txt" } });
            write({ jsonrpc: "2.0", method: "error", params: { code: "late_error", message: "late" } });
            write({ jsonrpc: "2.0", method: "done", params: { reason: "stop" } });
          }, 100);
          return;
        }
        if (FIXTURE === "plan-empty") {
          write({ jsonrpc: "2.0", method: "text_delta", params: { text: "Nothing to change in this workspace." } });
          write({ jsonrpc: "2.0", method: "done", params: { reason: "stop" } });
          return;
        }
        if (FIXTURE === "plan-multi") {
          write({ jsonrpc: "2.0", method: "text_delta", params: { text: "- Update `src/a.ts` to export helper\n- Create apps/shell/src/b.tsx for UI" } });
          write({ jsonrpc: "2.0", method: "done", params: { reason: "stop" } });
          return;
        }
        if (FIXTURE === "plan-write-attempt") {
          write({ jsonrpc: "2.0", method: "tool_run", params: { schemaVersion: 2, type: "tool_run", activityId: "plan-write", toolCallId: "plan-write", lifecycle: "pending", execution: null, status: "running", name: "write_file", input: { path: "mutated.txt", content: "nope" }, summary: null, command: null, output: null, error: null, reasonCode: null, reason: null, shellDisplayName: "Command Prompt (cmd.exe)", detailAvailable: true } });
          write({ jsonrpc: "2.0", method: "tool_run", params: { schemaVersion: 2, type: "tool_run", activityId: "plan-write", toolCallId: "plan-write", lifecycle: "terminal", execution: "not_executed", status: "rejected", name: "write_file", input: { path: "mutated.txt", content: "nope" }, summary: null, command: null, output: "{\"error\":\"Plan phase refuses mutations\",\"execution\":\"not_executed\",\"reasonCode\":\"plan_phase_refused\"}", error: null, reasonCode: "plan_phase_refused", reason: "Plan phase: edits and non-inspection shell are not executed", shellDisplayName: "Command Prompt (cmd.exe)", detailAvailable: true } });
          write({ jsonrpc: "2.0", method: "text_delta", params: { text: "Would change: src/blocked.ts" } });
          write({ jsonrpc: "2.0", method: "done", params: { reason: "stop" } });
          return;
        }
        if (FIXTURE === "provider-silence") {
          write({ jsonrpc: "2.0", method: "run_phase", params: { phase: "reasoning", detail: "Provider connected" } });
          write({ jsonrpc: "2.0", method: "run_phase", params: { phase: "waiting_model", detail: "Recovering provider transport…" } });
          const releasePath = process.env.GROKFORGE_FIXTURE_RELEASE;
          const release = () => {
            write({ jsonrpc: "2.0", method: "error", params: { code: "provider_liveness_timeout", message: "provider silent" } });
            write({ jsonrpc: "2.0", method: "done", params: { reason: "error" } });
          };
          if (!releasePath) { release(); return; }
          const wait = setInterval(() => { if (fs.existsSync(releasePath)) { clearInterval(wait); release(); } }, 5);
          return;
        }
        if (FAIL_MODEL && model === FAIL_MODEL) {
          write({
            jsonrpc: "2.0",
            method: "error",
            params: {
              code: "api_error",
              status: 400,
              message: "model rejected (fake-acp-agent)",
              detail: `model=${model}`,
            },
          });
          write({ jsonrpc: "2.0", method: "done", params: { reason: "error" } });
        } else {
          write({ jsonrpc: "2.0", method: "text_delta", params: { text: `ok from ${model}` } });
          write({ jsonrpc: "2.0", method: "done", params: { reason: "stop" } });
        }
      }, 20);
      break;
    }
    case "session/cancel":
      write({ jsonrpc: "2.0", id, result: { ok: true } });
      write({ jsonrpc: "2.0", method: "done", params: { reason: "cancelled" } });
      break;
    case "dispose":
      write({ jsonrpc: "2.0", id, result: { ok: true } });
      break;
    default:
      write({ jsonrpc: "2.0", id, error: { code: -32601, message: `not found: ${method}` } });
  }
});

process.stdin.on("end", () => process.exit(0));
