import test from "node:test";
import assert from "node:assert/strict";
import type { ChildAgentMember, ChildAgentsMembershipFact, CodeAgentFact } from "./api";
import {
  CHILD_AGENTS_AVAILABLE_ANNOUNCE,
  CHILD_AGENTS_FAILED,
  CHILD_AGENTS_HEADER,
  CHILD_AGENTS_HELPER,
  CHILD_AGENTS_LIVE_GROWING,
  CHILD_AGENTS_LOADING,
  CHILD_AGENTS_OFFLINE,
  CHILD_AGENTS_RECONNECT_SHORT,
  CHILD_AGENTS_STATUS_DONE,
  CHILD_AGENTS_STATUS_FAILED,
  CHILD_AGENTS_STATUS_RUNNING,
  CHILD_AGENTS_TOOLTIP_DONE,
  CHILD_AGENTS_TOOLTIP_FAILED,
  CHILD_AGENTS_TOOLTIP_RUNNING,
  projectChildAgents,
} from "./childAgentsProjection";

const vendor: CodeAgentFact = {
  resolveStatus: "ready",
  identity: "vendor",
  fallbackReason: null,
};
const fallback: CodeAgentFact = {
  resolveStatus: "ready",
  identity: "fallback",
  fallbackReason: "cli_missing",
};
const hardFail: CodeAgentFact = {
  resolveStatus: "hard_fail",
  identity: "hard_fail",
  fallbackReason: null,
};

const researcher: ChildAgentMember = {
  childId: "c1",
  identityLabel: "Researcher",
  status: "running",
  firstEventSeq: 4,
};
const doneChild: ChildAgentMember = {
  childId: "c2",
  identityLabel: "Summarizer",
  status: "done",
  firstEventSeq: 2,
};
const failedChild: ChildAgentMember = {
  childId: "c3",
  identityLabel: "Boom",
  status: "failed",
  firstEventSeq: 9,
};

function readyFact(members: ChildAgentMember[]): ChildAgentsMembershipFact {
  return { disposition: "ready", members };
}

function base(overrides: Parameters<typeof projectChildAgents>[0] extends infer T ? Partial<T> : never) {
  return projectChildAgents({
    mode: "code",
    codeAgent: vendor,
    childAgents: readyFact([researcher]),
    journalMembers: [researcher],
    connected: true,
    parentTerminal: false,
    ownershipLost: false,
    runNonTerminal: true,
    ...overrides,
  });
}

test("locked copy strings match SPEC §4 exactly", () => {
  assert.equal(CHILD_AGENTS_HEADER, "Child agents");
  assert.equal(CHILD_AGENTS_LOADING, "Loading child agents…");
  assert.equal(CHILD_AGENTS_FAILED, "Couldn't load child agents.");
  assert.equal(
    CHILD_AGENTS_OFFLINE,
    "Forge is offline. Child agents recorded on this run so far are still shown. Reconnect to confirm later updates.",
  );
  assert.equal(CHILD_AGENTS_RECONNECT_SHORT, "Reconnect to confirm child agent status.");
  assert.equal(CHILD_AGENTS_LIVE_GROWING, "Updating as children appear…");
  assert.equal(CHILD_AGENTS_HELPER, "Children spawned by Grok Code on this run — not Forge workers.");
  assert.equal(CHILD_AGENTS_AVAILABLE_ANNOUNCE, "Child agents available");
  assert.equal(CHILD_AGENTS_STATUS_RUNNING, "Running");
  assert.equal(CHILD_AGENTS_STATUS_DONE, "Done");
  assert.equal(CHILD_AGENTS_STATUS_FAILED, "Failed");
  assert.equal(
    CHILD_AGENTS_TOOLTIP_RUNNING,
    "Vendor child agent is still working. Permissions still settle in the action dock.",
  );
  assert.equal(CHILD_AGENTS_TOOLTIP_DONE, "Vendor child agent finished.");
  assert.equal(CHILD_AGENTS_TOOLTIP_FAILED, "Vendor child agent failed.");
});

