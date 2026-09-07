import test from "node:test";
import assert from "node:assert/strict";
import type { CodeAgentFact, HookMember, HooksMembershipFact } from "../lib/api";
import {
  HOOKS_AVAILABLE_ANNOUNCE,
  HOOKS_FAILED,
  HOOKS_GENERIC_IDENTITY,
  HOOKS_HEADER,
  HOOKS_HELPER,
  HOOKS_LIVE_GROWING,
  HOOKS_LOADING,
  HOOKS_OFFLINE,
  HOOKS_RECONNECT_SHORT,
  HOOKS_STATUS_DONE,
  HOOKS_STATUS_FAILED,
  HOOKS_STATUS_IDLE,
  HOOKS_STATUS_RUNNING,
  HOOKS_TOOLTIP_DONE,
  HOOKS_TOOLTIP_FAILED,
  HOOKS_TOOLTIP_IDLE,
  HOOKS_TOOLTIP_RUNNING,
  HOOKS_UNAVAILABLE,
  projectHooks,
} from "./hooksProjection";

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

function member(overrides: Partial<HookMember> = {}): HookMember {
  return {
    hookId: "h1",
    name: "PreTool",
    status: "running",
    restore: "restored",
    firstEventSeq: 4,
    ...overrides,
  };
}

const runningPre = member();
const idleSession = member({
  hookId: "h2",
  name: "SessionStart",
  status: "idle",
  firstEventSeq: 2,
});
const donePost = member({
  hookId: "h3",
  name: "PostTool",
  status: "done",
  firstEventSeq: 9,
});
const failedAuth = member({
  hookId: "h4",
  name: "Auth",
  status: "failed",
  firstEventSeq: 11,
});
const unrestorableGone = member({
  hookId: "gone",
  name: "Should not paint",
  status: "failed",
  restore: "unrestorable",
  firstEventSeq: 5,
});

function readyFact(members: HookMember[]): HooksMembershipFact {
  return { disposition: "ready", members };
}

function base(overrides: Partial<Parameters<typeof projectHooks>[0]> = {}) {
  return projectHooks({
    mode: "code",
    codeAgent: vendor,
    hooks: readyFact([runningPre]),
    connected: true,
    parentTerminal: false,
    ownershipLost: false,
    runNonTerminal: true,
    ...overrides,
  });
}

test("locked copy strings match SPEC §4 exactly", () => {
  assert.equal(HOOKS_HEADER, "Hooks");
  assert.equal(HOOKS_LOADING, "Loading hooks…");
  assert.equal(HOOKS_FAILED, "Couldn't load hooks.");
  assert.equal(
    HOOKS_OFFLINE,
    "Forge is offline. Hooks recorded on this session so far are still shown. Reconnect to confirm later updates.",
  );
  assert.equal(HOOKS_RECONNECT_SHORT, "Reconnect to confirm hooks status.");
  assert.equal(HOOKS_LIVE_GROWING, "Updating as hooks appear…");
  assert.equal(
    HOOKS_HELPER,
    "Hooks and plugins Grok Code advertised on this session — Forge chrome, not a Forge hooks engine.",
  );
  assert.equal(HOOKS_AVAILABLE_ANNOUNCE, "Hooks available");
  assert.equal(HOOKS_STATUS_RUNNING, "Running");
  assert.equal(HOOKS_STATUS_IDLE, "Idle");
  assert.equal(HOOKS_STATUS_DONE, "Done");
  assert.equal(HOOKS_STATUS_FAILED, "Failed");
  assert.equal(HOOKS_UNAVAILABLE, "Unavailable");
  assert.equal(HOOKS_GENERIC_IDENTITY, "Hook");
  assert.equal(
    HOOKS_TOOLTIP_RUNNING,
    "Vendor-advertised hook is running. Permissions still settle in the action dock.",
  );
  assert.equal(
    HOOKS_TOOLTIP_IDLE,
    "Vendor-advertised hook is idle — advertised but not firing.",
  );
  assert.equal(HOOKS_TOOLTIP_DONE, "Vendor-advertised hook finished.");
  assert.equal(HOOKS_TOOLTIP_FAILED, "Vendor-advertised hook failed.");
});

