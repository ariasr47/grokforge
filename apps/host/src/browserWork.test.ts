import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ABSENT_FOR_NON_CODE_OR_NON_VENDOR,
  applyFetchMember,
  chipStatusFromActivity,
  clearToAbsent,
  enterHydrating,
  foldMembersFromActivities,
  markObtainFailed,
  markReady,
  memberFromFetchActivity,
} from "./browserWork.js";

describe("browserWork dispositions", () => {
  it("Chat / non-vendor starts absent_for_non_code_or_non_vendor with null members", () => {
    assert.deepEqual(ABSENT_FOR_NON_CODE_OR_NON_VENDOR, {
      disposition: "absent_for_non_code_or_non_vendor",
      members: null,
    });
  });

  it("Code+vendor catch-up → hydrating; keeps last-ready members", () => {
    const ready = markReady(ABSENT_FOR_NON_CODE_OR_NON_VENDOR, [
      {
        toolCallId: "t1",
        acpToolKind: "fetch",
        url: "https://example.com",
        title: "Example",
        status: "done",
        snapshotJournaled: false,
        restore: "restored",
        firstEventSeq: 3,
      },
    ]);
    const next = enterHydrating(ready);
    assert.equal(next.disposition, "hydrating");
    assert.equal(next.members?.length, 1);
    assert.equal(next.members?.[0]?.toolCallId, "t1");
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

  it("obtain_failed clears members", () => {
    const next = markObtainFailed(enterHydrating(ABSENT_FOR_NON_CODE_OR_NON_VENDOR));
    assert.equal(next.disposition, "obtain_failed");
    assert.equal(next.members, null);
  });

  it("fallback / hard_fail / leave Code → absent_for_non_code_or_non_vendor", () => {
    const ready = markReady(ABSENT_FOR_NON_CODE_OR_NON_VENDOR, [
      {
        toolCallId: "t1",
        acpToolKind: "fetch",
        url: null,
        title: null,
        status: "running",
        snapshotJournaled: false,
        restore: "restored",
        firstEventSeq: 1,
      },
    ]);
    assert.deepEqual(clearToAbsent(ready), ABSENT_FOR_NON_CODE_OR_NON_VENDOR);
  });
});

describe("browserWork fold + chip map", () => {
  it("chipStatusFromActivity maps ActivityRecord → Browser chips; rejects withhold", () => {
    assert.equal(chipStatusFromActivity("running"), "running");
    assert.equal(chipStatusFromActivity("succeeded"), "done");
    assert.equal(chipStatusFromActivity("failed"), "failed");
    assert.equal(chipStatusFromActivity("rejected"), null);
  });

  it("memberFromFetchActivity elevates only acpToolKind fetch + mappable status", () => {
    const ok = memberFromFetchActivity({
      toolCallId: "f1",
      acpToolKind: "fetch",
      status: "succeeded",
      execution: "executed",
      title: "Docs",
      url: "https://x.ai",
      snapshotJournaled: true,
      eventSeq: 4,
    });
    assert.equal(ok?.acpToolKind, "fetch");
    assert.equal(ok?.status, "done");
    assert.equal(ok?.snapshotJournaled, true);
    assert.equal(ok?.restore, "restored");

    assert.equal(
      memberFromFetchActivity({
        toolCallId: "f2",
        acpToolKind: "read",
        status: "running",
        execution: null,
        title: "Fetch https://evil.example",
        url: "https://evil.example",
        snapshotJournaled: false,
        eventSeq: 5,
      }),
      null,
    );

    assert.equal(
      memberFromFetchActivity({
        toolCallId: "f3",
        acpToolKind: "fetch",
        status: "rejected",
        execution: "not_executed",
        title: "Denied",
        url: null,
        snapshotJournaled: false,
        eventSeq: 6,
      }),
      null,
    );
  });

  it("merges by toolCallId; firstEventSeq preserved; first frame may be terminal", () => {
    const a = applyFetchMember([], {
      toolCallId: "f1",
      acpToolKind: "fetch",
      url: null,
      title: "Page",
      status: "done",
      snapshotJournaled: false,
      restore: "restored",
      firstEventSeq: 10,
    });
    assert.equal(a[0]!.status, "done");
    const b = applyFetchMember(a, {
      toolCallId: "f1",
      acpToolKind: "fetch",
      url: "https://example.com",
      title: "Page",
      status: "done",
      snapshotJournaled: true,
      restore: "restored",
      firstEventSeq: 12,
    });
    assert.equal(b.length, 1);
    assert.equal(b[0]!.firstEventSeq, 10);
    assert.equal(b[0]!.url, "https://example.com");
    assert.equal(b[0]!.snapshotJournaled, true);
  });

  it("unrestorable known member stays listed beside restored peers", () => {
    const folded = foldMembersFromActivities([
      {
        toolCallId: "ok",
        acpToolKind: "fetch",
        status: "succeeded",
        execution: "executed",
        title: "A",
        url: "https://a.example",
        snapshotJournaled: false,
        eventSeq: 1,
      },
      {
        toolCallId: "gone",
        acpToolKind: "fetch",
        status: "running",
        execution: null,
        title: null,
        url: null,
        snapshotJournaled: false,
        eventSeq: 2,
        unrestorable: true,
      },
    ]);
    assert.equal(folded.length, 2);
    assert.equal(folded[1]!.restore, "unrestorable");
    assert.equal(folded[1]!.status, null);
    assert.equal(folded[1]!.url, null);
    assert.equal(folded[1]!.title, null);
    assert.equal(folded[1]!.snapshotJournaled, false);
  });

  it("non-fetch and incomplete activities do not mint members", () => {
    const folded = foldMembersFromActivities([
      {
        toolCallId: "",
        acpToolKind: "fetch",
        status: "running",
        execution: null,
        title: null,
        url: null,
        snapshotJournaled: false,
        eventSeq: 1,
      },
      {
        toolCallId: "r1",
        acpToolKind: "read",
        status: "running",
        execution: null,
        title: "Read",
        url: null,
        snapshotJournaled: false,
        eventSeq: 2,
      },
    ]);
    assert.deepEqual(folded, []);
  });

  it("later rejected / not_executed withholds a previously elevated fetch identity", () => {
    const folded = foldMembersFromActivities([
      {
        toolCallId: "f1",
        acpToolKind: "fetch",
        status: "running",
        execution: null,
        title: "Docs",
        url: "https://docs.x.ai",
        snapshotJournaled: false,
        eventSeq: 1,
      },
      {
        toolCallId: "f1",
        acpToolKind: "fetch",
        status: "rejected",
        execution: "not_executed",
        title: "Docs",
        url: "https://docs.x.ai",
        snapshotJournaled: false,
        eventSeq: 2,
      },
    ]);
    assert.deepEqual(folded, []);
  });
});
