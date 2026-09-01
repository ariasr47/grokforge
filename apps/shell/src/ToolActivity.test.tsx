import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ToolActivityGroup } from "./ToolActivity.js";
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
  // jsdom keeps these getters on Element.prototype; the follow patch
  // installs own properties on HTMLElement.prototype that must be deleted.
  delete (proto as unknown as Record<string, unknown>)[name];
}

function row(i: number, status: "ok" | "pending" | "fail" | "not-run" = "ok"): ChatMessage {
  return {
    id: `tool-${i}`, role: "tool", content: `output ${i}`,
    toolMeta: {
      name: "run_shell", summary: `command-${i}`, done: status === "ok",
      ok: status === "fail" ? false : status === "ok" ? true : undefined,
      execution: status === "not-run" ? "not_executed" : status === "fail" ? "executed" : undefined,
      status: status === "pending" ? "running" : status === "fail" ? "failed" : status === "not-run" ? "rejected" : "succeeded",
      detailAvailable: true,
    },
  };
}

test("tool activity opens automatically and remains open after settlement", () => {
  const tools = Array.from({ length: 45 }, (_, i) => row(i, i === 2 ? "fail" : "ok"));
  const { rerender } = render(<ToolActivityGroup tools={tools} groupKey="activity-run:0" />);
  const body = screen.getByRole("region", { name: "Tool activity details" });
  assert.equal(body.getAttribute("tabindex"), "0");
  // Dynamic activity must not collapse when its transcript column is under
  // flex pressure (the packaged WebView regression). This RED assertion is
  // intentionally structural: the class owns the non-shrinking rail rule.
  assert.equal(screen.getByRole("region", { name: "Tool activity details" }).parentElement?.getAttribute("data-flex-shrink"), "0");
  assert.equal(screen.getByRole("button", { name: /tool activity/i }).getAttribute("aria-expanded"), "true");
  assert.equal(document.querySelectorAll(".tool-row-head").length, 45);
  rerender(<ToolActivityGroup tools={tools.map((t) => ({ ...t, toolMeta: { ...t.toolMeta, done: true, status: "succeeded" as const } }))} groupKey="activity-run:0" />);
  assert.equal(screen.getByRole("region", { name: "Tool activity details" }).isConnected, true);
});

test("run-tools group stays open while live and collapses after a clean settlement", () => {
  const tools = [row(1), row(2), row(3)];
  const { rerender } = render(
    <ToolActivityGroup tools={tools} groupKey="run-tools:abc" live />,
  );
  assert.equal(screen.getByRole("button", { name: /tool activity/i }).getAttribute("aria-expanded"), "true");
  assert.ok(screen.getByRole("region", { name: "Tool activity details" }));
  rerender(<ToolActivityGroup tools={tools} groupKey="run-tools:abc" live={false} />);
  assert.equal(screen.getByRole("button", { name: /tool activity/i }).getAttribute("aria-expanded"), "false");
  assert.equal(screen.queryByRole("region", { name: "Tool activity details" }), null);
});

test("run-tools group stays open after settlement when a tool failed", () => {
  const tools = [row(1), row(2, "fail")];
  render(<ToolActivityGroup tools={tools} groupKey="run-tools:fail" live={false} />);
  assert.equal(screen.getByRole("button", { name: /tool activity/i }).getAttribute("aria-expanded"), "true");
  assert.ok(screen.getByRole("region", { name: "Tool activity details" }));
});

test("run-tools explicit open survives settlement", () => {
  const tools = [row(1), row(2)];
  const { rerender } = render(
    <ToolActivityGroup tools={tools} groupKey="run-tools:stay" live />,
  );
  fireEvent.click(screen.getByRole("button", { name: /tool activity/i }));
  fireEvent.click(screen.getByRole("button", { name: /tool activity/i }));
  assert.equal(screen.getByRole("button", { name: /tool activity/i }).getAttribute("aria-expanded"), "true");
  rerender(<ToolActivityGroup tools={tools} groupKey="run-tools:stay" live={false} />);
  assert.equal(screen.getByRole("button", { name: /tool activity/i }).getAttribute("aria-expanded"), "true");
});

