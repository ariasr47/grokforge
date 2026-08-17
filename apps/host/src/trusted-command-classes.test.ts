import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  TRUSTED_COMMAND_CLASS_CATALOG,
  TrustedCommandClassStore,
} from "./trusted-command-classes.js";
import { activityRecordFromToolRun } from "./session.js";

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

test("journaled activity keeps command and list-auto eligibility on success", () => {
  const policy = {
    workspace: "C:\\ws",
    storedMode: "trusted_workspace" as const,
    effectiveMode: "trusted_workspace" as const,
    source: "saved" as const,
    revision: "r1",
    fallbackReason: null,
    snapshottedAt: "t",
  };
  const activity = activityRecordFromToolRun({
    type: "tool_run",
    schemaVersion: 2,
    activityId: "a1",
    toolCallId: "t1",
    lifecycle: "terminal",
    execution: "executed",
    status: "succeeded",
    name: "run_shell",
    input: { command: "npm test" },
    summary: null,
    command: "npm test",
    output: "ok",
    error: null,
    reasonCode: null,
    reason: null,
    shellDisplayName: "cmd",
    detailAvailable: true,
    automaticEligibility: "trusted_command_class",
    autoApplied: true,
  } as any, policy);
  assert.equal(activity.command, "npm test");
  assert.equal(activity.automaticEligibility, "trusted_command_class");
  assert.equal(activity.autoApplied, true);
  assert.equal(activity.execution, "executed");
});

test("journaled hard-negative activity keeps command without list provenance", () => {
  const policy = {
    workspace: "C:\\ws",
    storedMode: "trusted_workspace" as const,
    effectiveMode: "trusted_workspace" as const,
    source: "saved" as const,
    revision: "r1",
    fallbackReason: null,
    snapshottedAt: "t",
  };
  const activity = activityRecordFromToolRun({
    type: "tool_run",
    schemaVersion: 2,
    activityId: "a2",
    toolCallId: "t2",
    lifecycle: "terminal",
    execution: "not_executed",
    status: "rejected",
    name: "run_shell",
    input: { command: "ls" },
    summary: null,
    command: "ls",
    output: null,
    error: null,
    reasonCode: "leading_command_unresolved",
    reason: "missing",
    shellDisplayName: "cmd",
    detailAvailable: true,
    automaticEligibility: "not_eligible",
    autoApplied: false,
  } as any, policy);
  assert.equal(activity.command, "ls");
  assert.equal(activity.automaticEligibility, "not_eligible");
  assert.equal(activity.autoApplied, false);
  assert.equal(activity.execution, "not_executed");
});

test("non-shell journaled activity uses command null", () => {
  const policy = {
    workspace: "C:\\ws",
    storedMode: "review" as const,
    effectiveMode: "review" as const,
    source: "fallback" as const,
    revision: "fallback",
    fallbackReason: "missing" as const,
    snapshottedAt: "t",
  };
  const activity = activityRecordFromToolRun({
    type: "tool_run",
    schemaVersion: 2,
    activityId: "a3",
    toolCallId: "t3",
    lifecycle: "terminal",
    execution: "executed",
    status: "succeeded",
    name: "read_file",
    input: { path: "README.md" },
    summary: null,
    command: null,
    output: "ok",
    error: null,
    reasonCode: null,
    reason: null,
    shellDisplayName: null,
    detailAvailable: true,
    automaticEligibility: "read",
    autoApplied: true,
  } as any, policy);
  assert.equal(activity.command, null);
});
