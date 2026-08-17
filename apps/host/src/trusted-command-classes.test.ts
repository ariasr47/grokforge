import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  TRUSTED_COMMAND_CLASS_CATALOG,
  TrustedCommandClassStore,
} from "./trusted-command-classes.js";

test("catalog is the closed v1 set", () => {
  assert.deepEqual(
    TRUSTED_COMMAND_CLASS_CATALOG.map((e) => e.id).sort(),
    ["cargo", "git:diff", "git:log", "git:show", "git:status", "npm", "npx"].sort(),
  );
});

test("missing store is empty happy path; unreadable/invalid fail closed; CAS and isolation", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tcc-store-"));
  const wsA = path.join(root, "a");
  const wsB = path.join(root, "b");
  await fs.mkdir(wsA);
  await fs.mkdir(wsB);
  const store = new TrustedCommandClassStore(path.join(root, "data"), () => "rev-1");

  const missing = await store.read(wsA);
  assert.equal(missing.source, "fallback");
  assert.equal(missing.fallbackReason, "missing");
  assert.deepEqual(missing.classes, []);
  assert.equal(missing.revision, "fallback");
  assert.equal(missing.savedForWorkspace, false);
  assert.ok(missing.catalog.length === 7);

  const saved = await store.save(wsA, ["npm", "cargo", "npm"], "fallback");
  assert.equal(saved.source, "saved");
  assert.deepEqual(saved.classes.slice().sort(), ["cargo", "npm"]);
  assert.equal(saved.revision, "rev-1");
  assert.equal(saved.fallbackReason, null);
  assert.equal(saved.savedForWorkspace, true);

  await assert.rejects(
    () => store.save(wsA, ["npm"], "stale"),
    (e: any) => e?.message === "class_revision_conflict" || e?.code === "class_revision_conflict",
  );
  assert.deepEqual((await store.read(wsA)).classes.slice().sort(), ["cargo", "npm"]);

  await assert.rejects(
    () => store.save(wsA, ["npm", "not-a-class"] as any, "rev-1"),
    (e: any) => /invalid_classes|invalid_request/.test(String(e?.message ?? e?.code ?? e)),
  );

  const b = await store.read(wsB);
  assert.deepEqual(b.classes, []);
  assert.equal(b.fallbackReason, "missing");

  // corrupt file → invalid
  const file = (store as any).file(saved.workspace) as string;
  await fs.writeFile(file, "{not-json", "utf8");
  const bad = await store.read(wsA);
  assert.deepEqual(bad.classes, []);
  assert.equal(bad.fallbackReason, "invalid");
  assert.equal(bad.source, "fallback");

  await fs.rm(root, { recursive: true, force: true });
});
