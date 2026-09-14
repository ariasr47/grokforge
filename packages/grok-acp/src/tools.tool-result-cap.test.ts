import test from "node:test";
import assert from "node:assert/strict";
import { capToolResultForContext } from "./tools.js";

test("a 24k read_file JSON keeps a late GitTab marker instead of slicing at 12k", () => {
  const marker = "function GitTab(";
  const content = `${"x".repeat(18_000)}\n${marker}\n${"y".repeat(4_000)}`;
  const toolResult = JSON.stringify({
    path: "apps/shell/src/dock/ChangesDock.tsx",
    bytes: content.length,
    truncated: false,
    content,
  });
  assert.ok(toolResult.length > 12_000, `fixture ${toolResult.length} should exceed the old 12k cap`);
  const capped = capToolResultForContext(toolResult);
  assert.doesNotMatch(capped, /truncated for context/);
  assert.match(capped, /function GitTab\(/);
  const parsed = JSON.parse(capped) as { content: string; truncated: boolean };
  assert.equal(parsed.truncated, false);
  assert.match(parsed.content, /function GitTab\(/);
});
