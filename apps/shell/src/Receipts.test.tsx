import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Receipts } from "./Receipts.js";
import type { ChatMessage } from "./messageBlocks.js";

const proto = HTMLElement.prototype;
const originalClientHeight = Object.getOwnPropertyDescriptor(proto, "clientHeight");
const originalScrollHeight = Object.getOwnPropertyDescriptor(proto, "scrollHeight");
const originalScrollTop = Object.getOwnPropertyDescriptor(proto, "scrollTop");

afterEach(() => {
  cleanup();
  restoreFollowGeometry();
});

function restoreFollowGeometry(): void {
  restoreGeometryProperty("clientHeight", originalClientHeight);
  restoreGeometryProperty("scrollHeight", originalScrollHeight);
  restoreGeometryProperty("scrollTop", originalScrollTop);
}

function restoreGeometryProperty(
  name: "clientHeight" | "scrollHeight" | "scrollTop",
  original: PropertyDescriptor | undefined,
): void {
  if (original) {
    Object.defineProperty(proto, name, original);
    return;
  }
  delete (proto as unknown as Record<string, unknown>)[name];
}

function row(i: number, status: "ok" | "pending" | "fail" | "not-run" = "ok"): ChatMessage {
  return {
    id: `tool-${i}`, role: "tool", content: `output ${i}`,
    toolMeta: {
      name: "run_shell", summary: `command-${i}`, command: `command-${i}`, done: status === "ok",
      ok: status === "fail" ? false : status === "ok" ? true : undefined,
      execution: status === "not-run" ? "not_executed" : status === "fail" ? "executed" : undefined,
      status: status === "pending" ? "running" : status === "fail" ? "failed" : status === "not-run" ? "rejected" : "succeeded",
      detailAvailable: true,
    },
  };
}

test("receipts opens automatically and remains open after settlement", () => {
  const tools = Array.from({ length: 45 }, (_, i) => row(i, i === 2 ? "fail" : "ok"));
  const { rerender } = render(<Receipts tools={tools} groupKey="activity-run:0" />);
  const body = screen.getByRole("region", { name: "Receipt details" });
  assert.equal(body.getAttribute("tabindex"), "0");
  assert.equal(screen.getByRole("region", { name: "Receipt details" }).parentElement?.getAttribute("data-flex-shrink"), "0");
  assert.equal(screen.getByRole("button", { name: /action/i }).getAttribute("aria-expanded"), "true");
  assert.equal(document.querySelectorAll(".rrow").length, 45);
  rerender(<Receipts tools={tools.map((t) => ({ ...t, toolMeta: { ...t.toolMeta, done: true, status: "succeeded" as const } }))} groupKey="activity-run:0" />);
  assert.equal(screen.getByRole("region", { name: "Receipt details" }).isConnected, true);
});

test("run-tools group stays open while live and collapses after a clean settlement", () => {
  const tools = [row(1), row(2), row(3)];
  const { rerender } = render(<Receipts tools={tools} groupKey="run-tools:abc" live />);
  assert.equal(screen.getByRole("button", { name: /action/i }).getAttribute("aria-expanded"), "true");
  assert.ok(screen.getByRole("region", { name: "Receipt details" }));
  rerender(<Receipts tools={tools} groupKey="run-tools:abc" live={false} />);
  assert.equal(screen.getByRole("button", { name: /action/i }).getAttribute("aria-expanded"), "false");
  assert.equal(screen.queryByRole("region", { name: "Receipt details" }), null);
});

test("run-tools group stays open after settlement when a tool failed", () => {
  const tools = [row(1), row(2, "fail")];
  render(<Receipts tools={tools} groupKey="run-tools:fail" live={false} />);
  assert.equal(screen.getByRole("button", { name: /action/i }).getAttribute("aria-expanded"), "true");
  assert.ok(screen.getByRole("region", { name: "Receipt details" }));
});

test("run-tools explicit open survives settlement", () => {
  const tools = [row(1), row(2)];
  const { rerender } = render(<Receipts tools={tools} groupKey="run-tools:stay" live />);
  fireEvent.click(screen.getByRole("button", { name: /action/i }));
  fireEvent.click(screen.getByRole("button", { name: /action/i }));
  assert.equal(screen.getByRole("button", { name: /action/i }).getAttribute("aria-expanded"), "true");
  rerender(<Receipts tools={tools} groupKey="run-tools:stay" live={false} />);
  assert.equal(screen.getByRole("button", { name: /action/i }).getAttribute("aria-expanded"), "true");
});

