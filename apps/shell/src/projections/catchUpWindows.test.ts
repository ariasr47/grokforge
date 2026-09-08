import test from "node:test";
import assert from "node:assert/strict";
import {
  appliedThroughLastEventSeq,
  catchUpForRun,
  closeCatchUp,
  failCatchUp,
  openCatchUp,
  settleCatchUpAfterRestore,
  shouldOpenCatchUp,
} from "./catchUpWindows";
import { CATCHUP_LOAD_FAILURE } from "./runChangeList";

test("only restore/reconnect/reload intents open a catch-up window", () => {
  assert.equal(shouldOpenCatchUp("boot_hydrate"), true);
  assert.equal(shouldOpenCatchUp("disconnect_restore"), true);
  assert.equal(shouldOpenCatchUp("explicit_reconnect"), true);
  assert.equal(shouldOpenCatchUp("health_poll"), false);
  assert.equal(shouldOpenCatchUp("admission"), false);
  assert.equal(shouldOpenCatchUp("live_ws"), false);
  assert.equal(shouldOpenCatchUp("cancel_reconcile"), false);
});

test("health-poll reconcile does not flip a closed window to open", () => {
  const map = { r1: { phase: "closed" as const } };
  assert.equal(shouldOpenCatchUp("health_poll"), false);
  assert.deepEqual(catchUpForRun(map, "r1"), { phase: "closed" });
});

test("open / close / fail mutate only the named run", () => {
  let map = openCatchUp({}, "r1");
  assert.deepEqual(catchUpForRun(map, "r1"), { phase: "open" });
  assert.deepEqual(catchUpForRun(map, "r2"), { phase: "closed" });
  map = failCatchUp(map, "r1");
  assert.deepEqual(catchUpForRun(map, "r1"), { phase: "failed", message: CATCHUP_LOAD_FAILURE });
  map = closeCatchUp(map, "r1");
  assert.deepEqual(catchUpForRun(map, "r1"), { phase: "closed" });
});

test("completeness requires projection lastEventSeq to reach the snapshot high-water", () => {
  assert.equal(appliedThroughLastEventSeq(3, 3), true);
  assert.equal(appliedThroughLastEventSeq(4, 3), true);
  assert.equal(appliedThroughLastEventSeq(2, 3), false);
});

test("successful restore must settle catch-up — lag still closes, never stays open", () => {
  assert.equal(settleCatchUpAfterRestore(3, 3), "close");
  assert.equal(settleCatchUpAfterRestore(4, 3), "close");
  assert.equal(settleCatchUpAfterRestore(2, 3), "close");
});
