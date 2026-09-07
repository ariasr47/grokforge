import assert from "node:assert/strict";
import test from "node:test";
import {
  activityIsReadLike,
  activityIsVendorSessionPlan,
  activityLooksLikeWrite,
  quietActivityPath,
  VENDOR_SESSION_PLAN_CAPTION,
} from "./activityWriteLike";

test("read file / grep are not writes even with editId", () => {
  assert.equal(activityIsReadLike({ name: "read file" }), true);
  assert.equal(activityIsReadLike({ name: "read_file" }), true);
  assert.equal(activityLooksLikeWrite({ name: "read file", editId: "e1", kind: "edit" }), false);
  assert.equal(activityLooksLikeWrite({ name: "grep" }), false);
});

test("write / search_replace still count as writes", () => {
  assert.equal(activityLooksLikeWrite({ name: "write", editId: "e1" }), true);
  assert.equal(activityLooksLikeWrite({ name: "write_file" }), true);
  assert.equal(activityLooksLikeWrite({ name: "search_replace", editId: "e2" }), true);
});

test("vendor ~/.grok/sessions plan.md is a TUI plan file, not workspace File changes", () => {
  assert.equal(
    activityIsVendorSessionPlan({
      path: "C:\\Users\\rodri\\.grok\\sessions\\CK3A%5CDev%5Cgrokforge\\01a050c3\\plan.md",
    }),
    true,
  );
  assert.equal(activityIsVendorSessionPlan({ path: "docs/dogfood/plan.md" }), false);
  assert.equal(activityLooksLikeWrite({ name: "write", path: "C:\\Users\\x\\.grok\\sessions\\s\\plan.md" } as never), true);
  assert.equal(
    quietActivityPath("C:\\Users\\rodri\\.grok\\sessions\\CK3A%5CDev%5Cgrokforge\\sid\\plan.md"),
    VENDOR_SESSION_PLAN_CAPTION,
  );
  assert.equal(quietActivityPath("docs/dogfood/KEEP.md"), "docs/dogfood/KEEP.md");
});