test("explicit collapse persists and body is keyboard reachable", () => {
  const tools = [row(1), row(2)];
  render(<Receipts tools={tools} groupKey="activity-run:1" />);
  const head = screen.getAllByRole("button", { name: /action/i })[0]!;
  fireEvent.click(head);
  assert.equal(head.getAttribute("aria-expanded"), "false");
  fireEvent.click(head);
  const body = screen.getByRole("region", { name: "Receipt details" });
  assert.equal(body.getAttribute("tabindex"), "0");
});

test("explicit collapse mid-burst does not auto-expand on new rows", () => {
  const initial = [row(1), row(2)];
  const { rerender } = render(<Receipts tools={initial} groupKey="activity-run:collapse" />);
  const head = screen.getByRole("button", { name: /action/i });
  fireEvent.click(head);
  assert.equal(head.getAttribute("aria-expanded"), "false");
  rerender(<Receipts tools={[...initial, row(3), row(4)]} groupKey="activity-run:collapse" />);
  assert.equal(head.getAttribute("aria-expanded"), "false");
  assert.equal(screen.queryByRole("region", { name: "Receipt details" }), null);
});

test("header shows the action count and, when given, the duration", () => {
  const tools = [row(1), row(2), row(3)];
  render(<Receipts tools={tools} groupKey="activity-run:header" durationSeconds={52} />);
  const head = screen.getByRole("button", { name: /action/i });
  assert.match(head.textContent || "", /3 actions/);
  assert.match(head.textContent || "", /52s/);
});

test("header omits the duration entirely rather than inventing one", () => {
  const tools = [row(1)];
  render(<Receipts tools={tools} groupKey="activity-run:no-duration" />);
  const head = screen.getByRole("button", { name: /action/i });
  assert.match(head.textContent || "", /1 action\b/);
  assert.equal(/\ds\b/.test(head.textContent || ""), false);
});

test("header count excludes the Waiting for you row", () => {
  const waiting: ChatMessage = {
    id: "tool-wait", role: "tool", content: "",
    toolMeta: {
      name: "run_shell", command: "npm test -- OverviewStrip", done: false,
      execution: undefined, status: "running",
      activityEvent: {
        schemaVersion: 2, type: "tool_run", activityId: "a-wait", toolCallId: "a-wait",
        lifecycle: "pending", execution: null, status: "running", name: "run_shell",
        input: null, summary: null, command: "npm test -- OverviewStrip", output: null, error: null,
        reasonCode: null, reason: null, shellDisplayName: null, detailAvailable: false,
        automaticEligibility: "not_eligible", autoApplied: false,
      } as unknown as import("./api.js").ToolRunEvent,
    },
  };
  const tools = [row(1), row(2), waiting];
  render(<Receipts tools={tools} groupKey="activity-run:waiting" />);
  const head = screen.getByRole("button", { name: /action/i });
  assert.match(head.textContent || "", /2 actions/);
  assert.ok(screen.getByText("Waiting for you"));
  assert.ok(screen.getByText("needs approval"));
});

test("failed row is expanded by default", () => {
  const tools = [row(1), row(2, "fail")];
  render(<Receipts tools={tools} groupKey="activity-run:fail-open" />);
  assert.ok(screen.getByRole("region", { name: "Receipt output" }));
});

test("expanded row shows truncated output and the Copy output / Open path actions", () => {
  const many = Array.from({ length: 60 }, (_, i) => `line ${i}`).join("\n");
  const tools: ChatMessage[] = [
    {
      id: "t-fail", role: "tool", content: many,
      toolMeta: {
        name: "run_shell", command: "npx tsc -p tsconfig.json --noEmit", done: true, ok: false,
        execution: "executed", status: "failed",
        activityEvent: {
          schemaVersion: 2, type: "tool_run", activityId: "a1", toolCallId: "a1",
          lifecycle: "terminal", execution: "executed", status: "failed", name: "run_shell",
          input: null, summary: null, command: "npx tsc -p tsconfig.json --noEmit",
          output: JSON.stringify({ exit_code: 2, stdout: many, stderr: "" }), error: null,
          reasonCode: null, reason: null, shellDisplayName: null, detailAvailable: true,
        } as unknown as import("./api.js").ToolRunEvent,
      },
    },
  ];
  render(<Receipts tools={tools} groupKey="activity-run:expand" />);
  const out = screen.getByRole("region", { name: "Receipt output" });
  assert.match(out.textContent || "", /more lines\)/);
  assert.ok((out.textContent || "").split("\n").length <= 50);
  assert.ok(screen.getByRole("button", { name: "Copy output" }));
});

