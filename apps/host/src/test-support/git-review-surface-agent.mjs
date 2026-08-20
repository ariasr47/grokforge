import { createInterface } from "node:readline";

function write(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function toolRun(partial) {
  write({
    jsonrpc: "2.0",
    method: "tool_run",
    params: {
      schemaVersion: 2,
      type: "tool_run",
      lifecycle: "terminal",
      execution: "executed",
      status: "succeeded",
      input: {},
      summary: null,
      error: null,
      reasonCode: null,
      reason: null,
      shellDisplayName: null,
      detailAvailable: true,
      automaticEligibility: "trusted_command_class",
      autoApplied: true,
      editId: null,
      diff: null,
      recovery: null,
      ...partial,
    },
  });
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.method === "initialize") {
    write({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: 1 } });
    return;
  }
  if (msg.method === "session/new") {
    write({ jsonrpc: "2.0", id: msg.id, result: { sessionId: "git-review-session" } });
    return;
  }
  if (msg.method !== "session/prompt") return;
  const prompt = String(msg.params?.prompt ?? msg.params?.text ?? "");
  write({ jsonrpc: "2.0", id: msg.id, result: { ok: true, accepted: true } });

  setTimeout(() => {
    if (prompt.includes("force-push")) {
      write({
        jsonrpc: "2.0",
        method: "permission_request",
        params: { id: "git-review-force", kind: "shell", detail: "git push --force" },
      });
      return;
    }
    if (prompt.includes("fixed-status")) {
      toolRun({
        activityId: "gr-fixed",
        toolCallId: "gr-fixed",
        name: "run_shell",
        command: "git status --short",
        automaticEligibility: "fixed_inspection",
        autoApplied: true,
        output: " M apps/shell/src/App.tsx\n",
      });
      return;
    }
    if (prompt.includes("review-diff")) {
      toolRun({
        activityId: "gr-review",
        toolCallId: "gr-review",
        name: "run_shell",
        command: "git diff --stat",
        automaticEligibility: "not_eligible",
        autoApplied: false,
        output: " apps/shell/src/App.tsx | 2 +-\n",
      });
      return;
    }
    if (prompt.includes("gh-pr")) {
      toolRun({
        activityId: "gr-status",
        toolCallId: "gr-status",
        name: "run_shell",
        command: "git status -sb",
        output: "## main...origin/main [ahead 1]\n",
      });
      toolRun({
        activityId: "gr-pr",
        toolCallId: "gr-pr",
        name: "run_shell",
        command: "gh pr view",
        automaticEligibility: "not_eligible",
        autoApplied: false,
        output: "title:\tDemo PR\n",
      });
      return;
    }
    // default: Trusted-shaped status + diff
    toolRun({
      activityId: "gr-status",
      toolCallId: "gr-status",
      name: "run_shell",
      command: "git status -sb",
      output: "## main\n M dirty.txt\n",
    });
    toolRun({
      activityId: "gr-diff",
      toolCallId: "gr-diff",
      name: "run_shell",
      command: "git diff",
      output: "diff --git a/dirty.txt b/dirty.txt\n",
    });
  }, 20);
});
