import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { EditJournal } from "./edit-journal.js";

function hash(body: string) {
  return crypto.createHash("sha256").update(body).digest("hex");
}

test("host delete revert restores when absent; conflicts when path exists again including identical bytes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "host-ej-del-"));
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

test("host rename revert success and conflict when source reappeared", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "host-ej-ren-"));
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

test("legacy content revert still hash-guards when kind is omitted", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "host-ej-legacy-"));
  const journal = new EditJournal(root);
  const target = path.join(root, "workspace", "c.txt");
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, "after", "utf8");
  await journal.prepare({
    editId: "c1",
    workspace: path.dirname(target),
    target,
    before: "before",
    beforeHash: hash("before"),
    afterHash: hash("after"),
    diff: "-before\n+after",
    runId: "r",
    invocationId: "i",
    policy: "review",
  });
  await journal.markApplied("c1");
  const ok = await journal.revert("c1", { runId: "r" });
  assert.equal(ok.ok, true);
  assert.equal(await fs.readFile(target, "utf8"), "before");
});
