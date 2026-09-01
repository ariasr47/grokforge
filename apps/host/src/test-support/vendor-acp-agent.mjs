#!/usr/bin/env node
/**
 * Fake vendor `grok agent stdio` ACP child. Speaks JSON-RPC on stdio.
 * Modes via GROKFORGE_VENDOR_FIXTURE: ok | fail-initialize | fail-session-new |
 * emit-session-update | request-permission | exit-after-live | journey |
 * prompt-midturn-only | prompt-empty-finish | prompt-double-done |
 * prompt-with-open-permission | prompt-with-permission-and-diff |
 * prompt-hang-midturn | prompt-fail |
 * child-agent | child-agent-incomplete | child-agent-first-done |
 * child-agent-first-failed | child-agent-late | child-agent-unmapped |
 * child-agent-multi | browser-fetch | browser-fetch-first-done |
 * browser-fetch-first-failed | browser-fetch-rejected | browser-fetch-snapshot |
 * browser-fetch-multi | browser-fetch-incomplete | browser-toolkind-other |
 * browser-toolkind-execute | browser-title-only | browser-no-url-title |
 * mcp-server | mcp-server-incomplete | mcp-server-multi | mcp-server-first-error |
 * mcp-server-late-idle | mcp-server-unmapped | mcp-server-late-error |
 * hooks | hooks-incomplete | hooks-multi | hooks-first-done |
 * hooks-late-idle | hooks-late-failed | hooks-unmapped |
 * skills-mixed-interior | skills-mixed-nonobject | skills-all-skipped |
 * skills-replace-shrink
 */
import { createInterface } from "node:readline";
import fs from "node:fs";
import path from "node:path";

const FIXTURE = process.env.GROKFORGE_VENDOR_FIXTURE || "ok";

function write(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

const spawnRec = {
  argv: process.argv.slice(),
  cwd: process.cwd(),
  hasXai: Object.prototype.hasOwnProperty.call(process.env, "XAI_API_KEY"),
  grokApiKey: Object.prototype.hasOwnProperty.call(process.env, "GROK_API_KEY"),
  pid: process.pid,
  fixture: FIXTURE,
};

function persist(extra) {
  const dir = process.env.GROKFORGE_DATA_DIR;
  let prior = {};
  if (dir) {
    try {
      prior = JSON.parse(fs.readFileSync(path.join(dir, "vendor-spawn.json"), "utf8"));
    } catch {
      prior = {};
    }
  }
  const rec = { ...spawnRec, ...prior, ...extra };
  if (!dir) return;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "vendor-spawn.json"), JSON.stringify(rec), "utf8");
  } catch {
    /* ignore */
  }
}

process.stderr.write("GROKFORGE_VENDOR_SPAWN " + JSON.stringify(spawnRec) + "\n");
persist({});
try {
  fs.writeFileSync(path.join(process.cwd(), "vendor-pid.txt"), String(process.pid), "utf8");
} catch {
  /* ignore */
}

function emitSessionUpdates() {
  write({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "vendor-session",
      update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "considering" } },
    },
  });
  write({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "vendor-session",
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "I will read the file." } },
    },
  });
  write({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "vendor-session",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "read-1",
        title: "Read notes.md",
        kind: "read",
        status: "pending",
      },
    },
  });
  write({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "vendor-session",
      update: { sessionUpdate: "tool_call_update", toolCallId: "read-1", status: "completed" },
    },
  });
}

function firstToken(text) {
  const trimmed = String(text ?? "").trimStart();
  const m = trimmed.match(/^[^\s]+/);
  return m ? m[0] : "";
}

function promptText(params) {
  const p = params && params.prompt;
  if (typeof p === "string") return p;
  if (Array.isArray(p)) {
    return p
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part.text === "string") return part.text;
        return "";
      })
      .join("");
  }
  return "";
}

