import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
// Edit-journal delete/rename is grok-acp recovery, not a Forge undo engine.
import { EditJournal } from "./edit-journal.js";

function hash(body: string) {
  return crypto.createHash("sha256").update(body).digest("hex");
}

test("delete revert restores when absent; conflicts when path exists again including identical bytes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ej-del-"));
  const journal = new EditJournal(root);
  const target = path.join(root, "workspace", "a.txt");
  await fs.mkdir(path.dirname(target), { recursive: true });
  await journal.prepare({
    editId: "d1",
    workspace: path.dirname(target),
    kind: "delete",
    target,
    before: "same",
    beforeHash: hash("same"),
    afterHash: null,
    diff: null,
    runId: "r",
    invocationId: "i",
    policy: "trusted_workspace",
  });
  await journal.markApplied("d1");
  const ok = await journal.revert("d1");
  assert.equal(ok.ok, true);
  assert.equal(await fs.readFile(target, "utf8"), "same");

  await fs.rm(target);
  await journal.prepare({
    editId: "d2",
    workspace: path.dirname(target),
    kind: "delete",
    target,
    before: "same",
    beforeHash: hash("same"),
    afterHash: null,
    diff: null,
    runId: "r",
    invocationId: "i",
    policy: "trusted_workspace",
  });
  await journal.markApplied("d2");
  await fs.writeFile(target, "same", "utf8");
  const conflict = await journal.revert("d2");
  assert.equal(conflict.ok, false);
  assert.equal(conflict.entry.status, "conflict");
  assert.equal(await fs.readFile(target, "utf8"), "same");
});

test("rename revert success and conflict when source reappeared", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ej-ren-"));
  const journal = new EditJournal(root);
  const workspace = path.join(root, "workspace");
  await fs.mkdir(workspace, { recursive: true });
  const fromAbs = path.join(workspace, "old.txt");
  const toAbs = path.join(workspace, "new.txt");
  await fs.writeFile(toAbs, "body", "utf8");
  await journal.prepare({
    editId: "r1",
    workspace,
    kind: "rename",
    target: toAbs,
    fromPath: fromAbs,
    toPath: toAbs,
    fromPathAbs: fromAbs,
    toPathAbs: toAbs,
    before: "body",
    beforeHash: hash("body"),
    afterHash: hash("body"),
    diff: null,
    runId: "r",
    invocationId: "i",
    policy: "trusted_workspace",
  });
  await journal.markApplied("r1");
  const ok = await journal.revert("r1");
  assert.equal(ok.ok, true);
  assert.equal(await fs.readFile(fromAbs, "utf8"), "body");
  assert.equal(await fs.stat(toAbs).then(() => true, () => false), false);

  await fs.writeFile(toAbs, "body", "utf8");
  await journal.prepare({
    editId: "r2",
    workspace,
    kind: "rename",
    target: toAbs,
    fromPath: fromAbs,
    toPath: toAbs,
    fromPathAbs: fromAbs,
    toPathAbs: toAbs,
    before: "body",
    beforeHash: hash("body"),
    afterHash: hash("body"),
    diff: null,
    runId: "r",
    invocationId: "i",
    policy: "trusted_workspace",
  });
  await journal.markApplied("r2");
  await fs.writeFile(fromAbs, "other", "utf8");
  const conflict = await journal.revert("r2");
  assert.equal(conflict.ok, false);
  assert.equal(conflict.entry.status, "conflict");
  assert.equal(await fs.readFile(toAbs, "utf8"), "body");
  assert.equal(await fs.readFile(fromAbs, "utf8"), "other");
});

test("rename revert conflicts when dest missing or dest hash mismatch", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ej-ren-miss-"));
  const journal = new EditJournal(root);
  const workspace = path.join(root, "workspace");
  await fs.mkdir(workspace, { recursive: true });
  const fromAbs = path.join(workspace, "src.txt");
  const toAbs = path.join(workspace, "dst.txt");
  await journal.prepare({
    editId: "r-miss",
    workspace,
    kind: "rename",
    fromPathAbs: fromAbs,
    toPathAbs: toAbs,
    before: "body",
    beforeHash: hash("body"),
    afterHash: hash("body"),
    diff: null,
    runId: "r",
    invocationId: "i",
    policy: "trusted_workspace",
  });
  await journal.markApplied("r-miss");
  const missing = await journal.revert("r-miss");
  assert.equal(missing.ok, false);
  assert.equal(missing.entry.status, "conflict");

  await fs.writeFile(toAbs, "changed", "utf8");
  await journal.prepare({
    editId: "r-hash",
    workspace,
    kind: "rename",
    fromPathAbs: fromAbs,
    toPathAbs: toAbs,
    before: "body",
    beforeHash: hash("body"),
    afterHash: hash("body"),
    diff: null,
    runId: "r",
    invocationId: "i",
    policy: "trusted_workspace",
  });
  await journal.markApplied("r-hash");
  const mismatch = await journal.revert("r-hash");
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.entry.status, "conflict");
  assert.equal(await fs.readFile(toAbs, "utf8"), "changed");
});
