import assert from "node:assert/strict";
import test from "node:test";
import { toDisplayBlocks } from "./messageBlocks.js";

test("tool-first live run projects without an assistant owner", () => {
  const blocks = toDisplayBlocks([
    {
      id: "tool-1", role: "tool", content: "", activityRunKey: "activity-run:0",
      activityOrder: 0, activityIdentity: "tool:a", toolMeta: { name: "read_file", done: true, ok: true },
    },
    {
      id: "chip-1", role: "system", content: "Permission requested: shell", activityRunKey: "activity-run:0",
      activityOrder: 1, activityIdentity: "permission:p",
    },
  ]);
  assert.equal(blocks.filter((b) => b.kind === "tools").length, 1);
  assert.equal(blocks.some((b) => b.kind === "message" && b.message.role === "assistant"), false);
});
