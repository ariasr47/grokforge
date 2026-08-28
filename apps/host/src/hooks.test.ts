import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ABSENT_FOR_NON_CODE_OR_NON_VENDOR,
  applyHookMember,
  clearToAbsent,
  enterHydrating,
  foldMembersFromUpdates,
  markObtainFailed,
  markReady,
  memberFromUpdate,
  parseCompleteHookFrame,
} from "./hooks.js";

describe("hooks dispositions", () => {
  it("Chat / non-vendor starts absent_for_non_code_or_non_vendor with null members", () => {
    assert.deepEqual(ABSENT_FOR_NON_CODE_OR_NON_VENDOR, {
      disposition: "absent_for_non_code_or_non_vendor",
      members: null,
    });
  });

  it("Code+vendor catch-up → hydrating; keeps last-ready members", () => {
    const ready = markReady(ABSENT_FOR_NON_CODE_OR_NON_VENDOR, [
      {
        hookId: "h1",
        name: "PreTool",
        status: "running",
        restore: "restored",
        firstEventSeq: 3,
      },
    ]);
    const next = enterHydrating(ready);
    assert.equal(next.disposition, "hydrating");
    assert.equal(next.members?.length, 1);
    assert.equal(next.members?.[0]?.hookId, "h1");
  });

  it("first hydrate with no prior ready → hydrating + null members", () => {
    const next = enterHydrating(ABSENT_FOR_NON_CODE_OR_NON_VENDOR);
    assert.equal(next.disposition, "hydrating");
    assert.equal(next.members, null);
  });

  it("ready empty → quiet empty list", () => {
    const next = markReady(enterHydrating(ABSENT_FOR_NON_CODE_OR_NON_VENDOR), []);
    assert.equal(next.disposition, "ready");
    assert.deepEqual(next.members, []);
  });

  it("obtain_failed keeps last-ready members (PM keep-visible)", () => {
    const ready = markReady(ABSENT_FOR_NON_CODE_OR_NON_VENDOR, [
      {
        hookId: "h1",
        name: "PreTool",
        status: "idle",
        restore: "restored",
        firstEventSeq: 1,
      },
    ]);
    const next = markObtainFailed(ready);
    assert.equal(next.disposition, "obtain_failed");
    assert.equal(next.members?.length, 1);
    assert.equal(next.members?.[0]?.hookId, "h1");
  });

  it("obtain_failed with no prior members → null members", () => {
    const next = markObtainFailed(ABSENT_FOR_NON_CODE_OR_NON_VENDOR);
    assert.equal(next.disposition, "obtain_failed");
    assert.equal(next.members, null);
  });
});

describe("hooks fold + restore", () => {
  it("merge by hookId; first frame may be done (no coerce to running)", () => {
    const members = foldMembersFromUpdates([
      { hookId: "h1", name: null, status: "done", eventSeq: 1 },
      { hookId: "h1", name: "PreTool", status: "running", eventSeq: 2 },
    ]);
    assert.equal(members.length, 1);
    assert.equal(members[0]?.status, "running");
    assert.equal(members[0]?.name, "PreTool");
    assert.equal(members[0]?.firstEventSeq, 1);
  });

  it("Running and Done stay distinct — no collapsed active/ran", () => {
    const members = foldMembersFromUpdates([
      { hookId: "a", name: "A", status: "running", eventSeq: 1 },
      { hookId: "b", name: "B", status: "done", eventSeq: 2 },
    ]);
    assert.equal(members.find((m) => m.hookId === "a")?.status, "running");
    assert.equal(members.find((m) => m.hookId === "b")?.status, "done");
  });

  it("Idle is a member status, not empty roster", () => {
    const members = foldMembersFromUpdates([
      { hookId: "h1", name: "PreTool", status: "idle", eventSeq: 1 },
    ]);
    assert.equal(members.length, 1);
    assert.equal(members[0]?.status, "idle");
  });

  it("mixed unrestorable stays listed beside restored peers", () => {
    const members = foldMembersFromUpdates([
      { hookId: "ok", name: "A", status: "idle", eventSeq: 1 },
      { hookId: "gone", name: null, status: null, eventSeq: 2, unrestorable: true },
    ]);
    assert.equal(members.length, 2);
    const u = members.find((m) => m.hookId === "gone");
    assert.equal(u?.restore, "unrestorable");
    assert.equal(u?.status, null);
    assert.equal(u?.name, null);
  });

  it("incomplete parse returns null", () => {
    assert.equal(parseCompleteHookFrame({ hookId: "h1" }), null);
    assert.equal(parseCompleteHookFrame({ status: "running" }), null);
  });

  it("clearToAbsent is absent_for_non_code_or_non_vendor", () => {
    const ready = markReady(ABSENT_FOR_NON_CODE_OR_NON_VENDOR, [
      { hookId: "h1", name: "PreTool", status: "idle", restore: "restored", firstEventSeq: 1 },
    ]);
    assert.deepEqual(clearToAbsent(ready), ABSENT_FOR_NON_CODE_OR_NON_VENDOR);
  });

  it("applyHookMember keeps firstEventSeq on merge", () => {
    const first = memberFromUpdate({ hookId: "h1", name: null, status: "idle", eventSeq: 4 });
    assert.ok(first);
    const next = applyHookMember([first], {
      hookId: "h1",
      name: "PreTool",
      status: "done",
      restore: "restored",
      firstEventSeq: 9,
    });
    assert.equal(next[0]?.firstEventSeq, 4);
    assert.equal(next[0]?.status, "done");
  });
});
