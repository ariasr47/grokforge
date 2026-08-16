import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ToolActivityGroup } from "./ToolActivity.js";
import type { ChatMessage } from "./messageBlocks.js";

afterEach(() => cleanup());

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