function emitAvailableCommands() {
  if (FIXTURE === "skills-silent") return;
  if (FIXTURE === "skills-empty") {
    write({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "vendor-session",
        update: { sessionUpdate: "available_commands_update", availableCommands: [] },
      },
    });
    return;
  }
  if (FIXTURE === "skills-malformed") {
    write({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "vendor-session",
        update: { sessionUpdate: "available_commands_update", availableCommands: [{ name: "has space" }] },
      },
    });
    return;
  }
  if (FIXTURE === "skills-mixed-interior") {
    write({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "vendor-session",
        update: {
          sessionUpdate: "available_commands_update",
          availableCommands: [
            { name: "/a", description: null },
            { name: "has space" },
            { name: "/b", description: "bee" },
          ],
        },
      },
    });
    return;
  }
  if (FIXTURE === "skills-mixed-nonobject") {
    write({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "vendor-session",
        update: {
          sessionUpdate: "available_commands_update",
          availableCommands: [
            { name: "/a" },
            1,
            null,
            "raw",
            { name: "/b", description: "bee" },
          ],
        },
      },
    });
    return;
  }
  if (FIXTURE === "skills-all-skipped") {
    write({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "vendor-session",
        update: {
          sessionUpdate: "available_commands_update",
          availableCommands: [{ name: "has space" }, 1, null],
        },
      },
    });
    return;
  }
  if (FIXTURE === "skills-replace-shrink") {
    write({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "vendor-session",
        update: {
          sessionUpdate: "available_commands_update",
          availableCommands: [
            { name: "/keep", description: null },
            { name: "/stale", description: null },
          ],
        },
      },
    });
    write({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "vendor-session",
        update: {
          sessionUpdate: "available_commands_update",
          availableCommands: [
            { name: "/keep", description: null },
            { name: "has space" },
            { name: "/new", description: "n" },
          ],
        },
      },
    });
    return;
  }
  const valid = {
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "vendor-session",
      update: {
        sessionUpdate: "available_commands_update",
        availableCommands: [{ name: "/forge-skill-fixture", description: "Forge skill fixture" }],
      },
    },
  };
  write(valid);
  if (FIXTURE === "skills-malformed-after-valid") {
    write({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "vendor-session",
        update: { sessionUpdate: "available_commands_update", availableCommands: [{ name: 1 }] },
      },
    });
  }
}

function emitSkillFixture(text) {
  write({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "vendor-session",
      update: {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "FORGE_SKILL_FIXTURE_ACTIVATED" },
      },
    },
  });
  write({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "vendor-session",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: `fixture skill complete for ${text}` },
      },
    },
  });
  write({ jsonrpc: "2.0", method: "done", params: { reason: "stop" } });
}

function emitChildAgent(update) {
  write({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "vendor-session",
      update,
    },
  });
}

function emitToolCall(update) {
  write({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "vendor-session",
      update,
    },
  });
}

function emitMcpStatus(params) {
  write({
    jsonrpc: "2.0",
    method: "_x.ai/mcp/server_status",
    params: { sessionId: "vendor-session", source: "local", ...params },
  });
}

function emitMcpFixture() {
  if (FIXTURE === "mcp-server") {
    emitMcpStatus({ name: "railway", status: "ready", reason: "initialized" });
    return true;
  }
  if (FIXTURE === "mcp-server-incomplete") {
    emitMcpStatus({ name: "figma" });
    return true;
  }
  if (FIXTURE === "mcp-server-multi") {
    emitMcpStatus({ name: "railway", status: "ready", reason: "initialized" });
    emitMcpStatus({ name: "chrome-devtools", status: "ready", reason: "initialized" });
    return true;
  }
  if (FIXTURE === "mcp-server-first-error") {
    emitMcpStatus({ name: "figma", status: "unavailable", reason: "handshake_failed" });
    return true;
  }
  if (FIXTURE === "mcp-server-late-idle") {
    emitMcpStatus({ name: "railway", status: "ready", reason: "initialized" });
    write({ jsonrpc: "2.0", method: "text_delta", params: { text: "ok from vendor" } });
    write({ jsonrpc: "2.0", method: "done", params: { reason: "stop" } });
    setTimeout(() => {
      emitMcpStatus({ name: "railway", status: "idle" });
    }, 80);
    return "late";
  }
  if (FIXTURE === "mcp-server-late-error") {
    emitMcpStatus({ name: "railway", status: "ready", reason: "initialized" });
    write({ jsonrpc: "2.0", method: "text_delta", params: { text: "ok from vendor" } });
    write({ jsonrpc: "2.0", method: "done", params: { reason: "stop" } });
    setTimeout(() => {
      emitMcpStatus({ name: "railway", status: "unavailable", reason: "transport_closed" });
    }, 80);
    return "late";
  }
  if (FIXTURE === "mcp-server-unmapped") {
    emitChildAgent({ sessionUpdate: "nested_mcp_v2" });
    return true;
  }
  return false;
}

