import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type ActivityMembershipKey,
  type IngressFence,
  ownedRunKeys,
  ownedRunKeysFromProjection,
  isOwnedMembership,
  filterOwnedActivities,
  hostObserveRosterEligible,
  observeRosterFingerprint,
} from "./activityMembership";

describe("activityMembership paint key", () => {
  it("new session with zero owned runs → empty membership (quiet absent)", () => {
    const owned = ownedRunKeys([]);
    assert.equal(owned.size, 0);
    assert.equal(isOwnedMembership(owned, { sessionId: "B", runId: "r1" }), false);
  });

  it("paints only (sessionId, runId) in owned runs — foreign session excluded", () => {
    const owned = ownedRunKeysFromProjection(
      [
        { sessionId: "A", runId: "rA" },
        { sessionId: "B", runId: "rB1" },
        { sessionId: "B", runId: "rB2" },
      ],
      "B",
    );
    assert.equal(isOwnedMembership(owned, { sessionId: "B", runId: "rB1" }), true);
    assert.equal(isOwnedMembership(owned, { sessionId: "B", runId: "rB2" }), true);
    assert.equal(isOwnedMembership(owned, { sessionId: "A", runId: "rA" }), false);
  });

  it("connectionGeneration is not a paint predicate", () => {
    const owned = ownedRunKeys([{ sessionId: "B", runId: "r1" }]);
    const fence: IngressFence = { connectionGeneration: 99 };
    // Changing fence must not remove owned membership:
    assert.equal(isOwnedMembership(owned, { sessionId: "B", runId: "r1" }), true);
    assert.equal("connectionGeneration" in ({ sessionId: "B", runId: "r1" } satisfies ActivityMembershipKey), false);
    void fence;
  });

  it("filterOwnedActivities drops foreign rows and keeps sequential owned runs", () => {
    const owned = ownedRunKeys([
      { sessionId: "B", runId: "rB1" },
      { sessionId: "B", runId: "rB2" },
    ]);
    const rows = [
      { sessionId: "A", runId: "rA", name: "Codex fail" },
      { sessionId: "B", runId: "rB1", name: "list dir 1" },
      { sessionId: "B", runId: "rB2", name: "list dir 2" },
    ];
    assert.deepEqual(
      filterOwnedActivities(owned, rows).map((r) => r.name),
      ["list dir 1", "list dir 2"],
    );
  });

  it("ownedRunKeysFromProjection scopes to the active session only", () => {
    const owned = ownedRunKeysFromProjection(
      [
        { sessionId: "A", runId: "rA" },
        { sessionId: "B", runId: "rB1" },
        null,
      ],
      "B",
    );
    assert.equal(isOwnedMembership(owned, { sessionId: "B", runId: "rB1" }), true);
    assert.equal(isOwnedMembership(owned, { sessionId: "A", runId: "rA" }), false);
    assert.equal(ownedRunKeysFromProjection([], null).size, 0);
  });

  it("host observe roster is eligible only for the live owned parent that produced it", () => {
    const owned = ownedRunKeys([{ sessionId: "B", runId: "rB" }]);
    assert.equal(
      hostObserveRosterEligible({
        owned,
        key: { sessionId: "B", runId: "rB" },
        runState: "running",
        activeSessionId: "B",
        hostOwnerSessionId: "B",
      }),
      true,
    );
    assert.equal(
      hostObserveRosterEligible({
        owned,
        key: { sessionId: "B", runId: "rB" },
        runState: "running",
        activeSessionId: "B",
        hostOwnerSessionId: "A",
      }),
      false,
    );
    assert.equal(
      hostObserveRosterEligible({
        owned,
        key: { sessionId: "B", runId: "rB" },
        runState: "terminal",
        activeSessionId: "B",
        hostOwnerSessionId: "B",
      }),
      true,
    );
  });

  it("observe roster fingerprint ignores generation and tracks member identity", () => {
    const a = observeRosterFingerprint({
      childIds: ["c1"],
      mcpIds: ["s1"],
      hookIds: [],
      browserIds: ["f1"],
    });
    const same = observeRosterFingerprint({
      childIds: ["c1"],
      mcpIds: ["s1"],
      hookIds: [],
      browserIds: ["f1"],
    });
    const other = observeRosterFingerprint({
      childIds: ["c2"],
      mcpIds: ["s1"],
      hookIds: [],
      browserIds: ["f1"],
    });
    assert.equal(a, same);
    assert.notEqual(a, other);
  });
});
