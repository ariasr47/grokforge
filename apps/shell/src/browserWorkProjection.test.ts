import test from "node:test";
import assert from "node:assert/strict";
import type { BrowserWorkMember, BrowserWorkMembershipFact, CodeAgentFact } from "./api";
import {
  BROWSER_AVAILABLE_ANNOUNCE,
  BROWSER_FAILED,
  BROWSER_GENERIC_IDENTITY,
  BROWSER_HEADER,
  BROWSER_HELPER,
  BROWSER_LIVE_GROWING,
  BROWSER_LOADING,
  BROWSER_OFFLINE,
  BROWSER_RECONNECT_SHORT,
  BROWSER_SNAPSHOT,
  BROWSER_SNAPSHOT_MUTED,
  BROWSER_STATUS_DONE,
  BROWSER_STATUS_FAILED,
  BROWSER_STATUS_RUNNING,
  BROWSER_TOOLTIP_DONE,
  BROWSER_TOOLTIP_FAILED,
  BROWSER_TOOLTIP_RUNNING,
  BROWSER_TOOLTIP_SNAPSHOT,
  BROWSER_UNAVAILABLE,
  projectBrowserWork,
} from "./browserWorkProjection";

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

function member(overrides: Partial<BrowserWorkMember> = {}): BrowserWorkMember {
  return {
    toolCallId: "f1",
    acpToolKind: "fetch",
    url: "https://docs.x.ai",
    title: "Docs",
    status: "running",
    snapshotJournaled: false,
    restore: "restored",
    firstEventSeq: 4,
    ...overrides,
  };
}

const runningFetch = member();
const doneFetch = member({
  toolCallId: "f2",
  url: "https://a.example",
  title: "A",
  status: "done",
  firstEventSeq: 2,
});
const failedFetch = member({
  toolCallId: "f3",
  url: null,
  title: "Boom",
  status: "failed",
  firstEventSeq: 9,
});
const unrestorableFetch = member({
  toolCallId: "gone",
  url: "https://should-not-paint.example",
  title: "Should not paint",
  status: "failed",
  snapshotJournaled: true,
  restore: "unrestorable",
  firstEventSeq: 5,
});

function readyFact(members: BrowserWorkMember[]): BrowserWorkMembershipFact {
  return { disposition: "ready", members };
}

function base(overrides: Partial<Parameters<typeof projectBrowserWork>[0]> = {}) {
  return projectBrowserWork({
    mode: "code",
    codeAgent: vendor,
    browserWork: readyFact([runningFetch]),
    connected: true,
    parentTerminal: false,
    ownershipLost: false,
    runNonTerminal: true,
    ...overrides,
  });
}

test("locked copy strings match SPEC §4 exactly", () => {
  assert.equal(BROWSER_HEADER, "Browser");
  assert.equal(BROWSER_LOADING, "Loading browser work…");
  assert.equal(BROWSER_FAILED, "Couldn't load browser work.");
  assert.equal(
    BROWSER_OFFLINE,
    "Forge is offline. Browser work recorded on this run so far is still shown. Reconnect to confirm later updates.",
  );
  assert.equal(BROWSER_RECONNECT_SHORT, "Reconnect to confirm browser status.");
  assert.equal(BROWSER_LIVE_GROWING, "Updating as browser work appears…");
  assert.equal(
    BROWSER_HELPER,
    "Vendor browser / web-fetch on this run — Forge chrome, not a second Chrome.",
  );
  assert.equal(BROWSER_AVAILABLE_ANNOUNCE, "Browser work available");
  assert.equal(BROWSER_STATUS_RUNNING, "Running");
  assert.equal(BROWSER_STATUS_DONE, "Done");
  assert.equal(BROWSER_STATUS_FAILED, "Failed");
  assert.equal(BROWSER_UNAVAILABLE, "Unavailable");
  assert.equal(BROWSER_GENERIC_IDENTITY, "Browser work");
  assert.equal(BROWSER_SNAPSHOT, "Snapshot");
  assert.equal(BROWSER_SNAPSHOT_MUTED, "Journaled snapshot");
  assert.equal(
    BROWSER_TOOLTIP_RUNNING,
    "Vendor browser / web-fetch work is still running. Permissions still settle in the action dock.",
  );
  assert.equal(BROWSER_TOOLTIP_DONE, "Vendor browser / web-fetch work finished.");
  assert.equal(BROWSER_TOOLTIP_FAILED, "Vendor browser / web-fetch work failed.");
  assert.equal(
    BROWSER_TOOLTIP_SNAPSHOT,
    "Journaled snapshot caption from this run — not a live page.",
  );
});