function hookMember(name, extra = {}) {
  return {
    name,
    event: "pre_tool_use",
    handlerType: "command",
    matcher: "Write|Edit",
    command: "echo hook",
    url: null,
    timeoutMs: 5000,
    sourceDir: "/tmp/hooks",
    disabled: false,
    ...extra,
  };
}

function emitHookExecution(runs) {
  write({
    jsonrpc: "2.0",
    method: "_x.ai/session_notification",
    params: {
      sessionId: "vendor-session",
      update: {
        sessionUpdate: "hook_execution",
        event_name: "pre_tool_use",
        tool_name: "write",
        runs,
      },
    },
  });
}

function hooksListResult() {
  if (FIXTURE === "hooks-incomplete") {
    return { result: { hooks: [{ name: "project/settings:pre_tool_use[0].hooks[0]" }], projectTrusted: true } };
  }
  if (FIXTURE === "hooks-multi") {
    return {
      result: {
        hooks: [
          hookMember("project/settings:pre_tool_use[0].hooks[0]"),
          hookMember("project/spire-path-guard:pre_tool_use[0].hooks[0]"),
        ],
        projectTrusted: true,
      },
    };
  }
  if (FIXTURE === "hooks-first-done" || FIXTURE === "hooks-unmapped") {
    return { result: { hooks: [], projectTrusted: true } };
  }
  if (
    FIXTURE === "hooks" ||
    FIXTURE === "hooks-late-idle" ||
    FIXTURE === "hooks-late-failed"
  ) {
    return {
      result: {
        hooks: [hookMember("project/spire-path-guard:pre_tool_use[0].hooks[0]")],
        projectTrusted: true,
      },
    };
  }
  return { result: { hooks: [], projectTrusted: true } };
}

function emitHooksFixture() {
  if (FIXTURE === "hooks") {
    emitHookExecution([
      {
        name: "project/spire-path-guard:pre_tool_use[0].hooks[0]",
        status: { status: "success", elapsed_ms: 246 },
      },
    ]);
    return true;
  }
  if (FIXTURE === "hooks-incomplete") {
    emitHookExecution([{ name: "project/settings:pre_tool_use[0].hooks[0]" }]);
    return true;
  }
  if (FIXTURE === "hooks-multi") {
    emitHookExecution([
      { name: "project/settings:pre_tool_use[0].hooks[0]", status: { status: "success", elapsed_ms: 10 } },
      { name: "project/spire-path-guard:pre_tool_use[0].hooks[0]", status: { status: "failed", elapsed_ms: 11, error: "boom" } },
    ]);
    return true;
  }
  if (FIXTURE === "hooks-first-done") {
    emitHookExecution([
      { name: "project/settings:pre_tool_use[0].hooks[0]", status: { status: "success", elapsed_ms: 1 } },
    ]);
    return true;
  }
  if (FIXTURE === "hooks-late-idle") {
    emitHookExecution([
      { name: "project/spire-path-guard:pre_tool_use[0].hooks[0]", status: { status: "success", elapsed_ms: 1 } },
    ]);
    write({ jsonrpc: "2.0", method: "text_delta", params: { text: "ok from vendor" } });
    write({ jsonrpc: "2.0", method: "done", params: { reason: "stop" } });
    setTimeout(() => {
      emitHookExecution([
        { name: "project/spire-path-guard:pre_tool_use[0].hooks[0]", status: { status: "skipped" } },
      ]);
    }, 80);
    return "late";
  }
  if (FIXTURE === "hooks-late-failed") {
    emitHookExecution([
      { name: "project/spire-path-guard:pre_tool_use[0].hooks[0]", status: { status: "success", elapsed_ms: 1 } },
    ]);
    write({ jsonrpc: "2.0", method: "text_delta", params: { text: "ok from vendor" } });
    write({ jsonrpc: "2.0", method: "done", params: { reason: "stop" } });
    setTimeout(() => {
      emitHookExecution([
        { name: "project/spire-path-guard:pre_tool_use[0].hooks[0]", status: { status: "failed", elapsed_ms: 2, error: "late" } },
      ]);
    }, 80);
    return "late";
  }
  if (FIXTURE === "hooks-unmapped") {
    emitChildAgent({ sessionUpdate: "nested_hooks_v2" });
    write({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "vendor-session",
        update: {
          sessionUpdate: "hook_execution",
          runs: [{ name: "invented", status: { status: "success" } }],
        },
      },
    });
    return true;
  }
  return false;
}

