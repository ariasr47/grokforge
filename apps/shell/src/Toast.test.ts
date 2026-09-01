import assert from "node:assert/strict";
import test from "node:test";
import { nextToastsAfterPush, pauseToastSupersedes } from "./Toast.js";

test("Stopped by you replaces Cancel requested so pause is one toast", () => {
  // Live desktop-pause-toasts: both toasts stacked over Export (toastCount 2, exportCoveredByToast true).
  assert.equal(pauseToastSupersedes("Cancel requested", "Stopped by you"), true);
  assert.equal(pauseToastSupersedes("Stopped by you", "Cancel requested"), false);
  const next = nextToastsAfterPush(
    [{ id: "1", message: "Cancel requested", kind: "info" }],
    { id: "2", message: "Stopped by you", kind: "info" },
  );
  assert.equal(next.length, 1);
  assert.equal(next[0]!.message, "Stopped by you");
});

test("unrelated toasts still stack", () => {
  const next = nextToastsAfterPush(
    [{ id: "1", message: "Workspace ready · grokforge", kind: "success" }],
    { id: "2", message: "Stopped by you", kind: "info" },
  );
  assert.equal(next.length, 2);
  assert.equal(next[0]!.message, "Workspace ready · grokforge");
  assert.equal(next[1]!.message, "Stopped by you");
});