test("banned Stuck / Status unconfirmed / live-page / Complete strings are not exported", () => {
  const locked = [
    BROWSER_HEADER,
    BROWSER_LOADING,
    BROWSER_FAILED,
    BROWSER_OFFLINE,
    BROWSER_RECONNECT_SHORT,
    BROWSER_LIVE_GROWING,
    BROWSER_HELPER,
    BROWSER_AVAILABLE_ANNOUNCE,
    BROWSER_STATUS_RUNNING,
    BROWSER_STATUS_DONE,
    BROWSER_STATUS_FAILED,
    BROWSER_UNAVAILABLE,
    BROWSER_GENERIC_IDENTITY,
    BROWSER_SNAPSHOT,
    BROWSER_SNAPSHOT_MUTED,
    BROWSER_TOOLTIP_RUNNING,
    BROWSER_TOOLTIP_DONE,
    BROWSER_TOOLTIP_FAILED,
    BROWSER_TOOLTIP_SNAPSHOT,
  ];
  for (const s of locked) {
    assert.equal(/stuck/i.test(s), false, s);
    assert.equal(/status unconfirmed/i.test(s), false, s);
    assert.equal(/all pages loaded/i.test(s), false, s);
    assert.equal(/\bcomplete\b/i.test(s), false, s);
    assert.equal(/live page/.test(s) && !/not a live page/.test(s), false, s);
  }
});

test("projection function signature has no journalMembers parameter", () => {
  assert.equal(projectBrowserWork.length, 1);
  assert.equal(/journalMembers/.test(projectBrowserWork.toString()), false);
});

test("Chat / fallback / hard_fail → absent even with leftover members", () => {
  assert.equal(base({ mode: "chat" }).state, "absent");
  assert.equal(base({ codeAgent: fallback }).state, "absent");
  assert.equal(base({ codeAgent: hardFail }).state, "absent");
  assert.equal(base({ codeAgent: null }).state, "absent");
  assert.equal(
    projectBrowserWork({
      mode: "code",
      codeAgent: fallback,
      browserWork: { disposition: "absent_for_non_code_or_non_vendor", members: null },
      connected: true,
      parentTerminal: false,
      runNonTerminal: true,
    }).state,
    "absent",
  );
});

test("missing browserWork fact → absent (never invent)", () => {
  assert.equal(base({ browserWork: null }).state, "absent");
  assert.equal(base({ browserWork: undefined }).state, "absent");
});

test("absent_for_non_code_or_non_vendor disposition → absent", () => {
  assert.equal(
    base({
      browserWork: { disposition: "absent_for_non_code_or_non_vendor", members: null },
    }).state,
    "absent",
  );
});

test("ready + [] → absent (quiet, not empty inventory copy)", () => {
  const p = base({ browserWork: readyFact([]) });
  assert.equal(p.state, "absent");
});

test("ready + null members → absent", () => {
  const p = base({ browserWork: { disposition: "ready", members: null } });
  assert.equal(p.state, "absent");
});

test("eligibility keys off vendor, not connected — offline still projects members", () => {
  const p = base({ connected: false });
  assert.equal(p.state, "ready");
  if (p.state !== "ready") return;
  assert.equal(p.members.length, 1);
  assert.equal(p.members[0]!.identityLabel, "Docs");
  assert.equal(p.members[0]!.showLiveRunningChip, false);
  assert.equal(p.runningCount, 0);
  assert.equal(p.offlineCopy, BROWSER_OFFLINE);
  assert.equal(p.reconnectCopy, null);
});

test("hydrating → Loading copy; keeps prior members", () => {
  const p = base({
    browserWork: { disposition: "hydrating", members: [doneFetch, runningFetch] },
  });
  assert.equal(p.state, "loading");
  if (p.state !== "loading") return;
  assert.equal(p.sectionCopy, BROWSER_LOADING);
  assert.equal(p.reconnectCopy, null);
  assert.ok(p.members);
  assert.equal(p.members!.length, 2);
  assert.deepEqual(p.members!.map((m) => m.toolCallId), ["f2", "f1"]);
});

test("hydrating with no prior ready → loading + null members (not false empty)", () => {
  const p = base({
    browserWork: { disposition: "hydrating", members: null },
  });
  assert.equal(p.state, "loading");
  if (p.state !== "loading") return;
  assert.equal(p.members, null);
  assert.equal(p.sectionCopy, BROWSER_LOADING);
});