function emitBrowserFixture() {
  if (FIXTURE === "browser-fetch") {
    emitToolCall({
      sessionUpdate: "tool_call",
      toolCallId: "fetch-1",
      title: "Open docs",
      kind: "fetch",
      status: "pending",
      rawInput: { url: "https://docs.x.ai" },
    });
    emitToolCall({
      sessionUpdate: "tool_call_update",
      toolCallId: "fetch-1",
      status: "completed",
    });
    return true;
  }
  if (FIXTURE === "browser-fetch-first-done") {
    emitToolCall({
      sessionUpdate: "tool_call",
      toolCallId: "fetch-2",
      title: "Fast fetch",
      kind: "fetch",
      status: "completed",
      rawInput: { url: "https://example.com" },
    });
    return true;
  }
  if (FIXTURE === "browser-fetch-first-failed") {
    emitToolCall({
      sessionUpdate: "tool_call",
      toolCallId: "fetch-boom",
      title: "Boom",
      kind: "fetch",
      status: "failed",
    });
    return true;
  }
  if (FIXTURE === "browser-fetch-rejected") {
    emitToolCall({
      sessionUpdate: "tool_call",
      toolCallId: "fetch-deny",
      title: "Denied",
      kind: "fetch",
      status: "pending",
      rawInput: { url: "https://denied.example" },
    });
    emitToolCall({
      sessionUpdate: "tool_call_update",
      toolCallId: "fetch-deny",
      status: "cancelled",
    });
    return true;
  }
  if (FIXTURE === "browser-fetch-snapshot") {
    emitToolCall({
      sessionUpdate: "tool_call",
      toolCallId: "fetch-3",
      title: "Shot",
      kind: "fetch",
      status: "pending",
      rawInput: { url: "https://example.com" },
    });
    emitToolCall({
      sessionUpdate: "tool_call_update",
      toolCallId: "fetch-3",
      status: "completed",
      content: [{ type: "image", mimeType: "image/png", data: "aaa" }],
    });
    return true;
  }
  if (FIXTURE === "browser-fetch-multi") {
    emitToolCall({
      sessionUpdate: "tool_call",
      toolCallId: "fetch-a",
      title: "Alpha",
      kind: "fetch",
      status: "pending",
      rawInput: { url: "https://a.example" },
    });
    emitToolCall({
      sessionUpdate: "tool_call",
      toolCallId: "fetch-b",
      title: "Beta",
      kind: "fetch",
      status: "failed",
    });
    emitToolCall({
      sessionUpdate: "tool_call_update",
      toolCallId: "fetch-a",
      status: "completed",
    });
    return true;
  }
  if (FIXTURE === "browser-fetch-incomplete") {
    emitToolCall({
      sessionUpdate: "tool_call",
      title: "No id",
      kind: "fetch",
      status: "pending",
    });
    return true;
  }
  if (FIXTURE === "browser-toolkind-other") {
    emitToolCall({
      sessionUpdate: "tool_call",
      toolCallId: "other-1",
      title: "Browse something",
      kind: "other",
      status: "pending",
    });
    emitToolCall({
      sessionUpdate: "tool_call_update",
      toolCallId: "other-1",
      status: "completed",
    });
    return true;
  }
  if (FIXTURE === "browser-toolkind-execute") {
    emitToolCall({
      sessionUpdate: "tool_call",
      toolCallId: "exec-1",
      title: "Run browse",
      kind: "execute",
      status: "pending",
    });
    emitToolCall({
      sessionUpdate: "tool_call_update",
      toolCallId: "exec-1",
      status: "completed",
    });
    return true;
  }
  if (FIXTURE === "browser-title-only") {
    emitToolCall({
      sessionUpdate: "tool_call",
      toolCallId: "title-1",
      title: "Fetch https://evil.example",
      status: "pending",
      rawInput: { url: "https://evil.example" },
    });
    emitToolCall({
      sessionUpdate: "tool_call_update",
      toolCallId: "title-1",
      status: "completed",
    });
    return true;
  }
  if (FIXTURE === "browser-no-url-title") {
    emitToolCall({
      sessionUpdate: "tool_call",
      toolCallId: "fetch-plain",
      kind: "fetch",
      status: "pending",
    });
    emitToolCall({
      sessionUpdate: "tool_call_update",
      toolCallId: "fetch-plain",
      status: "completed",
    });
    return true;
  }
  return false;
}