test("collapsed single write header shows the path, not write", () => {
  render(
    <ToolActivityGroup
      tools={[
        {
          id: "t-write",
          role: "tool",
          content: "ok",
          toolMeta: {
            name: "write",
            title: "docs/dogfood/WRAP.md",
            summary: "docs/dogfood/WRAP.md",
            done: true,
            ok: true,
            execution: "executed",
            status: "succeeded",
          },
        },
      ]}
      groupKey="run-tools:write"
      live={false}
    />,
  );
  const head = screen.getByRole("button", { name: /tool activity/i });
  assert.equal(head.getAttribute("aria-expanded"), "false");
  assert.match(head.textContent || "", /docs\/dogfood\/WRAP\.md/);
  assert.equal(/\bwrite\b/i.test(head.textContent || ""), false);
});

test("collapsed write header extracts the path from Write `path` titles", () => {
  render(
    <ToolActivityGroup
      tools={[
        {
          id: "t-write-tick",
          role: "tool",
          content: "ok",
          toolMeta: {
            name: "write",
            title: "Write `docs/dogfood/WRAP.md`",
            summary: "Write `docs/dogfood/WRAP.md`",
            done: true,
            ok: true,
            execution: "executed",
            status: "succeeded",
          },
        },
      ]}
      groupKey="run-tools:write-tick"
      live={false}
    />,
  );
  const head = screen.getByRole("button", { name: /tool activity/i });
  assert.match(head.textContent || "", /docs\/dogfood\/WRAP\.md/);
  assert.equal(/\bwrite\b/i.test(head.textContent || ""), false);
});

test("collapsed run-tools header shows the shell command, not run terminal command", () => {
  render(
    <ToolActivityGroup
      tools={[
        {
          id: "t1",
          role: "tool",
          content: "ok",
          toolMeta: {
            name: "run_terminal_command",
            title: "Execute `node --import tsx --test src/plan-engagement.test.ts`",
            command: "Set-Location apps/host; node --import tsx --test src/plan-engagement.test.ts",
            done: true,
            ok: true,
            execution: "executed",
            status: "succeeded",
          },
        },
      ]}
      groupKey="run-tools:host"
      live={false}
    />,
  );
  assert.equal(screen.getByRole("button", { name: /tool activity/i }).getAttribute("aria-expanded"), "false");
  assert.ok(screen.getByText(/Set-Location apps\/host/));
  assert.equal(screen.queryByText("run terminal command"), null);
});

test("generic shell rows show the command, not run terminal command", () => {
  render(
    <ToolActivityGroup
      tools={[
        {
          id: "t1",
          role: "tool",
          content: "ok",
          toolMeta: {
            name: "run_terminal_command",
            title: "Execute `node --test src/ComposerPane.test.tsx`",
            summary: "Execute `node --test src/ComposerPane.test.tsx`",
            command: "cd apps/shell; node --test src/ComposerPane.test.tsx",
            done: true,
            ok: true,
            status: "succeeded",
          },
        },
      ]}
      groupKey="activity-run:shell"
    />,
  );
  assert.ok(screen.getAllByText("cd apps/shell; node --test src/ComposerPane.test.tsx").length >= 1);
  assert.equal(screen.queryByText("run terminal command"), null);
  assert.ok(document.querySelector(".tool-row-name-plain"));
});

test("failed shell whose vendor body is just completed peeks Non-zero exit", () => {
  render(
    <ToolActivityGroup
      tools={[
        {
          id: "t-fail",
          role: "tool",
          content: "completed",
          toolMeta: {
            name: "run_terminal_command",
            title: "Execute `node -e \"process.exit(2)\"`",
            command: "node -e \"process.exit(2)\"",
            done: true,
            ok: false,
            execution: "executed",
            status: "failed",
          },
        },
      ]}
      groupKey="activity-run:shell-fail"
    />,
  );
  assert.ok(screen.getByText("Failed"));
  assert.ok(screen.getByText("Non-zero exit"));
  assert.equal(screen.queryByText("completed"), null);
});