test("banned Stuck / Status unconfirmed / Healthy / Connected / Error strings are not exported", () => {
  const locked = [
    HOOKS_HEADER,
    HOOKS_LOADING,
    HOOKS_FAILED,
    HOOKS_OFFLINE,
    HOOKS_RECONNECT_SHORT,
    HOOKS_LIVE_GROWING,
    HOOKS_HELPER,
    HOOKS_AVAILABLE_ANNOUNCE,
    HOOKS_STATUS_RUNNING,
    HOOKS_STATUS_IDLE,
    HOOKS_STATUS_DONE,
    HOOKS_STATUS_FAILED,
    HOOKS_UNAVAILABLE,
    HOOKS_GENERIC_IDENTITY,
    HOOKS_TOOLTIP_RUNNING,
    HOOKS_TOOLTIP_IDLE,
    HOOKS_TOOLTIP_DONE,
    HOOKS_TOOLTIP_FAILED,
  ];
  for (const s of locked) {
    assert.equal(/stuck/i.test(s), false, s);
    assert.equal(/status unconfirmed/i.test(s), false, s);
    assert.equal(/\bhealthy\b/i.test(s), false, s);
    assert.equal(/\bconnected\b/i.test(s), false, s);
    assert.equal(/\berror\b/i.test(s), false, s);
  }
});

test("projection function signature has no journalMembers parameter", () => {
  assert.equal(projectHooks.length, 1);
  assert.equal(/journalMembers/.test(projectHooks.toString()), false);
});

test("Chat / Mini-Grok / hard_fail → absent even with leftover members", () => {
  assert.equal(base({ mode: "chat" }).state, "absent");
  assert.equal(base({ codeAgent: fallback }).state, "absent");
  assert.equal(base({ codeAgent: hardFail }).state, "absent");
  assert.equal(base({ codeAgent: null }).state, "absent");
  assert.equal(
    projectHooks({
      mode: "code",
      codeAgent: fallback,
      hooks: { disposition: "absent_for_non_code_or_non_vendor", members: null },
      connected: true,
      parentTerminal: false,
      runNonTerminal: true,
    }).state,
    "absent",
  );
});

test("missing hooks fact → absent (never invent)", () => {
  assert.equal(base({ hooks: null }).state, "absent");
  assert.equal(base({ hooks: undefined }).state, "absent");
});

test("absent_for_non_code_or_non_vendor disposition → absent", () => {
  assert.equal(
    base({
      hooks: { disposition: "absent_for_non_code_or_non_vendor", members: null },
    }).state,
    "absent",
  );
});

test("ready + [] → absent (quiet, not empty inventory or load-error copy)", () => {
  const p = base({ hooks: readyFact([]) });
  assert.equal(p.state, "absent");
});

test("ready + null members → absent", () => {
  const p = base({ hooks: { disposition: "ready", members: null } });
  assert.equal(p.state, "absent");
});

test("ready ∧ Idle-only → section present; totalCount 1; Idle chip; not quiet empty", () => {
  const p = base({ hooks: readyFact([idleSession]) });
  assert.equal(p.state, "ready");
  if (p.state !== "ready") return;
  assert.equal(p.totalCount, 1);
  assert.equal(p.members.length, 1);
  assert.equal(p.members[0]!.status, "idle");
  assert.equal(p.members[0]!.showLiveRunningChip, false);
  assert.equal(p.idleCount, 1);
  assert.equal(p.runningCount, 0);
  assert.equal(p.doneCount, 0);
  assert.equal(p.failedCount, 0);
});