function emitPermissionRequest() {
  write({
    jsonrpc: "2.0",
    id: 7,
    method: "session/request_permission",
    params: {
      sessionId: "vendor-session",
      options: [
        { optionId: "allow_once", name: "Allow once", kind: "allow_once" },
        { optionId: "allow_always", name: "Allow always", kind: "allow_always" },
      ],
      toolCall: { toolCallId: "write-1", title: "Write notes.md", kind: "edit" },
    },
  });
}

function emitThoughtAndMessage(thought, message) {
  write({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "vendor-session",
      update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: thought } },
    },
  });
  if (message != null) {
    write({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "vendor-session",
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: message } },
      },
    });
  }
}

function emitFileEdit() {
  write({
    jsonrpc: "2.0",
    method: "file_edit",
    params: {
      id: "edit-1",
      editId: "edit-1",
      invocationId: "edit-1",
      path: "notes.md",
      diff: "--- a/notes.md\n+++ b/notes.md\n@@ -1 +1 @@\n-old\n+new\n",
      status: "proposed",
      kind: "content",
    },
  });
}

function returnPromptStop(id, stopReason) {
  write({ jsonrpc: "2.0", id, result: { stopReason } });
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

  if (id === 7 && !method && ("result" in msg || "error" in msg)) {
    persist({ permissionResult: msg });
    process.stderr.write("ACP_RESULT " + JSON.stringify(msg) + "\n");
    write({ jsonrpc: "2.0", method: "agent_log", params: { level: "info", message: "ACP_RESULT " + JSON.stringify(msg) } });
    if (FIXTURE === "prompt-with-open-permission" || FIXTURE === "prompt-with-permission-and-diff") {
      return;
    }
    write({ jsonrpc: "2.0", method: "text_delta", params: { text: "allowed" } });
    write({ jsonrpc: "2.0", method: "done", params: { reason: "stop" } });
    return;
  }

  if (!method) return;

  switch (method) {
    case "initialize":
      persist({ initialize: params });
      process.stderr.write("INIT_PARAMS " + JSON.stringify(params) + "\n");
      if (FIXTURE === "fail-initialize") {
        write({ jsonrpc: "2.0", id, error: { code: -32000, message: "initialize failed" } });
        return;
      }
      write({ jsonrpc: "2.0", id, result: { protocolVersion: 1 } });
      break;
    case "authenticate":
      persist({ authenticate: params });
      write({ jsonrpc: "2.0", id, result: { ok: true } });
      break;
    case "session/new":
      if (FIXTURE === "fail-session-new") {
        write({ jsonrpc: "2.0", id, error: { code: -32000, message: "session/new failed" } });
        return;
      }
      write({ jsonrpc: "2.0", id, result: { sessionId: "vendor-session" } });
      emitAvailableCommands();
      break;
    case "session/prompt": {
      const text = promptText(params);
      persist({ lastPrompt: text, promptFirstToken: firstToken(text) });
      if (FIXTURE === "prompt-midturn-only") {
        emitThoughtAndMessage("considering", "pong");
        returnPromptStop(id, "end_turn");
        break;
      }
      if (FIXTURE === "prompt-empty-finish") {
        emitThoughtAndMessage("silent reasoning", null);
        returnPromptStop(id, "end_turn");
        break;
      }
      if (FIXTURE === "prompt-double-done") {
        emitThoughtAndMessage("considering", "pong");
        returnPromptStop(id, "end_turn");
        write({ jsonrpc: "2.0", method: "done", params: { reason: "stop" } });
        break;
      }
      if (FIXTURE === "prompt-with-open-permission") {
        emitThoughtAndMessage("need write", "about to write");
        emitPermissionRequest();
        returnPromptStop(id, "end_turn");
        break;
      }
      if (FIXTURE === "prompt-with-permission-and-diff") {
        emitThoughtAndMessage("need both", "about to mutate");
        emitPermissionRequest();
        emitFileEdit();
        returnPromptStop(id, "end_turn");
        break;
      }
      if (FIXTURE === "prompt-hang-midturn") {
        write({ jsonrpc: "2.0", id, result: { ok: true, accepted: true } });
        setTimeout(() => {
          emitThoughtAndMessage("considering", "pong");
        }, 20);
        break;
      }
      if (FIXTURE === "prompt-fail") {
        emitThoughtAndMessage("considering", "partial words");
        returnPromptStop(id, "error");
        break;
      }
      write({ jsonrpc: "2.0", id, result: { ok: true, accepted: true } });
      if (FIXTURE === "exit-after-live") {
        setTimeout(() => process.exit(1), 20);
        return;
      }
      setTimeout(() => {
        const skill = firstToken(text) === "/forge-skill-fixture";
        if (skill && FIXTURE !== "request-permission" && FIXTURE !== "journey") {
          emitSkillFixture(text);
          return;
        }
        if (skill) {
          write({
            jsonrpc: "2.0",
            method: "session/update",
            params: {
              sessionId: "vendor-session",
              update: {
                sessionUpdate: "agent_thought_chunk",
                content: { type: "text", text: "FORGE_SKILL_FIXTURE_ACTIVATED" },
              },
            },
          });
        }
        if (FIXTURE === "child-agent") {
          emitChildAgent({
            sessionUpdate: "agent",
            childId: "child-1",
            identityLabel: "Researcher",
            status: "running",
          });
          emitChildAgent({
            sessionUpdate: "agent",
            childId: "child-1",
            identityLabel: "Researcher",
            status: "done",
          });
          write({ jsonrpc: "2.0", method: "text_delta", params: { text: "ok from vendor" } });
          write({ jsonrpc: "2.0", method: "done", params: { reason: "stop" } });
          return;
        }
        if (FIXTURE === "child-agent-incomplete") {
          emitChildAgent({
            sessionUpdate: "agent",
            childId: "child-3",
            identityLabel: "MissingStatus",
          });
          write({ jsonrpc: "2.0", method: "text_delta", params: { text: "ok from vendor" } });
          write({ jsonrpc: "2.0", method: "done", params: { reason: "stop" } });
          return;
        }
        if (FIXTURE === "child-agent-first-done") {
          emitChildAgent({
            sessionUpdate: "agent",
            childId: "child-2",
            identityLabel: "Fast",
            status: "done",
          });
          write({ jsonrpc: "2.0", method: "text_delta", params: { text: "ok from vendor" } });
          write({ jsonrpc: "2.0", method: "done", params: { reason: "stop" } });
          return;
        }
        if (FIXTURE === "child-agent-first-failed") {
          emitChildAgent({
            sessionUpdate: "agent",
            childId: "child-boom",
            identityLabel: "Boom",
            status: "failed",
          });
          write({ jsonrpc: "2.0", method: "text_delta", params: { text: "ok from vendor" } });
          write({ jsonrpc: "2.0", method: "done", params: { reason: "stop" } });
          return;
        }
        if (FIXTURE === "child-agent-late") {
          emitChildAgent({
            sessionUpdate: "agent",
            childId: "child-1",
            identityLabel: "Researcher",
            status: "running",
          });
          write({ jsonrpc: "2.0", method: "text_delta", params: { text: "ok from vendor" } });
          write({ jsonrpc: "2.0", method: "done", params: { reason: "stop" } });
          setTimeout(() => {
            emitChildAgent({
              sessionUpdate: "agent",
              childId: "child-1",
              identityLabel: "Researcher",
              status: "done",
            });
          }, 80);
          return;
        }
        if (FIXTURE === "child-agent-unmapped") {
          emitChildAgent({ sessionUpdate: "nested_agent_v2" });
          write({ jsonrpc: "2.0", method: "text_delta", params: { text: "ok from vendor" } });
          write({ jsonrpc: "2.0", method: "done", params: { reason: "stop" } });
          return;
        }
        if (emitBrowserFixture()) {
          write({ jsonrpc: "2.0", method: "text_delta", params: { text: "ok from vendor" } });
          write({ jsonrpc: "2.0", method: "done", params: { reason: "stop" } });
          return;
        }
        const mcp = emitMcpFixture();
        if (mcp === "late") return;
        if (mcp) {
          write({ jsonrpc: "2.0", method: "text_delta", params: { text: "ok from vendor" } });
          write({ jsonrpc: "2.0", method: "done", params: { reason: "stop" } });
          return;
        }
        const hooks = emitHooksFixture();
        if (hooks === "late") return;
        if (hooks) {
          write({ jsonrpc: "2.0", method: "text_delta", params: { text: "ok from vendor" } });
          write({ jsonrpc: "2.0", method: "done", params: { reason: "stop" } });
          return;
        }
        if (FIXTURE === "child-agent-multi") {
          emitChildAgent({
            sessionUpdate: "agent",
            childId: "child-a",
            identityLabel: "Alpha",
            status: "running",
          });
          emitChildAgent({
            sessionUpdate: "agent",
            childId: "child-b",
            identityLabel: "Beta",
            status: "failed",
          });
          emitChildAgent({
            sessionUpdate: "agent",
            childId: "child-a",
            identityLabel: "Alpha",
            status: "done",
          });
          write({ jsonrpc: "2.0", method: "text_delta", params: { text: "ok from vendor" } });
          write({ jsonrpc: "2.0", method: "done", params: { reason: "stop" } });
          return;
        }
        if (FIXTURE === "emit-session-update") {
          emitSessionUpdates();
          write({ jsonrpc: "2.0", method: "text_delta", params: { text: "Done." } });
          write({ jsonrpc: "2.0", method: "done", params: { reason: "stop" } });
          return;
        }
        if (FIXTURE === "request-permission") {
          emitPermissionRequest();
          return;
        }
        if (FIXTURE === "journey") {
          emitSessionUpdates();
          emitPermissionRequest();
          return;
        }
        write({ jsonrpc: "2.0", method: "text_delta", params: { text: "ok from vendor" } });
        write({ jsonrpc: "2.0", method: "done", params: { reason: "stop" } });
      }, 20);
      break;
    }
    case "_x.ai/hooks/list":
      write({ jsonrpc: "2.0", id, result: hooksListResult() });
      break;
    case "session/cancel":
      write({ jsonrpc: "2.0", id, result: { ok: true } });
      write({ jsonrpc: "2.0", method: "done", params: { reason: "cancelled" } });
      break;
    case "permission/respond":
      process.stderr.write("GOT_PERMISSION_RESPOND\n");
      write({ jsonrpc: "2.0", method: "agent_log", params: { level: "warn", message: "GOT_PERMISSION_RESPOND" } });
      break;
    case "edit/respond":
      write({ jsonrpc: "2.0", id, result: { ok: true } });
      break;
    case "dispose":
      write({ jsonrpc: "2.0", id, result: { ok: true } });
      break;
    default:
      if (id !== undefined) write({ jsonrpc: "2.0", id, error: { code: -32601, message: `not found: ${method}` } });
  }
});

process.stdin.on("end", () => process.exit(0));
