import assert from "node:assert/strict";
import test from "node:test";
import {
  closeFirstSights,
  createLiveActivityRun,
  freezeDisconnected,
  mergeToolDetail,
  reduceToolRun,
  stampFirstSight,
} from "./activityRun.js";
import type { ToolRunEvent } from "../lib/api.js";

const pending = (id: string): ToolRunEvent => ({
  schemaVersion: 2, type: "tool_run", activityId: id, toolCallId: id,
  lifecycle: "pending", execution: null, status: "running", name: "read_file",
  input: { path: `${id}.md` }, summary: `${id}.md`, command: null, output: null,
  error: null, reasonCode: null, reason: null, shellDisplayName: null, detailAvailable: true,
});

test("activity run keys and first-sight ordering are monotonic", () => {
  const run = createLiveActivityRun(3, "activity-run:0");
  assert.equal(stampFirstSight(run, "tool:a")?.activityOrder, 0);
  assert.equal(stampFirstSight(run, "tool:a")?.activityOrder, 0);
  assert.equal(stampFirstSight(run, "permission:p")?.activityOrder, 1);
  closeFirstSights(run);
  assert.equal(stampFirstSight(run, "tool:new"), null);
  assert.equal(stampFirstSight(run, "tool:a")?.activityOrder, 0);
});

test("disconnect freezes before identity lookup and does not thaw", () => {
  const run = createLiveActivityRun(1, "activity-run:1");
  freezeDisconnected(run);
  assert.equal(stampFirstSight(run, "tool:a"), null);
  run.acceptingFirstSight = true;
  assert.equal(stampFirstSight(run, "tool:b"), null);
});

test("result-first terminal row is immutable while request enriches only blanks", () => {
  const run = createLiveActivityRun(1, "activity-run:1");
  const event = pending("a");
  const terminal: ToolRunEvent = { ...event, lifecycle: "terminal", execution: "executed", status: "succeeded", output: "ok" };
  const stamp = stampFirstSight(run, "tool:a")!;
  const first = reduceToolRun(null, terminal, stamp);
  assert.equal(first.kind, "append");
  if (first.kind !== "append") return;
  const enrich = reduceToolRun({ activity: first.event, ...stamp }, event, stamp);
  assert.equal(enrich.kind, "enrich");
  const merged = mergeToolDetail(first.event, { activityId: "a", toolCallId: "a", name: "read_file", input: event.input, summary: "a.md", command: null, shellDisplayName: null });
  assert.equal(merged.status, "succeeded");
  assert.equal(merged.output, "ok");
  assert.equal(merged.name, "read_file");
});