test("eligibility keys off vendor, not connected — offline still projects members", () => {
  const p = base({ connected: false });
  assert.equal(p.state, "ready");
  if (p.state !== "ready") return;
  assert.equal(p.members.length, 1);
  assert.equal(p.members[0]!.identityLabel, "PreTool");
  assert.equal(p.members[0]!.showLiveRunningChip, false);
  assert.equal(p.runningCount, 0);
  assert.equal(p.totalCount, 1);
  assert.equal(p.offlineCopy, HOOKS_OFFLINE);
  assert.equal(p.reconnectCopy, null);
});

test("hydrating → Loading copy; keeps prior members", () => {
  const p = base({
    hooks: { disposition: "hydrating", members: [idleSession, runningPre] },
  });
  assert.equal(p.state, "loading");
  if (p.state !== "loading") return;
  assert.equal(p.sectionCopy, HOOKS_LOADING);
  assert.equal(p.reconnectCopy, null);
  assert.ok(p.members);
  assert.equal(p.members!.length, 2);
  assert.deepEqual(p.members!.map((m) => m.hookId), ["h2", "h1"]);
});

test("hydrating with no prior ready → loading + null members (not false empty)", () => {
  const p = base({
    hooks: { disposition: "hydrating", members: null },
  });
  assert.equal(p.state, "loading");
  if (p.state !== "loading") return;
  assert.equal(p.members, null);
  assert.equal(p.sectionCopy, HOOKS_LOADING);
});

test("hydrating with no members on a terminal run is absent, not Loading hooks", () => {
  const p = base({
    hooks: { disposition: "hydrating", members: null },
    parentTerminal: true,
    runNonTerminal: false,
  });
  assert.equal(p.state, "absent");
});

test("hydrating ∩ offline still uses Loading as section lead (not offline string)", () => {
  const p = base({
    hooks: { disposition: "hydrating", members: [runningPre] },
    connected: false,
  });
  assert.equal(p.state, "loading");
  if (p.state !== "loading") return;
  assert.equal(p.sectionCopy, HOOKS_LOADING);
  assert.equal(p.reconnectCopy, null);
  assert.equal(p.members![0]!.showLiveRunningChip, false);
  assert.notEqual(p.sectionCopy, HOOKS_OFFLINE);
  assert.notEqual(p.sectionCopy, HOOKS_RECONNECT_SHORT);
});

test("obtain_failed keep-visible members + Couldn't load (fail if wiped)", () => {
  const p = base({
    hooks: { disposition: "obtain_failed", members: [idleSession] },
  });
  assert.equal(p.state, "error");
  if (p.state !== "error") return;
  assert.equal(p.message, HOOKS_FAILED);
  assert.ok(p.members);
  assert.equal(p.members!.length, 1);
  assert.equal(p.members![0]!.hookId, "h2");
  assert.equal(p.members![0]!.identityLabel, "SessionStart");
  assert.equal(p.members![0]!.status, "idle");
});

test("obtain_failed with null members → error + null members", () => {
  const p = base({
    hooks: { disposition: "obtain_failed", members: null },
  });
  assert.equal(p.state, "error");
  if (p.state !== "error") return;
  assert.equal(p.message, HOOKS_FAILED);
  assert.equal(p.members, null);
});

test("live running with current voucher shows Running chip and counts in runningCount", () => {
  const p = base({});
  assert.equal(p.state, "ready");
  if (p.state !== "ready") return;
  assert.equal(p.members[0]!.showLiveRunningChip, true);
  assert.equal(p.members[0]!.status, "running");
  assert.equal(p.runningCount, 1);
  assert.equal(p.totalCount, 1);
  assert.equal(p.liveGrowing, true);
  assert.equal(p.offlineCopy, null);
  assert.equal(p.reconnectCopy, null);
});

test("name null → generic Hook identity, status still shown", () => {
  const p = base({
    hooks: readyFact([member({ name: null, status: "idle" })]),
  });
  assert.equal(p.state, "ready");
  if (p.state !== "ready") return;
  assert.equal(p.members[0]!.identityLabel, HOOKS_GENERIC_IDENTITY);
  assert.equal(p.members[0]!.status, "idle");
});