test("banned Stuck / Status unconfirmed strings are not exported", () => {
  const locked = [
    CHILD_AGENTS_HEADER,
    CHILD_AGENTS_LOADING,
    CHILD_AGENTS_FAILED,
    CHILD_AGENTS_OFFLINE,
    CHILD_AGENTS_RECONNECT_SHORT,
    CHILD_AGENTS_LIVE_GROWING,
    CHILD_AGENTS_HELPER,
    CHILD_AGENTS_AVAILABLE_ANNOUNCE,
    CHILD_AGENTS_STATUS_RUNNING,
    CHILD_AGENTS_STATUS_DONE,
    CHILD_AGENTS_STATUS_FAILED,
    CHILD_AGENTS_TOOLTIP_RUNNING,
    CHILD_AGENTS_TOOLTIP_DONE,
    CHILD_AGENTS_TOOLTIP_FAILED,
  ];
  for (const s of locked) {
    assert.equal(/stuck/i.test(s), false, s);
    assert.equal(/status unconfirmed/i.test(s), false, s);
  }
});

test("Chat / fallback / hard_fail → absent even with leftover journal members", () => {
  assert.equal(base({ mode: "chat" }).state, "absent");
  assert.equal(base({ codeAgent: fallback }).state, "absent");
  assert.equal(base({ codeAgent: hardFail }).state, "absent");
  assert.equal(base({ codeAgent: null }).state, "absent");
  assert.equal(
    projectChildAgents({
      mode: "code",
      codeAgent: fallback,
      childAgents: { disposition: "absent_non_code_or_non_vendor", members: null },
      journalMembers: [researcher],
      connected: true,
      parentTerminal: false,
      runNonTerminal: true,
    }).state,
    "absent",
  );
});

test("missing childAgents fact → absent (never invent)", () => {
  assert.equal(base({ childAgents: null }).state, "absent");
  assert.equal(base({ childAgents: undefined }).state, "absent");
});

test("absent_non_code_or_non_vendor disposition → absent", () => {
  assert.equal(
    base({
      childAgents: { disposition: "absent_non_code_or_non_vendor", members: null },
    }).state,
    "absent",
  );
});

test("ready + [] → absent (quiet, not empty inventory copy)", () => {
  const p = base({
    childAgents: readyFact([]),
    journalMembers: [],
  });
  assert.equal(p.state, "absent");
});

test("eligibility keys off vendor, not connected — offline still projects members", () => {
  const p = base({ connected: false });
  assert.equal(p.state, "ready");
  if (p.state !== "ready") return;
  assert.equal(p.members.length, 1);
  assert.equal(p.members[0]!.identityLabel, "Researcher");
  assert.equal(p.members[0]!.showLiveRunningChip, false);
  assert.equal(p.runningCount, 0);
  assert.equal(p.offlineCopy, CHILD_AGENTS_OFFLINE);
});

test("hydrating → Loading copy; keeps prior members", () => {
  const p = base({
    childAgents: { disposition: "hydrating", members: [doneChild, researcher] },
    journalMembers: null,
  });
  assert.equal(p.state, "loading");
  if (p.state !== "loading") return;
  assert.ok(p.members);
  assert.equal(p.members!.length, 2);
  assert.deepEqual(p.members!.map((m) => m.childId), ["c2", "c1"]);
});

test("hydrating with no prior ready → loading + null members (not false empty)", () => {
  const p = base({
    childAgents: { disposition: "hydrating", members: null },
    journalMembers: [],
  });
  assert.equal(p.state, "loading");
  if (p.state !== "loading") return;
  assert.equal(p.members, null);
});

test("obtain_failed → Couldn't load copy", () => {
  const p = base({
    childAgents: { disposition: "obtain_failed", members: null },
    journalMembers: [researcher],
  });
  assert.equal(p.state, "error");
  if (p.state !== "error") return;
  assert.equal(p.message, CHILD_AGENTS_FAILED);
});

test("live running with current voucher shows Running chip and counts in runningCount", () => {
  const p = base({});
  assert.equal(p.state, "ready");
  if (p.state !== "ready") return;
  assert.equal(p.members[0]!.showLiveRunningChip, true);
  assert.equal(p.members[0]!.status, "running");
  assert.equal(p.runningCount, 1);
  assert.equal(p.liveGrowing, true);
  assert.equal(p.offlineCopy, null);
  assert.equal(p.reconnectCopy, null);
});

test("offline + journaled running → historical row, no live chip, runningCount 0", () => {
  const p = base({
    childAgents: readyFact([researcher, doneChild]),
    journalMembers: [researcher, doneChild],
    connected: false,
    runNonTerminal: true,
  });
  assert.equal(p.state, "ready");
  if (p.state !== "ready") return;
  const running = p.members.find((m) => m.status === "running")!;
  const done = p.members.find((m) => m.status === "done")!;
  assert.equal(running.showLiveRunningChip, false);
  assert.equal(done.showLiveRunningChip, false);
  assert.equal(p.runningCount, 0);
  assert.equal(p.doneCount, 1);
  assert.equal(p.offlineCopy, CHILD_AGENTS_OFFLINE);
  assert.equal(p.reconnectCopy, null);
  assert.equal(p.liveGrowing, false);
});

