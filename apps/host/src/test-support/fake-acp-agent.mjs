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

const FAIL_MODEL = process.env.FAKE_AGENT_FAIL_MODEL || "";

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
      break;
    case "dispose":
      write({ jsonrpc: "2.0", id, result: { ok: true } });
      break;
    default:
      write({ jsonrpc: "2.0", id, error: { code: -32601, message: `not found: ${method}` } });
  }
});

process.stdin.on("end", () => process.exit(0));