test("offline + three historical running → rows stay, no live chip, N does not collapse to 0", () => {
  const three = [
    member({ hookId: "a", name: "A", firstEventSeq: 1 }),
    member({ hookId: "b", name: "B", firstEventSeq: 2 }),
    member({ hookId: "c", name: "C", firstEventSeq: 3 }),
  ];
  const p = base({
    hooks: readyFact(three),
    connected: false,
    runNonTerminal: true,
  });
  assert.equal(p.state, "ready");
  if (p.state !== "ready") return;
  assert.equal(p.totalCount, 3);
  assert.equal(p.members.length, 3);
  assert.equal(p.runningCount, 0);
  assert.ok(p.members.every((m) => m.showLiveRunningChip === false));
  assert.ok(p.members.every((m) => m.status === "running"));
  assert.equal(p.offlineCopy, HOOKS_OFFLINE);
  assert.equal(p.reconnectCopy, null);
  assert.equal(p.liveGrowing, false);
});

test("parent terminal + connected → short reconnect copy; Idle/Done/Failed still chipped", () => {
  const p = base({
    hooks: readyFact([runningPre, idleSession, donePost, failedAuth]),
    connected: true,
    parentTerminal: true,
    runNonTerminal: false,
  });
  assert.equal(p.state, "ready");
  if (p.state !== "ready") return;
  assert.equal(p.reconnectCopy, HOOKS_RECONNECT_SHORT);
  assert.equal(p.offlineCopy, null);
  assert.equal(p.runningCount, 0);
  assert.equal(p.members.find((m) => m.status === "running")!.showLiveRunningChip, false);
  assert.equal(p.idleCount, 1);
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
  assert.equal(p.reconnectCopy, HOOKS_RECONNECT_SHORT);
});

test("withheld running → showLiveRunningChip false (no Running tooltip path)", () => {
  const p = base({ connected: false });
  assert.equal(p.state, "ready");
  if (p.state !== "ready") return;
  assert.equal(p.members[0]!.showLiveRunningChip, false);
  assert.equal(p.members[0]!.status, "running");
});

test("mixed unrestorable listed Unavailable ≠ Failed; included in totalCount not chip counts", () => {
  const p = base({
    hooks: readyFact([idleSession, unrestorableGone]),
  });
  assert.equal(p.state, "ready");
  if (p.state !== "ready") return;
  assert.equal(p.totalCount, 2);
  assert.equal(p.idleCount, 1);
  assert.equal(p.failedCount, 0);
  assert.equal(p.runningCount, 0);
  const gone = p.members.find((m) => m.hookId === "gone")!;
  assert.equal(gone.restore, "unrestorable");
  assert.equal(gone.identityLabel, HOOKS_GENERIC_IDENTITY);
  assert.equal(gone.status, null);
  assert.equal(gone.showLiveRunningChip, false);
  const restored = p.members.find((m) => m.hookId === "h2")!;
  assert.equal(restored.identityLabel, "SessionStart");
  assert.equal(restored.status, "idle");
});

test("Running ≠ Done chips both paint when statuses differ", () => {
  const p = base({
    hooks: readyFact([runningPre, donePost]),
  });
  assert.equal(p.state, "ready");
  if (p.state !== "ready") return;
  assert.equal(p.members.find((m) => m.hookId === "h1")!.status, "running");
  assert.equal(p.members.find((m) => m.hookId === "h1")!.showLiveRunningChip, true);
  assert.equal(p.members.find((m) => m.hookId === "h3")!.status, "done");
  assert.equal(p.members.find((m) => m.hookId === "h3")!.showLiveRunningChip, false);
  assert.equal(p.runningCount, 1);
  assert.equal(p.doneCount, 1);
  assert.equal(p.totalCount, 2);
});

