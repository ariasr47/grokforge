import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ABSENT_FOR_NON_CODE_OR_NON_VENDOR,
  applyMcpMember,
  clearToAbsent,
  enterHydrating,
  foldMembersFromUpdates,
  markObtainFailed,
  markReady,
  memberFromUpdate,
  parseCompleteMcpFrame,
  type McpServerMember,
  type McpServersMembershipFact,
} from "./mcpServers.js";

describe("mcpServers dispositions", () => {
  it("Chat / non-vendor starts absent_for_non_code_or_non_vendor with null members", () => {
    assert.deepEqual(ABSENT_FOR_NON_CODE_OR_NON_VENDOR, {
      disposition: "absent_for_non_code_or_non_vendor",
      members: null,
    });
  });

  it("Code+vendor catch-up → hydrating; keeps last-ready members", () => {
    const ready = markReady(ABSENT_FOR_NON_CODE_OR_NON_VENDOR, [
      {
        serverId: "s1",
        name: "Docs",
        status: "connected",
        restore: "restored",
        firstEventSeq: 3,
      },
    ]);
    const next = enterHydrating(ready);
    assert.equal(next.disposition, "hydrating");
    assert.equal(next.members?.length, 1);
    assert.equal(next.members?.[0]?.serverId, "s1");
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
        serverId: "s1",
        name: "Docs",
        status: "idle",
        restore: "restored",
        firstEventSeq: 1,
      },
    ]);
    const next = markObtainFailed(ready);
    assert.equal(next.disposition, "obtain_failed");
    assert.equal(next.members?.length, 1);
    assert.equal(next.members?.[0]?.serverId, "s1");
  });

  it("obtain_failed with no prior members → null members", () => {
    const next = markObtainFailed(ABSENT_FOR_NON_CODE_OR_NON_VENDOR);
    assert.equal(next.disposition, "obtain_failed");
    assert.equal(next.members, null);
  });

  it("fallback / leave Code → absent_for_non_code_or_non_vendor", () => {
    const ready = markReady(ABSENT_FOR_NON_CODE_OR_NON_VENDOR, [
      {
        serverId: "s1",
        name: "Docs",
        status: "connected",
        restore: "restored",
        firstEventSeq: 1,
      },
    ]);
    assert.deepEqual(clearToAbsent(ready), ABSENT_FOR_NON_CODE_OR_NON_VENDOR);
  });
});

describe("mcpServers fold + restore", () => {
  it("merge by serverId; first frame may be error (no coerce to connected)", () => {
    const members = foldMembersFromUpdates([
      { serverId: "s1", name: null, status: "error", eventSeq: 1 },
      { serverId: "s1", name: "Docs", status: "connected", eventSeq: 2 },
    ]);
    assert.equal(members.length, 1);
    assert.equal(members[0]?.status, "connected");
    assert.equal(members[0]?.name, "Docs");
    assert.equal(members[0]?.firstEventSeq, 1);
  });

  it("mixed unrestorable stays listed beside restored peers", () => {
    const members = foldMembersFromUpdates([
      { serverId: "ok", name: "A", status: "idle", eventSeq: 1 },
      { serverId: "gone", name: null, status: null, eventSeq: 2, unrestorable: true },
    ]);
    assert.equal(members.length, 2);
    const u = members.find((m) => m.serverId === "gone");
    assert.equal(u?.restore, "unrestorable");
    assert.equal(u?.status, null);
    assert.equal(u?.name, null);
  });

  it("incomplete parse returns null", () => {
    assert.equal(parseCompleteMcpFrame({ serverId: "s1" }), null);
    assert.equal(parseCompleteMcpFrame({ status: "connected" }), null);
  });

  it("memberFromUpdate unrestorable withholds invented name/status", () => {
    const m = memberFromUpdate({
      serverId: "gone",
      name: "Nope",
      status: "error",
      eventSeq: 4,
      unrestorable: true,
    });
    assert.equal(m?.restore, "unrestorable");
    assert.equal(m?.name, null);
    assert.equal(m?.status, null);
  });

  it("applyMcpMember does not mint a second row for the same serverId", () => {
    const first: McpServerMember = {
      serverId: "s1",
      name: null,
      status: "error",
      restore: "restored",
      firstEventSeq: 1,
    };
    const next = applyMcpMember([first], {
      serverId: "s1",
      name: "Docs",
      status: "idle",
      restore: "restored",
      firstEventSeq: 9,
    });
    assert.equal(next.length, 1);
    assert.equal(next[0]?.status, "idle");
    assert.equal(next[0]?.firstEventSeq, 1);
  });
});