test("unavailable vendor TUI tool is omitted from the group subtitle", () => {
  render(
    <ToolActivityGroup
      tools={[
        {
          id: "t-shell",
          role: "tool",
          content: "ok",
          toolMeta: {
            name: "run_terminal_command",
            command: "node --test",
            done: true,
            ok: true,
            execution: "executed",
            status: "succeeded",
          },
        },
        {
          id: "t-miss",
          role: "tool",
          content: "task not found",
          toolMeta: {
            name: "get_command_or_subagent_output",
            done: true,
            ok: false,
            execution: "executed",
            status: "failed",
          },
        },
      ]}
      groupKey="activity-run:mixed-tui"
    />,
  );
  const sub = document.querySelector(".tool-activity-sub");
  assert.equal(sub, null);
  assert.ok(screen.getByText("Not in Forge"));
  assert.ok(screen.getByText("Completed"));
});

test("Grok TUI output-fetch is Not in Forge, not a Failed product tool", () => {
  render(
    <ToolActivityGroup
      tools={[
        {
          id: "t-miss",
          role: "tool",
          content: "task not found",
          toolMeta: {
            name: "get_command_or_subagent_output",
            done: true,
            ok: false,
            execution: "executed",
            status: "failed",
            activityEvent: {
              error: "failed",
              output: "task not found",
            } as unknown as import("./api.js").ToolRunEvent,
          },
        },
      ]}
      groupKey="activity-run:tool-miss"
    />,
  );
  assert.ok(screen.getByText("Not in Forge"));
  assert.ok(screen.getByText("Not available in Forge Code."));
  assert.equal(screen.queryByText("Failed"), null);
  assert.equal(screen.queryByText("task not found"), null);
});

test("explicit collapse persists and body is keyboard reachable", () => {
  const tools = [row(1), row(2)];
  render(<ToolActivityGroup tools={tools} groupKey="activity-run:1" />);
  const head = screen.getAllByRole("button", { name: /tool activity/i })[0]!;
  fireEvent.click(head);
  assert.equal(head.getAttribute("aria-expanded"), "false");
  fireEvent.click(head);
  const body = screen.getByRole("region", { name: "Tool activity details" });
  assert.equal(body.getAttribute("tabindex"), "0");
  assert.ok(screen.getAllByText("Completed").length >= 2);
});

test("one completed tool does not repeat Completed on the group header", () => {
  render(<ToolActivityGroup tools={[row(1)]} groupKey="activity-run:one" />);
  assert.equal(screen.getAllByText("Completed").length, 1);
  const head = screen.getByRole("button", { name: /tool activity/i });
  assert.match(head.textContent || "", /run shell/i);
  assert.equal((head.textContent || "").includes("Completed"), false);
});

const followScrollTop = new WeakMap<HTMLElement, number>();

