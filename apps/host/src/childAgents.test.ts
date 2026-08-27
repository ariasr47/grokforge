import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ABSENT_NON_CODE_OR_NON_VENDOR,
  applyChildUpdate,
  clearToAbsent,
  enterHydrating,
  foldMembersFromUpdates,
  markObtainFailed,
  markReady,
  parseCompleteChildAgentFrame,
  type ChildAgentMember,
  type ChildAgentsMembershipFact,
} from "./childAgents.js";

describe("childAgents dispositions", () => {
  it("Chat / non-vendor starts absent_non_code_or_non_vendor with null members", () => {
    assert.deepEqual(ABSENT_NON_CODE_OR_NON_VENDOR, {
      disposition: "absent_non_code_or_non_vendor",
      members: null,
    });
  });

  it("Code+vendor catch-up → hydrating; keeps last-ready members", () => {
    const ready = markReady(ABSENT_NON_CODE_OR_NON_VENDOR, [
      { childId: "c1", identityLabel: "Researcher", status: "done", firstEventSeq: 3 },
    ]);
    const next = enterHydrating(ready);
    assert.equal(next.disposition, "hydrating");
    assert.equal(next.members?.length, 1);
    assert.equal(next.members?.[0]?.childId, "c1");
  });

  it("first hydrate with no prior ready → hydrating + null members", () => {
    const next = enterHydrating(ABSENT_NON_CODE_OR_NON_VENDOR);
    assert.equal(next.disposition, "hydrating");
    assert.equal(next.members, null);
  });

  it("ready empty → quiet empty list", () => {
    const next = markReady(enterHydrating(ABSENT_NON_CODE_OR_NON_VENDOR), []);
    assert.equal(next.disposition, "ready");
    assert.deepEqual(next.members, []);
  });

  it("obtain_failed clears members", () => {
    const next = markObtainFailed(enterHydrating(ABSENT_NON_CODE_OR_NON_VENDOR));
    assert.equal(next.disposition, "obtain_failed");
    assert.equal(next.members, null);
  });

  it("fallback / hard_fail / leave Code → absent", () => {
    const ready = markReady(ABSENT_NON_CODE_OR_NON_VENDOR, [
      { childId: "c1", identityLabel: "X", status: "running", firstEventSeq: 1 },
    ]);
    assert.deepEqual(clearToAbsent(ready), ABSENT_NON_CODE_OR_NON_VENDOR);
  });
});

describe("childAgents fold + parse", () => {
  it("merges by childId; firstEventSeq preserved; status advances", () => {
    const a = applyChildUpdate([], {
      childId: "c1",
      identityLabel: "Worker",
      status: "running",
      eventSeq: 10,
    });
    const b = applyChildUpdate(a, {
      childId: "c1",
      identityLabel: "Worker",
      status: "done",
      eventSeq: 12,
    });
    assert.equal(b.length, 1);
    assert.equal(b[0]!.firstEventSeq, 10);
    assert.equal(b[0]!.status, "done");
  });

  it("first accepted frame may be done or failed (no force to running)", () => {
    const done = applyChildUpdate([], {
      childId: "c2",
      identityLabel: "Fast",
      status: "done",
      eventSeq: 1,
    });
    assert.equal(done[0]!.status, "done");
    const failed = applyChildUpdate([], {
      childId: "c3",
      identityLabel: "Boom",
      status: "failed",
      eventSeq: 1,
    });
    assert.equal(failed[0]!.status, "failed");
  });

  it("display order is firstEventSeq ascending across multiple children", () => {
    let m: ChildAgentMember[] = [];
    m = applyChildUpdate(m, { childId: "b", identityLabel: "B", status: "running", eventSeq: 5 });
    m = applyChildUpdate(m, { childId: "a", identityLabel: "A", status: "running", eventSeq: 2 });
    assert.deepEqual(m.map((x) => x.childId), ["a", "b"]);
  });

  it("parseCompleteChildAgentFrame accepts only complete closed-set members", () => {
    assert.deepEqual(
      parseCompleteChildAgentFrame({
        childId: "c1",
        identityLabel: "Researcher",
        status: "running",
      }),
      { childId: "c1", identityLabel: "Researcher", status: "running" },
    );
    assert.equal(parseCompleteChildAgentFrame({ childId: "c1", identityLabel: "", status: "running" }), null);
    assert.equal(parseCompleteChildAgentFrame({ childId: "c1", identityLabel: "X", status: "pending" }), null);
    assert.equal(parseCompleteChildAgentFrame({ childId: "", identityLabel: "X", status: "done" }), null);
  });

  it("foldMembersFromUpdates rebuilds from journal order", () => {
    const folded = foldMembersFromUpdates([
      { childId: "c1", identityLabel: "A", status: "running", eventSeq: 1 },
      { childId: "c2", identityLabel: "B", status: "failed", eventSeq: 2 },
      { childId: "c1", identityLabel: "A", status: "done", eventSeq: 3 },
    ]);
    assert.equal(folded.length, 2);
    assert.equal(folded[0]!.childId, "c1");
    assert.equal(folded[0]!.status, "done");
    assert.equal(folded[0]!.firstEventSeq, 1);
    assert.equal(folded[1]!.status, "failed");
  });
});