test("hydrating ∩ offline still uses Loading as section lead (not offline string)", () => {
  const p = base({
    browserWork: { disposition: "hydrating", members: [runningFetch] },
    connected: false,
  });
  assert.equal(p.state, "loading");
  if (p.state !== "loading") return;
  assert.equal(p.sectionCopy, BROWSER_LOADING);
  assert.equal(p.reconnectCopy, null);
  assert.equal(p.members![0]!.showLiveRunningChip, false);
  assert.notEqual(p.sectionCopy, BROWSER_OFFLINE);
  assert.notEqual(p.sectionCopy, BROWSER_RECONNECT_SHORT);
});

test("obtain_failed → Couldn't load copy", () => {
  const p = base({
    browserWork: { disposition: "obtain_failed", members: null },
  });
  assert.equal(p.state, "error");
  if (p.state !== "error") return;
  assert.equal(p.message, BROWSER_FAILED);
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

test("offline + journaled running → historical row, no live chip, runningCount 0", () => {
  const p = base({
    browserWork: readyFact([runningFetch, doneFetch]),
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
  assert.equal(p.offlineCopy, BROWSER_OFFLINE);
  assert.equal(p.reconnectCopy, null);
  assert.equal(p.liveGrowing, false);
  assert.equal(running.identityLabel, "Docs");
});

test("parent terminal + connected → short reconnect copy; Done/Failed still chipped", () => {
  const p = base({
    browserWork: readyFact([runningFetch, doneFetch, failedFetch]),
    connected: true,
    parentTerminal: true,
    runNonTerminal: false,
  });
  assert.equal(p.state, "ready");
  if (p.state !== "ready") return;
  assert.equal(p.reconnectCopy, BROWSER_RECONNECT_SHORT);
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
  assert.equal(p.reconnectCopy, BROWSER_RECONNECT_SHORT);
});

test("unrestorable listed Unavailable ≠ Failed; included in totalCount not chip counts", () => {
  const p = base({
    browserWork: readyFact([doneFetch, unrestorableFetch]),
  });
  assert.equal(p.state, "ready");
  if (p.state !== "ready") return;
  assert.equal(p.totalCount, 2);
  assert.equal(p.doneCount, 1);
  assert.equal(p.failedCount, 0);
  assert.equal(p.runningCount, 0);
  const gone = p.members.find((m) => m.toolCallId === "gone")!;
  assert.equal(gone.restore, "unrestorable");
  assert.equal(gone.identityLabel, BROWSER_GENERIC_IDENTITY);
  assert.equal(gone.url, null);
  assert.equal(gone.title, null);
  assert.equal(gone.status, null);
  assert.equal(gone.snapshotJournaled, false);
  assert.equal(gone.showLiveRunningChip, false);
  const restored = p.members.find((m) => m.toolCallId === "f2")!;
  assert.equal(restored.title, "A");
  assert.equal(restored.status, "done");
});

test("snapshot caption only when snapshotJournaled is true", () => {
  const withSnap = base({
    browserWork: readyFact([member({ snapshotJournaled: true, status: "done" })]),
  });
  const without = base({
    browserWork: readyFact([member({ snapshotJournaled: false, status: "done" })]),
  });
  assert.equal(withSnap.state, "ready");
  assert.equal(without.state, "ready");
  if (withSnap.state === "ready") assert.equal(withSnap.members[0]!.snapshotJournaled, true);
  if (without.state === "ready") assert.equal(without.members[0]!.snapshotJournaled, false);
});

test("no URL/title invent when both null — generic Browser work identity", () => {
  const p = base({
    browserWork: readyFact([member({ url: null, title: null, status: "running" })]),
  });
  assert.equal(p.state, "ready");
  if (p.state !== "ready") return;
  assert.equal(p.members[0]!.identityLabel, BROWSER_GENERIC_IDENTITY);
  assert.equal(p.members[0]!.url, null);
  assert.equal(p.members[0]!.title, null);
});

test("title+url identity is title primary with url retained; title-only; url-only", () => {
  const both = base({
    browserWork: readyFact([member({ title: "Docs", url: "https://docs.x.ai" })]),
  });
  const titleOnly = base({
    browserWork: readyFact([member({ title: "Docs", url: null })]),
  });
  const urlOnly = base({
    browserWork: readyFact([member({ title: null, url: "https://docs.x.ai" })]),
  });
  assert.equal(both.state, "ready");
  if (both.state === "ready") {
    assert.equal(both.members[0]!.identityLabel, "Docs");
    assert.equal(both.members[0]!.url, "https://docs.x.ai");
    assert.equal(both.members[0]!.title, "Docs");
  }
  assert.equal(titleOnly.state, "ready");
  if (titleOnly.state === "ready") {
    assert.equal(titleOnly.members[0]!.identityLabel, "Docs");
    assert.equal(titleOnly.members[0]!.url, null);
  }
  assert.equal(urlOnly.state, "ready");
  if (urlOnly.state === "ready") {
    assert.equal(urlOnly.members[0]!.identityLabel, "https://docs.x.ai");
    assert.equal(urlOnly.members[0]!.url, "https://docs.x.ai");
  }
});

test("multi-member preserves identities and firstEventSeq order", () => {
  const p = base({
    browserWork: readyFact([runningFetch, doneFetch, failedFetch]),
  });
  assert.equal(p.state, "ready");
  if (p.state !== "ready") return;
  assert.deepEqual(p.members.map((m) => m.toolCallId), ["f2", "f1", "f3"]);
  assert.deepEqual(p.members.map((m) => m.identityLabel), ["A", "Docs", "Boom"]);
  assert.equal(p.runningCount, 1);
  assert.equal(p.doneCount, 1);
  assert.equal(p.failedCount, 1);
  assert.equal(p.totalCount, 3);
});

test("non-fetch members are not elevated even if title/URL look like browses", () => {
  const p = base({
    browserWork: readyFact([
      runningFetch,
      {
        ...member({
          toolCallId: "read-1",
          title: "Fetch https://evil.example",
          url: "https://evil.example",
        }),
        acpToolKind: "read" as "fetch",
      },
    ]),
  });
  assert.equal(p.state, "ready");
  if (p.state !== "ready") return;
  assert.equal(p.members.length, 1);
  assert.equal(p.members[0]!.toolCallId, "f1");
});

test("incomplete members without toolCallId are withheld", () => {
  const p = base({
    browserWork: readyFact([
      runningFetch,
      member({ toolCallId: "", title: "Ghost" }),
    ]),
  });
  assert.equal(p.state, "ready");
  if (p.state !== "ready") return;
  assert.equal(p.members.length, 1);
  assert.equal(p.members[0]!.toolCallId, "f1");
});

test("paints browserWork.members only — extra journalMembers field is ignored", () => {
  const hostOnly = member({ toolCallId: "host-1", title: "From host", firstEventSeq: 1 });
  const journalOnly = member({ toolCallId: "journal-1", title: "From journal", firstEventSeq: 2 });
  const p = projectBrowserWork({
    mode: "code",
    codeAgent: vendor,
    browserWork: readyFact([hostOnly]),
    connected: true,
    parentTerminal: false,
    runNonTerminal: true,
    journalMembers: [journalOnly],
  } as Parameters<typeof projectBrowserWork>[0]);
  assert.equal(p.state, "ready");
  if (p.state !== "ready") return;
  assert.equal(p.members.length, 1);
  assert.equal(p.members[0]!.toolCallId, "host-1");
  assert.equal(p.members[0]!.identityLabel, "From host");
});

test("ready empty stays absent even if a journal-shaped extra field is present", () => {
  const p = projectBrowserWork({
    mode: "code",
    codeAgent: vendor,
    browserWork: readyFact([]),
    connected: true,
    parentTerminal: false,
    runNonTerminal: true,
    journalMembers: [runningFetch],
  } as Parameters<typeof projectBrowserWork>[0]);
  assert.equal(p.state, "absent");
});

test("status transition running→done while voucher current → Done chip only", () => {
  const p = base({
    browserWork: readyFact([member({ status: "done" })]),
  });
  assert.equal(p.state, "ready");
  if (p.state !== "ready") return;
  assert.equal(p.members[0]!.status, "done");
  assert.equal(p.members[0]!.showLiveRunningChip, false);
  assert.equal(p.runningCount, 0);
  assert.equal(p.doneCount, 1);
});

test("first-frame done / failed is legal (no force to running)", () => {
  const done = base({ browserWork: readyFact([doneFetch]) });
  assert.equal(done.state, "ready");
  if (done.state === "ready") {
    assert.equal(done.members[0]!.status, "done");
    assert.equal(done.members[0]!.showLiveRunningChip, false);
  }
  const failed = base({ browserWork: readyFact([failedFetch]) });
  assert.equal(failed.state, "ready");
  if (failed.state === "ready") {
    assert.equal(failed.members[0]!.status, "failed");
  }
});

test("liveGrowing only while run non-terminal and current voucher exists", () => {
  assert.equal(base({ runNonTerminal: true }).state === "ready" && base({}).state === "ready", true);
  const live = base({ runNonTerminal: true });
  const terminal = base({ runNonTerminal: false, parentTerminal: true });
  if (live.state === "ready") assert.equal(live.liveGrowing, true);
  if (terminal.state === "ready") assert.equal(terminal.liveGrowing, false);
});