test("parent terminal + connected → short reconnect copy; Done/Failed still chipped", () => {
  const p = base({
    childAgents: readyFact([researcher, doneChild, failedChild]),
    journalMembers: [researcher, doneChild, failedChild],
    connected: true,
    parentTerminal: true,
    runNonTerminal: false,
  });
  assert.equal(p.state, "ready");
  if (p.state !== "ready") return;
  assert.equal(p.reconnectCopy, CHILD_AGENTS_RECONNECT_SHORT);
  assert.equal(p.offlineCopy, null);
  assert.equal(p.runningCount, 0);
  assert.equal(p.members.find((m) => m.status === "running")!.showLiveRunningChip, false);
  assert.equal(p.doneCount, 1);
  assert.equal(p.failedCount, 1);
  assert.equal(p.liveGrowing, false);
});

test("ownership loss withholds live Running even while connected", () => {
  const p = base({ ownershipLost: true });
  assert.equal(p.state, "ready");
  if (p.state !== "ready") return;
  assert.equal(p.members[0]!.showLiveRunningChip, false);
  assert.equal(p.runningCount, 0);
  assert.equal(p.reconnectCopy, CHILD_AGENTS_RECONNECT_SHORT);
});

test("status transition running→done while voucher current → Done chip only", () => {
  const p = base({
    childAgents: readyFact([{ ...researcher, status: "done" }]),
    journalMembers: [{ ...researcher, status: "done" }],
  });
  assert.equal(p.state, "ready");
  if (p.state !== "ready") return;
  assert.equal(p.members[0]!.status, "done");
  assert.equal(p.members[0]!.showLiveRunningChip, false);
  assert.equal(p.runningCount, 0);
  assert.equal(p.doneCount, 1);
});

test("first-frame done / failed is legal (no force to running)", () => {
  const done = base({
    childAgents: readyFact([doneChild]),
    journalMembers: [doneChild],
  });
  assert.equal(done.state, "ready");
  if (done.state === "ready") {
    assert.equal(done.members[0]!.status, "done");
    assert.equal(done.members[0]!.showLiveRunningChip, false);
  }
  const failed = base({
    childAgents: readyFact([failedChild]),
    journalMembers: [failedChild],
  });
  assert.equal(failed.state, "ready");
  if (failed.state === "ready") {
    assert.equal(failed.members[0]!.status, "failed");
  }
});

test("multi-child preserves identities and firstEventSeq order", () => {
  const p = base({
    childAgents: readyFact([researcher, doneChild, failedChild]),
    journalMembers: [researcher, doneChild, failedChild],
  });
  assert.equal(p.state, "ready");
  if (p.state !== "ready") return;
  assert.deepEqual(p.members.map((m) => m.childId), ["c2", "c1", "c3"]);
  assert.deepEqual(p.members.map((m) => m.identityLabel), ["Summarizer", "Researcher", "Boom"]);
  assert.equal(p.runningCount, 1);
  assert.equal(p.doneCount, 1);
  assert.equal(p.failedCount, 1);
});

test("incomplete members are withheld (no identity-without-status)", () => {
  const p = base({
    childAgents: readyFact([
      researcher,
      { childId: "", identityLabel: "Ghost", status: "running", firstEventSeq: 1 },
      { childId: "x", identityLabel: "", status: "running", firstEventSeq: 2 },
    ]),
    journalMembers: [researcher],
  });
  assert.equal(p.state, "ready");
  if (p.state !== "ready") return;
  assert.equal(p.members.length, 1);
  assert.equal(p.members[0]!.childId, "c1");
});

test("ready prefers journal members when host list is empty but journal has vouched rows", () => {
  const p = base({
    childAgents: readyFact([]),
    journalMembers: [researcher],
  });
  assert.equal(p.state, "ready");
  if (p.state !== "ready") return;
  assert.equal(p.members[0]!.identityLabel, "Researcher");
});

test("hydrating prefers journal fold over last-ready when journal has members", () => {
  const p = base({
    childAgents: { disposition: "hydrating", members: [doneChild] },
    journalMembers: [researcher, doneChild],
  });
  assert.equal(p.state, "loading");
  if (p.state !== "loading") return;
  assert.equal(p.members!.length, 2);
  assert.equal(p.members![1]!.status, "running");
});