test("unavailable vendor TUI tool paints Skipped, not Failed", () => {
  render(
    <Receipts
      tools={[
        {
          id: "t-miss", role: "tool", content: "task not found",
          toolMeta: {
            name: "get_command_or_subagent_output", done: true, ok: false,
            execution: "executed", status: "failed",
            activityEvent: {
              error: "failed", output: "task not found",
            } as unknown as import("./api.js").ToolRunEvent,
          },
        },
      ]}
      groupKey="activity-run:tool-miss"
    />,
  );
  assert.ok(screen.getByText("Skipped"));
  assert.ok(screen.getByText("not available in Forge"));
  assert.equal(screen.queryByText("Failed"), null);
});

test("list-auto executed shell shows the Ran verb and the trusted-class tail", () => {
  const tools: ChatMessage[] = [
    {
      id: "tool-1", role: "tool", content: "ok",
      toolMeta: {
        name: "run_shell", summary: "npm test", command: "npm test", done: true, ok: true,
        execution: "executed", status: "succeeded",
        activityEvent: {
          schemaVersion: 2, type: "tool_run", activityId: "a", toolCallId: "i",
          lifecycle: "terminal", execution: "executed", status: "succeeded", name: "run_shell",
          input: { command: "npm test" }, summary: "npm test", command: "npm test", output: "ok",
          error: null, reasonCode: null, reason: null, shellDisplayName: "cmd", detailAvailable: true,
          automaticEligibility: "trusted_command_class", autoApplied: true,
        },
      },
    },
  ];
  render(<Receipts tools={tools} groupKey="activity-run:list-auto" forceOpen />);
  assert.ok(screen.getByText("Ran"));
  assert.ok(screen.getByText("npm test"));
  assert.ok(screen.getByText("trusted class · no prompt"));
});

test("generic shell rows show the command as what, not the raw tool name", () => {
  render(
    <Receipts
      tools={[
        {
          id: "t1", role: "tool", content: "ok",
          toolMeta: {
            name: "run_terminal_command",
            title: "Execute `node --test src/ComposerPane.test.tsx`",
            summary: "Execute `node --test src/ComposerPane.test.tsx`",
            command: "cd apps/shell; node --test src/ComposerPane.test.tsx",
            done: true, ok: true, status: "succeeded",
          },
        },
      ]}
      groupKey="activity-run:shell"
    />,
  );
  assert.ok(screen.getAllByText("cd apps/shell; node --test src/ComposerPane.test.tsx").length >= 1);
  assert.equal(screen.queryByText("run terminal command", { exact: false }), null);
});

test("failed shell whose vendor body is just completed peeks Non-zero exit", () => {
  render(
    <Receipts
      tools={[
        {
          id: "t-fail", role: "tool", content: "completed",
          toolMeta: {
            name: "run_terminal_command",
            title: "Execute `node -e \"process.exit(2)\"`",
            command: "node -e \"process.exit(2)\"",
            done: true, ok: false, execution: "executed", status: "failed",
          },
        },
      ]}
      groupKey="activity-run:shell-fail"
    />,
  );
  assert.ok(screen.getByText("Non-zero exit"));
  assert.equal(screen.queryByText("completed"), null);
});

function pdfReadTool(overrides: {
  status: "failed" | "succeeded";
  error?: string | null;
  output?: string | null;
  content?: string;
}): ChatMessage {
  return {
    id: "tool-pdf", role: "tool", content: overrides.content ?? overrides.output ?? "",
    toolMeta: {
      name: "read_file", summary: "enc.pdf", done: true, ok: overrides.status !== "failed",
      execution: "executed", status: overrides.status, detailAvailable: true,
      activityEvent: {
        schemaVersion: 2, type: "tool_run", activityId: "pdf-act", toolCallId: "pdf-call",
        lifecycle: "terminal", execution: "executed", status: overrides.status, name: "read_file",
        input: { path: "enc.pdf" }, summary: "enc.pdf", command: null, output: overrides.output ?? null,
        error: overrides.error ?? null, reasonCode: null, reason: null, shellDisplayName: null,
        detailAvailable: true,
      },
    },
  };
}

