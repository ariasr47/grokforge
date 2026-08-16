import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toDisplayBlocks, toolRunStats, type ChatMessage } from "./messageBlocks.js";

function msg(
  partial: Partial<ChatMessage> & Pick<ChatMessage, "id" | "role">,
): ChatMessage {
  return { content: "", ...partial };
}

describe("toDisplayBlocks", () => {
  it("keeps nonconsecutive stamped tools in one group and chips top-level", () => {
    const blocks = toDisplayBlocks([
      msg({ id: "t1", role: "tool", activityRunKey: "activity-run:0", activityOrder: 0, activityIdentity: "tool:a" }),
      msg({ id: "p1", role: "system", content: "Permission requested: shell", activityRunKey: "activity-run:0", activityOrder: 1, activityIdentity: "permission:p" }),
      msg({ id: "t2", role: "tool", activityRunKey: "activity-run:0", activityOrder: 2, activityIdentity: "tool:b" }),
    ]);
    assert.equal(blocks.filter((b) => b.kind === "tools").length, 1);
    assert.equal(blocks.length, 2);
    const group = blocks.find((b) => b.kind === "tools");
    assert.equal(group?.kind, "tools");
    if (group?.kind === "tools") assert.deepEqual(group.tools.map((t) => t.id), ["t1", "t2"]);
  });

  it("does not merge separate stamped runs or create an empty group", () => {
    const blocks = toDisplayBlocks([
      msg({ id: "c", role: "system", content: "Diff proposed: x", activityRunKey: "activity-run:2", activityOrder: 0, activityIdentity: "diff:x" }),
      msg({ id: "t1", role: "tool", activityRunKey: "activity-run:1", activityOrder: 0, activityIdentity: "tool:a" }),
      msg({ id: "t2", role: "tool", activityRunKey: "activity-run:3", activityOrder: 0, activityIdentity: "tool:b" }),
    ]);
    assert.equal(blocks.filter((b) => b.kind === "tools").length, 2);
    assert.equal(blocks.filter((b) => b.kind === "message").length, 1);
  });
  it("collapses consecutive tools into one activity block", () => {
    const blocks = toDisplayBlocks([
      msg({ id: "u1", role: "user", content: "hi" }),
      msg({
        id: "t1",
        role: "tool",
        toolMeta: { name: "read_file", done: true, ok: true },
      }),
      msg({
        id: "t2",
        role: "tool",
        toolMeta: { name: "run_shell", done: true, ok: false },
      }),
      msg({ id: "a1", role: "assistant", content: "done" }),
    ]);
    assert.equal(blocks.length, 3);
    assert.equal(blocks[0]!.kind, "message");
    assert.equal(blocks[1]!.kind, "tools");
    if (blocks[1]!.kind === "tools") {
      assert.equal(blocks[1]!.tools.length, 2);
      assert.equal(blocks[1]!.key, "tools-t1");
    }
    assert.equal(blocks[2]!.kind, "message");
  });

  it("handles trailing tools and empty input", () => {
    assert.deepEqual(toDisplayBlocks([]), []);
    const blocks = toDisplayBlocks([
      msg({ id: "t1", role: "tool", toolMeta: { name: "x", done: false } }),
    ]);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.kind, "tools");
  });
});

describe("toolRunStats", () => {
  it("counts ok/failed/pending and unique names", () => {
    const stats = toolRunStats([
      msg({
        id: "1",
        role: "tool",
        toolMeta: { name: "read_file", done: true, ok: true },
      }),
      msg({
        id: "2",
        role: "tool",
        toolMeta: { name: "read_file", done: true, ok: false },
      }),
      msg({
        id: "3",
        role: "tool",
        toolMeta: { name: "run_shell", done: false },
      }),
    ]);
    assert.equal(stats.total, 3);
    assert.equal(stats.ok, 1);
    assert.equal(stats.failed, 1);
    assert.equal(stats.pending, 1);
    assert.deepEqual(stats.names, ["read_file", "run_shell"]);
  });
});
