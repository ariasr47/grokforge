import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MutationCoordinator } from "./mutation-coordinator.js";

test("overlapping ACP-session edits serialize and stale base is rejected", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rar-overlap-"));
  const target = path.join(root, "shared.txt");
  await fs.writeFile(target, "base", "utf8");
  const a = new MutationCoordinator();
  const b = new MutationCoordinator();
  const base = await fs.readFile(target, "utf8");
  const baseHash = a.baseHash(base);
  const first = await a.acquire(target, "run-a");
  await fs.writeFile(target, "from-a", "utf8");
  first.release();
  const second = await b.acquire(target, "run-b");
  try {
    const current = await fs.readFile(target, "utf8");
    assert.notEqual(b.baseHash(current), baseHash, "the second session must observe the changed base");
    await assert.rejects(async () => {
      if (b.baseHash(current) !== baseHash) throw Object.assign(new Error("edit conflict"), { code: "edit_conflict" });
    }, (error: any) => error?.code === "edit_conflict");
    assert.equal(await fs.readFile(target, "utf8"), "from-a");
  } finally { second.release(); await fs.rm(root, { recursive: true, force: true }); }
});

test("disjoint ACP-session edits can settle independently", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rar-disjoint-"));
  const aPath = path.join(root, "a.txt"), bPath = path.join(root, "b.txt");
  await Promise.all([fs.writeFile(aPath, "a"), fs.writeFile(bPath, "b")]);
  const [a, b] = [new MutationCoordinator(), new MutationCoordinator()];
  const [la, lb] = await Promise.all([a.acquire(aPath, "a"), b.acquire(bPath, "b")]);
  try { await Promise.all([fs.writeFile(aPath, "aa"), fs.writeFile(bPath, "bb")]); assert.equal(await fs.readFile(aPath, "utf8"), "aa"); assert.equal(await fs.readFile(bPath, "utf8"), "bb"); }
  finally { la.release(); lb.release(); await fs.rm(root, { recursive: true, force: true }); }
});