test("PDF extract-failed read_file paints failed with vouched class, never OCR", () => {
  render(
    <Receipts
      tools={[
        pdfReadTool({
          status: "failed",
          error: "Couldn't extract text from enc.pdf.",
          output: JSON.stringify({
            extract_failed: true, extract_failure_class: "encrypted", content: "",
            error: "Couldn't extract text from enc.pdf.",
          }),
        }),
      ]}
      groupKey="activity-run:pdf-enc"
    />,
  );
  assert.ok(screen.getByText("Couldn't extract text from enc.pdf. (encrypted)"));
  assert.equal(screen.queryByText(/OCR/i), null);
});

test("missing/confine read_file failure does not reuse extract-failed copy", () => {
  render(
    <Receipts
      tools={[
        pdfReadTool({
          status: "failed", error: "File not found",
          output: JSON.stringify({ error: "ENOENT" }), content: "File not found",
        }),
      ]}
      groupKey="activity-run:pdf-miss"
    />,
  );
  assert.ok(screen.getByText("File not found"));
  assert.equal(screen.queryByText(/Couldn't extract text/i), null);
});

const followScrollTop = new WeakMap<HTMLElement, number>();

function installInnerFollowGeometry(): void {
  Object.defineProperty(proto, "clientHeight", {
    configurable: true,
    get() {
      return (this as HTMLElement).classList?.contains("rbody") ? 40 : 0;
    },
  });
  Object.defineProperty(proto, "scrollHeight", {
    configurable: true,
    get() {
      const el = this as HTMLElement;
      if (!el.classList?.contains("rbody")) return 0;
      return el.querySelectorAll(".rrow").length * 20;
    },
  });
  Object.defineProperty(proto, "scrollTop", {
    configurable: true,
    get() {
      return followScrollTop.get(this as HTMLElement) ?? 0;
    },
    set(value: number) {
      followScrollTop.set(this as HTMLElement, value);
    },
  });
}

function receiptsBody(): HTMLElement {
  return screen.getByRole("region", { name: "Receipt details" });
}

test("inner follow keeps latest row when atEnd gap <= 2", () => {
  installInnerFollowGeometry();
  const initial = Array.from({ length: 5 }, (_, i) => row(i));
  const { rerender } = render(<Receipts tools={initial} groupKey="activity-run:follow" />);
  followScrollTop.set(receiptsBody(), receiptsBody().scrollHeight - receiptsBody().clientHeight);
  rerender(<Receipts tools={[...initial]} groupKey="activity-run:follow" />);
  const grown = [...initial, row(5), row(6)];
  rerender(<Receipts tools={grown} groupKey="activity-run:follow" />);
  const body = receiptsBody();
  assert.equal(body.querySelectorAll(".rrow").length, grown.length);
  assert.equal(body.scrollTop, grown.length * 20 - 40);
});

test("inner follow does not jump when gap > 2", () => {
  installInnerFollowGeometry();
  const initial = Array.from({ length: 5 }, (_, i) => row(i));
  const { rerender } = render(<Receipts tools={initial} groupKey="activity-run:away" />);
  followScrollTop.set(receiptsBody(), 0);
  rerender(<Receipts tools={[...initial]} groupKey="activity-run:away" />);
  rerender(<Receipts tools={[...initial, row(5)]} groupKey="activity-run:away" />);
  assert.equal(receiptsBody().scrollTop, 0);
});

test("returning to atEnd resumes follow", () => {
  installInnerFollowGeometry();
  const initial = Array.from({ length: 5 }, (_, i) => row(i));
  const { rerender } = render(<Receipts tools={initial} groupKey="activity-run:resume" />);
  followScrollTop.set(receiptsBody(), 0);
  rerender(<Receipts tools={[...initial]} groupKey="activity-run:resume" />);
  rerender(<Receipts tools={[...initial, row(5)]} groupKey="activity-run:resume" />);
  assert.equal(receiptsBody().scrollTop, 0);
  followScrollTop.set(receiptsBody(), receiptsBody().scrollHeight - receiptsBody().clientHeight);
  const more = [...initial, row(5), row(6), row(7)];
  rerender(<Receipts tools={more} groupKey="activity-run:resume" />);
  assert.equal(receiptsBody().scrollTop, more.length * 20 - 40);
});