test("multi-member preserves identities and firstEventSeq order", () => {
  const p = base({
    hooks: readyFact([runningPre, idleSession, donePost, failedAuth]),
  });
  assert.equal(p.state, "ready");
  if (p.state !== "ready") return;
  assert.deepEqual(p.members.map((m) => m.hookId), ["h2", "h1", "h3", "h4"]);
  assert.deepEqual(p.members.map((m) => m.identityLabel), ["SessionStart", "PreTool", "PostTool", "Auth"]);
  assert.equal(p.runningCount, 1);
  assert.equal(p.idleCount, 1);
  assert.equal(p.doneCount, 1);
  assert.equal(p.failedCount, 1);
  assert.equal(p.totalCount, 4);
});

test("incomplete members without hookId or status are withheld", () => {
  const p = base({
    hooks: readyFact([
      runningPre,
      member({ hookId: "", name: "Ghost" }),
      member({ hookId: "half", name: "Half", status: null, restore: "restored", firstEventSeq: 8 }),
    ]),
  });
  assert.equal(p.state, "ready");
  if (p.state !== "ready") return;
  assert.equal(p.members.length, 1);
  assert.equal(p.members[0]!.hookId, "h1");
});

test("paints hooks.members only — extra journalMembers field is ignored", () => {
  const hostOnly = member({ hookId: "host-1", name: "From host", firstEventSeq: 1 });
  const journalOnly = member({ hookId: "journal-1", name: "From journal", firstEventSeq: 2 });
  const p = projectHooks({
    mode: "code",
    codeAgent: vendor,
    hooks: readyFact([hostOnly]),
    connected: true,
    parentTerminal: false,
    runNonTerminal: true,
    journalMembers: [journalOnly],
  } as Parameters<typeof projectHooks>[0]);
  assert.equal(p.state, "ready");
  if (p.state !== "ready") return;
  assert.equal(p.members.length, 1);
  assert.equal(p.members[0]!.hookId, "host-1");
  assert.equal(p.members[0]!.identityLabel, "From host");
});

test("ready empty stays absent even if a journal-shaped extra field is present", () => {
  const p = projectHooks({
    mode: "code",
    codeAgent: vendor,
    hooks: readyFact([]),
    connected: true,
    parentTerminal: false,
    runNonTerminal: true,
    journalMembers: [runningPre],
  } as Parameters<typeof projectHooks>[0]);
  assert.equal(p.state, "absent");
});

test("status transition running→idle while voucher current → Idle chip only", () => {
  const p = base({
    hooks: readyFact([member({ status: "idle" })]),
  });
  assert.equal(p.state, "ready");
  if (p.state !== "ready") return;
  assert.equal(p.members[0]!.status, "idle");
  assert.equal(p.members[0]!.showLiveRunningChip, false);
  assert.equal(p.runningCount, 0);
  assert.equal(p.idleCount, 1);
});

test("first-frame idle / done / failed is legal (no force to running)", () => {
  const idle = base({ hooks: readyFact([idleSession]) });
  assert.equal(idle.state, "ready");
  if (idle.state === "ready") {
    assert.equal(idle.members[0]!.status, "idle");
    assert.equal(idle.members[0]!.showLiveRunningChip, false);
  }
  const done = base({ hooks: readyFact([donePost]) });
  assert.equal(done.state, "ready");
  if (done.state === "ready") {
    assert.equal(done.members[0]!.status, "done");
  }
  const failed = base({ hooks: readyFact([failedAuth]) });
  assert.equal(failed.state, "ready");
  if (failed.state === "ready") {
    assert.equal(failed.members[0]!.status, "failed");
  }
});

test("liveGrowing only while run non-terminal and current voucher exists", () => {
  const live = base({ runNonTerminal: true });
  const terminal = base({ runNonTerminal: false, parentTerminal: true });
  if (live.state === "ready") assert.equal(live.liveGrowing, true);
  if (terminal.state === "ready") assert.equal(terminal.liveGrowing, false);
});

test("no elapsed-timer status mutation helper is exported", async () => {
  const mod = await import("./hooksProjection.ts");
  for (const name of Object.keys(mod)) {
    assert.equal(/stuck|elapsed|timer|silence/i.test(name), false, name);
  }
});
