import test from "node:test";
import assert from "node:assert/strict";
import { mergeState, type PublicState } from "../lib/api";
import { projectPlanArm, PLAN_ARM_BLOCKED_UNVOUCHED } from "./planArm";

const base = {
  mode: "code" as const,
  workspace: "C:/w",
  connected: true,
  busyOther: false,
};

test("missing planEngagement projects blocked_unvouched — never silent execute", () => {
  assert.equal(
    projectPlanArm({
      ...base,
      planEngagement: undefined,
    }).state,
    "blocked_unvouched",
  );
});

test("mergeState does not invent planEngagement when omitted", () => {
  const held = { planEngagement: { engaged: true, vouched: true } } as PublicState;
  const incoming = { connected: true } as PublicState;
  const merged = mergeState(held, incoming);
  assert.deepEqual(merged.planEngagement, { engaged: true, vouched: true });
});

test("Chat → absent_chat", () => {
  assert.equal(
    projectPlanArm({
      mode: "chat",
      workspace: "C:/w",
      connected: true,
      planEngagement: { engaged: false, vouched: true },
      busyOther: false,
    }).state,
    "absent_chat",
  );
});

test("Code default / armed", () => {
  assert.deepEqual(
    projectPlanArm({
      ...base,
      planEngagement: { engaged: false, vouched: true },
    }),
    { state: "default", engaged: false, vouched: true },
  );
  assert.deepEqual(
    projectPlanArm({
      ...base,
      planEngagement: { engaged: true, vouched: true },
    }),
    { state: "armed", engaged: true, vouched: true },
  );
});

test("vouched false OR missing → blocked_unvouched", () => {
  assert.equal(
    projectPlanArm({
      ...base,
      planEngagement: { engaged: true, vouched: false },
    }).state,
    "blocked_unvouched",
  );
  assert.equal(
    projectPlanArm({
      ...base,
      planEngagement: undefined,
    }).state,
    "blocked_unvouched",
  );
  assert.equal(PLAN_ARM_BLOCKED_UNVOUCHED, "Can’t confirm Plan engagement. Send is blocked — not switched to ordinary Code.");
});

test("offline distinct from blocked_unvouched", () => {
  assert.equal(
    projectPlanArm({
      ...base,
      connected: false,
      planEngagement: undefined,
    }).state,
    "offline",
  );
  assert.equal(
    projectPlanArm({
      ...base,
      connected: false,
      planEngagement: { engaged: false, vouched: false },
    }).state,
    "offline",
  );
  assert.notEqual(
    projectPlanArm({
      ...base,
      connected: false,
      planEngagement: { engaged: false, vouched: false },
    }).state,
    "blocked_unvouched",
  );
});

test("disabled_no_workspace", () => {
  assert.equal(
    projectPlanArm({
      mode: "code",
      workspace: null,
      connected: true,
      planEngagement: { engaged: false, vouched: true },
      busyOther: false,
    }).state,
    "disabled_no_workspace",
  );
});

test("disabled_busy_other", () => {
  assert.equal(
    projectPlanArm({
      ...base,
      planEngagement: { engaged: false, vouched: true },
      busyOther: true,
    }).state,
    "disabled_busy_other",
  );
});

test("arm error is distinct from offline and unvouched", () => {
  const projected = projectPlanArm({
    ...base,
    planEngagement: { engaged: false, vouched: true },
    armError: "Couldn’t turn Plan on. Execute remains active.",
  });
  assert.equal(projected.state, "error");
  if (projected.state === "error") {
    assert.equal(projected.message, "Couldn’t turn Plan on. Execute remains active.");
  }
});
