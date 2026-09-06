import assert from "node:assert/strict";
import test from "node:test";
import { nextToastsAfterPush, pauseToastSupersedes, toastDotClass } from "./Toast.js";

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

test("a needs-you toast carries its Jump action through the stack unchanged", () => {
  const onClick = () => undefined;
  const next = nextToastsAfterPush([], {
    id: "1",
    message: "Sidebar tree · sessions v2 needs you",
    kind: "needs",
    action: { label: "Jump", onClick },
  });
  assert.equal(next.length, 1);
  assert.equal(next[0]!.kind, "needs");
  assert.equal(next[0]!.action?.label, "Jump");
  assert.equal(next[0]!.action?.onClick, onClick);
});

test("a plain toast carries no action", () => {
  const next = nextToastsAfterPush([], { id: "1", message: "Diff accepted", kind: "success" });
  assert.equal(next[0]!.action, undefined);
});

test("amber is reserved for needs-you: dot class maps 1:1 with kind", () => {
  assert.equal(toastDotClass("needs"), "needs");
  assert.equal(toastDotClass("success"), "ok");
  assert.equal(toastDotClass("error"), "fail");
  assert.equal(toastDotClass("info"), "done");
});
