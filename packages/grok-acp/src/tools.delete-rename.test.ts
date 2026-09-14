// Delete/rename tools are grok-acp host tools, not a Forge undo engine.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  prepareDeleteEdit,
  prepareRenameEdit,
  applyPendingEdit,
  toolPermissionKind,
  TOOL_DEFINITIONS,
} from "./tools.js";

test("catalog exposes delete_file and rename_file", () => {
  const names = TOOL_DEFINITIONS.map((t) => t.function.name);
  assert.ok(names.includes("delete_file"));
  assert.ok(names.includes("rename_file"));
  assert.equal(toolPermissionKind("delete_file"), "write");
  assert.equal(toolPermissionKind("rename_file"), "write");
});

test("prepareDeleteEdit refuses directory and missing target", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "del-prep-"));
  try {
    await fs.mkdir(path.join(root, "dir"));
    await assert.rejects(
      () => prepareDeleteEdit(root, { path: "dir" }, "e-dir"),
      /non_regular_file|not a regular|directory/i,
    );
    await assert.rejects(
      () => prepareDeleteEdit(root, { path: "missing.txt" }, "e-miss"),
      /missing|ENOENT|not found/i,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("prepare+apply delete unlinks one regular text file", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "del-ok-"));
  try {
    await fs.writeFile(path.join(root, "a.txt"), "hello", "utf8");
    const edit = await prepareDeleteEdit(root, { path: "a.txt" }, "e1");
    assert.equal(edit.kind, "delete");
    assert.equal(edit.path, "a.txt");
    assert.equal(edit.previous, "hello");
    assert.equal(edit.diff, null);
    await applyPendingEdit(edit);
    assert.equal(await fs.stat(path.join(root, "a.txt")).then(() => true, () => false), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("prepare+apply rename moves one file; case-only allowed", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ren-ok-"));
  try {
    await fs.writeFile(path.join(root, "Old.txt"), "body", "utf8");
    const edit = await prepareRenameEdit(root, { fromPath: "Old.txt", toPath: "new.txt" }, "r1");
    assert.equal(edit.kind, "rename");
    assert.equal(edit.fromPath, "Old.txt");
    assert.equal(edit.toPath, "new.txt");
    await applyPendingEdit(edit);
    assert.equal(await fs.readFile(path.join(root, "new.txt"), "utf8"), "body");
    assert.equal(await fs.stat(path.join(root, "Old.txt")).then(() => true, () => false), false);

    await fs.writeFile(path.join(root, "Case.txt"), "c", "utf8");
    const caseEdit = await prepareRenameEdit(
      root,
      { fromPath: "Case.txt", toPath: "case.txt" },
      "r-case",
    );
    assert.equal(caseEdit.kind, "rename");
    await applyPendingEdit(caseEdit);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("prepareRenameEdit refuses dest exists (non-case-only)", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ren-dest-"));
  try {
    await fs.writeFile(path.join(root, "a.txt"), "a", "utf8");
    await fs.writeFile(path.join(root, "b.txt"), "b", "utf8");
    await assert.rejects(
      () => prepareRenameEdit(root, { fromPath: "a.txt", toPath: "b.txt" }, "r-dest"),
      /dest|exists/i,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
