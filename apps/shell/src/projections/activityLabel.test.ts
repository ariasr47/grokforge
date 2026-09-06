import assert from "node:assert/strict";
import test from "node:test";
import { activityHumanLabel, isForgeUnavailableVendorTool, isGenericToolName, toolRowCaption } from "./activityLabel.js";

test("present title wins", () => {
  assert.equal(activityHumanLabel({ title: "Reading notes.md", summary: "Read notes.md", name: "read_file" }), "Reading notes.md");
});
test("summary when title absent", () => {
  assert.equal(activityHumanLabel({ title: null, summary: "Read notes.md", name: "read_file" }), "Read notes.md");
});
test("name when title/summary absent", () => {
  assert.equal(activityHumanLabel({ title: null, summary: null, name: "read_file" }), "read_file");
});
test("all null → null (no invented headline)", () => {
  assert.equal(activityHumanLabel({ title: null, summary: null, name: null }), null);
});
test("whitespace-only title/summary/name is not a headline", () => {
  assert.equal(activityHumanLabel({ title: "  ", summary: "\n", name: "" }), null);
});

test("generic shell names prefer the command as the row caption", () => {
  assert.equal(isGenericToolName("run_terminal_command"), true);
  assert.equal(isGenericToolName("write"), false);
  const fromCommand = toolRowCaption({
    name: "run_terminal_command",
    title: "Execute `node --test src/ComposerPane.test.tsx`",
    summary: "Execute `node --test src/ComposerPane.test.tsx`",
    command: "cd apps/shell; node --test src/ComposerPane.test.tsx",
  });
  assert.equal(fromCommand.name, "cd apps/shell; node --test src/ComposerPane.test.tsx");
  assert.equal(fromCommand.summary, "");
  assert.equal(fromCommand.plain, true);
  const fromExecute = toolRowCaption({
    name: "run terminal command",
    title: "Execute `node --import tsx --test src/ComposerPane.test.tsx`",
    command: null,
  });
  assert.equal(fromExecute.name, "node --import tsx --test src/ComposerPane.test.tsx");
  assert.equal(fromExecute.plain, true);
  const write = toolRowCaption({
    name: "write",
    title: "docs/dogfood/NEXT.md",
    summary: "docs/dogfood/NEXT.md",
    command: null,
  });
  assert.equal(write.name, "write");
  assert.equal(write.summary, "docs/dogfood/NEXT.md");
  assert.equal(write.plain, false);
});

test("vendor session plan.md write row is session plan.md, not the encoded path", () => {
  const row = toolRowCaption({
    name: "write",
    title: "C:\\Users\\rodri\\.grok\\sessions\\CK3A%5CDev%5Cgrokforge\\sid\\plan.md",
    summary: "C:\\Users\\rodri\\.grok\\sessions\\CK3A%5CDev%5Cgrokforge\\sid\\plan.md",
    command: null,
  });
  assert.equal(row.name, "write");
  assert.equal(row.summary, "session plan.md");
});

test("Grok TUI output-fetch is a Forge-unavailable vendor tool", () => {
  assert.equal(isForgeUnavailableVendorTool("get_command_or_subagent_output"), true);
  assert.equal(isForgeUnavailableVendorTool("get command or subagent output"), true);
  assert.equal(isForgeUnavailableVendorTool("run_terminal_command"), false);
});
