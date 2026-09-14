import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
// Write-diff is grok-acp host tool, not a Forge file editor.
import { prepareWriteEdit } from "./tools.js";

function plusMinus(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.replace(/\r\n/g, "\n").split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added += 1;
    else if (line.startsWith("-")) removed += 1;
  }
  return { added, removed };
}

test("write_file of an existing file with one insert is git-scale ±, not a whole-file rewrite", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "grok-write-diff-"));
  try {
    const beforeLines = Array.from({ length: 300 }, (_, i) => `line-${i}`);
    await fs.writeFile(path.join(root, "Gate.test.tsx"), `${beforeLines.join("\n")}\n`);
    const afterLines = [...beforeLines.slice(0, 248), "assert keep", ...beforeLines.slice(248)];
    const edit = await prepareWriteEdit(
      root,
      "write_file",
      { path: "Gate.test.tsx", content: `${afterLines.join("\n")}\n` },
      "e1",
    );
    assert.ok(edit.diff);
    const pm = plusMinus(edit.diff);
    assert.equal(pm.added, 1, `expected +1 −0, got +${pm.added} −${pm.removed}`);
    assert.equal(pm.removed, 0);
    assert.equal(edit.diff.includes("@@ -1,300 +1,301 @@"), false);
    assert.match(edit.diff, /\+assert keep/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("write_file one-line replacement on an existing file is +1 −1, not +N −N", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "grok-write-edit-"));
  try {
    const before = ["alpha", "bravo", "charlie", "delta", "echo"].join("\n");
    await fs.writeFile(path.join(root, "notes.md"), before);
    const edit = await prepareWriteEdit(
      root,
      "write_file",
      { path: "notes.md", content: ["alpha", "bravo", "CHARLIE", "delta", "echo"].join("\n") },
      "e2",
    );
    assert.ok(edit.diff);
    assert.deepEqual(plusMinus(edit.diff), { added: 1, removed: 1 });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("write_file that shares no lines keeps the raw rewrite ±", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "grok-write-rewrite-"));
  try {
    await fs.writeFile(path.join(root, "a.txt"), "a\nb\n");
    const edit = await prepareWriteEdit(
      root,
      "write_file",
      { path: "a.txt", content: "x\ny\n" },
      "e3",
    );
    assert.ok(edit.diff);
    assert.deepEqual(plusMinus(edit.diff), { added: 2, removed: 2 });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