function installInnerFollowGeometry(): void {
  const proto = HTMLElement.prototype;
  Object.defineProperty(proto, "clientHeight", {
    configurable: true,
    get() {
      return (this as HTMLElement).classList?.contains("tool-activity-body") ? 40 : 0;
    },
  });
  Object.defineProperty(proto, "scrollHeight", {
    configurable: true,
    get() {
      const el = this as HTMLElement;
      if (!el.classList?.contains("tool-activity-body")) return 0;
      return el.querySelectorAll(".tool-row").length * 20;
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

function activityBody(): HTMLElement {
  return screen.getByRole("region", { name: "Tool activity details" });
}

test("inner follow keeps latest row when atEnd gap <= 2", () => {
  installInnerFollowGeometry();
  const initial = Array.from({ length: 5 }, (_, i) => row(i));
  const { rerender } = render(<ToolActivityGroup tools={initial} groupKey="activity-run:follow" />);
  followScrollTop.set(activityBody(), activityBody().scrollHeight - activityBody().clientHeight);
  rerender(<ToolActivityGroup tools={[...initial]} groupKey="activity-run:follow" />);
  const grown = [...initial, row(5), row(6)];
  rerender(<ToolActivityGroup tools={grown} groupKey="activity-run:follow" />);
  const body = activityBody();
  assert.equal(body.querySelectorAll(".tool-row").length, grown.length);
  assert.equal(body.scrollTop, grown.length * 20 - 40);
});

test("inner follow does not jump when gap > 2", () => {
  installInnerFollowGeometry();
  const initial = Array.from({ length: 5 }, (_, i) => row(i));
  const { rerender } = render(<ToolActivityGroup tools={initial} groupKey="activity-run:away" />);
  followScrollTop.set(activityBody(), 0);
  rerender(<ToolActivityGroup tools={[...initial]} groupKey="activity-run:away" />);
  rerender(<ToolActivityGroup tools={[...initial, row(5)]} groupKey="activity-run:away" />);
  assert.equal(activityBody().scrollTop, 0);
});

test("returning to atEnd resumes follow", () => {
  installInnerFollowGeometry();
  const initial = Array.from({ length: 5 }, (_, i) => row(i));
  const { rerender } = render(<ToolActivityGroup tools={initial} groupKey="activity-run:resume" />);
  followScrollTop.set(activityBody(), 0);
  rerender(<ToolActivityGroup tools={[...initial]} groupKey="activity-run:resume" />);
  rerender(<ToolActivityGroup tools={[...initial, row(5)]} groupKey="activity-run:resume" />);
  assert.equal(activityBody().scrollTop, 0);
  followScrollTop.set(activityBody(), activityBody().scrollHeight - activityBody().clientHeight);
  const more = [...initial, row(5), row(6), row(7)];
  rerender(<ToolActivityGroup tools={more} groupKey="activity-run:resume" />);
  assert.equal(activityBody().scrollTop, more.length * 20 - 40);
});

function pdfReadTool(overrides: {
  status: "failed" | "succeeded";
  error?: string | null;
  output?: string | null;
  content?: string;
}): ChatMessage {
  return {
    id: "tool-pdf",
    role: "tool",
    content: overrides.content ?? overrides.output ?? "",
    toolMeta: {
      name: "read_file",
      summary: "enc.pdf",
      done: true,
      ok: overrides.status !== "failed",
      execution: "executed",
      status: overrides.status,
      detailAvailable: true,
      activityEvent: {
        schemaVersion: 2,
        type: "tool_run",
        activityId: "pdf-act",
        toolCallId: "pdf-call",
        lifecycle: "terminal",
        execution: "executed",
        status: overrides.status,
        name: "read_file",
        input: { path: "enc.pdf" },
        summary: "enc.pdf",
        command: null,
        output: overrides.output ?? null,
        error: overrides.error ?? null,
        reasonCode: null,
        reason: null,
        shellDisplayName: null,
        detailAvailable: true,
      },
    },
  };
}

test("PDF extract-failed read_file paints failed with vouched class, never OCR", () => {
  render(
    <ToolActivityGroup
      tools={[
        pdfReadTool({
          status: "failed",
          error: "Couldn't extract text from enc.pdf.",
          output: JSON.stringify({
            extract_failed: true,
            extract_failure_class: "encrypted",
            content: "",
            error: "Couldn't extract text from enc.pdf.",
          }),
        }),
      ]}
      groupKey="activity-run:pdf-enc"
    />,
  );
  assert.ok(screen.getByText("Failed"));
  assert.ok(screen.getByText("Couldn't extract text from enc.pdf. (encrypted)"));
  assert.equal(screen.queryByText(/OCR/i), null);
  assert.equal(screen.queryByText(/PDF viewer/i), null);
});

test("missing/confine read_file failure does not reuse extract-failed copy", () => {
  render(
    <ToolActivityGroup
      tools={[
        pdfReadTool({
          status: "failed",
          error: "File not found",
          output: JSON.stringify({ error: "ENOENT" }),
          content: "File not found",
        }),
      ]}
      groupKey="activity-run:pdf-miss"
    />,
  );
  assert.ok(screen.getByText("Failed"));
  assert.ok(screen.getByText("File not found"));
  assert.equal(screen.queryByText(/Couldn't extract text/i), null);
  assert.equal(screen.queryByText(/empty-extract/i), null);
});

test("explicit collapse mid-burst does not auto-expand on new rows", () => {
  const initial = [row(1), row(2)];
  const { rerender } = render(<ToolActivityGroup tools={initial} groupKey="activity-run:collapse" />);
  const head = screen.getByRole("button", { name: /tool activity/i });
  fireEvent.click(head);
  assert.equal(head.getAttribute("aria-expanded"), "false");
  rerender(<ToolActivityGroup tools={[...initial, row(3), row(4)]} groupKey="activity-run:collapse" />);
  assert.equal(head.getAttribute("aria-expanded"), "false");
  assert.equal(screen.queryByRole("region", { name: "Tool activity details" }), null);
});
