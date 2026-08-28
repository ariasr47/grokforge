import test from "node:test";
import assert from "node:assert/strict";
import type { CodeAgentFact, McpServerMember, McpServersMembershipFact } from "./api";
import {
  MCP_AVAILABLE_ANNOUNCE,
  MCP_FAILED,
  MCP_GENERIC_IDENTITY,
  MCP_HEADER,
  MCP_HELPER,
  MCP_LIVE_GROWING,
  MCP_LOADING,
  MCP_OFFLINE,
  MCP_RECONNECT_SHORT,
  MCP_STATUS_CONNECTED,
  MCP_STATUS_ERROR,
  MCP_STATUS_IDLE,
  MCP_TOOLTIP_CONNECTED,
  MCP_TOOLTIP_ERROR,
  MCP_TOOLTIP_IDLE,
  MCP_UNAVAILABLE,
  projectMcpServers,
} from "./mcpServersProjection";

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

function member(overrides: Partial<McpServerMember> = {}): McpServerMember {
  return {
    serverId: "s1",
    name: "Docs",
    status: "connected",
    restore: "restored",
    firstEventSeq: 4,
    ...overrides,
  };
}

const connectedDocs = member();
const idleSearch = member({
  serverId: "s2",
  name: "Search",
  status: "idle",
  firstEventSeq: 2,
});
const errorAuth = member({
  serverId: "s3",
  name: "Auth",
  status: "error",
  firstEventSeq: 9,
});
const unrestorableGone = member({
  serverId: "gone",
  name: "Should not paint",
  status: "error",
  restore: "unrestorable",
  firstEventSeq: 5,
});

function readyFact(members: McpServerMember[]): McpServersMembershipFact {
  return { disposition: "ready", members };
}

function base(overrides: Partial<Parameters<typeof projectMcpServers>[0]> = {}) {
  return projectMcpServers({
    mode: "code",
    codeAgent: vendor,
    mcpServers: readyFact([connectedDocs]),
    connected: true,
    parentTerminal: false,
    ownershipLost: false,
    runNonTerminal: true,
    ...overrides,
  });
}

test("locked copy strings match SPEC §4 exactly", () => {
  assert.equal(MCP_HEADER, "MCP");
  assert.equal(MCP_LOADING, "Loading MCP…");
  assert.equal(MCP_FAILED, "Couldn't load MCP.");
  assert.equal(
    MCP_OFFLINE,
    "Forge is offline. MCP recorded on this session so far is still shown. Reconnect to confirm later updates.",
  );
  assert.equal(MCP_RECONNECT_SHORT, "Reconnect to confirm MCP status.");
  assert.equal(MCP_LIVE_GROWING, "Updating as MCP appears…");
  assert.equal(
    MCP_HELPER,
    "MCP servers Grok Code advertised on this session — Forge chrome, not a Forge MCP host.",
  );
  assert.equal(MCP_AVAILABLE_ANNOUNCE, "MCP available");
  assert.equal(MCP_STATUS_CONNECTED, "Connected");
  assert.equal(MCP_STATUS_IDLE, "Idle");
  assert.equal(MCP_STATUS_ERROR, "Error");
  assert.equal(MCP_UNAVAILABLE, "Unavailable");
  assert.equal(MCP_GENERIC_IDENTITY, "MCP server");
  assert.equal(
    MCP_TOOLTIP_CONNECTED,
    "Vendor-advertised MCP server is connected. Permissions still settle in the action dock.",
  );
  assert.equal(MCP_TOOLTIP_IDLE, "Vendor-advertised MCP server is idle.");
  assert.equal(MCP_TOOLTIP_ERROR, "Vendor-advertised MCP server reported an error.");
});

test("banned Stuck / Status unconfirmed / Disconnected / Healthy strings are not exported", () => {
  const locked = [
    MCP_HEADER,
    MCP_LOADING,
    MCP_FAILED,
    MCP_OFFLINE,
    MCP_RECONNECT_SHORT,
    MCP_LIVE_GROWING,
    MCP_HELPER,
    MCP_AVAILABLE_ANNOUNCE,
    MCP_STATUS_CONNECTED,
    MCP_STATUS_IDLE,
    MCP_STATUS_ERROR,
    MCP_UNAVAILABLE,
    MCP_GENERIC_IDENTITY,
    MCP_TOOLTIP_CONNECTED,
    MCP_TOOLTIP_IDLE,
    MCP_TOOLTIP_ERROR,
  ];
  for (const s of locked) {
    assert.equal(/stuck/i.test(s), false, s);
    assert.equal(/status unconfirmed/i.test(s), false, s);
    assert.equal(/\bdisconnected\b/i.test(s), false, s);
    assert.equal(/\bhealthy\b/i.test(s), false, s);
  }
});

test("projection function signature has no journalMembers parameter", () => {
  assert.equal(projectMcpServers.length, 1);
  assert.equal(/journalMembers/.test(projectMcpServers.toString()), false);
});

test("Chat / Mini-Grok / hard_fail → absent even with leftover members", () => {
  assert.equal(base({ mode: "chat" }).state, "absent");
  assert.equal(base({ codeAgent: fallback }).state, "absent");
  assert.equal(base({ codeAgent: hardFail }).state, "absent");
  assert.equal(base({ codeAgent: null }).state, "absent");
  assert.equal(
    projectMcpServers({
      mode: "code",
      codeAgent: fallback,
      mcpServers: { disposition: "absent_for_non_code_or_non_vendor", members: null },
      connected: true,
      parentTerminal: false,
      runNonTerminal: true,
    }).state,
    "absent",
  );
});

test("missing mcpServers fact → absent (never invent)", () => {
  assert.equal(base({ mcpServers: null }).state, "absent");
  assert.equal(base({ mcpServers: undefined }).state, "absent");
});

test("absent_for_non_code_or_non_vendor disposition → absent", () => {
  assert.equal(
    base({
      mcpServers: { disposition: "absent_for_non_code_or_non_vendor", members: null },
    }).state,
    "absent",
  );
});

test("ready + [] → absent (quiet, not empty inventory or load-error copy)", () => {
  const p = base({ mcpServers: readyFact([]) });
  assert.equal(p.state, "absent");
});

test("hostRosterEligible false withholds host-global MCP roster", () => {
  const p = base({ hostRosterEligible: false });
  assert.equal(p.state, "absent");
});

test("ready + null members → absent", () => {
  const p = base({ mcpServers: { disposition: "ready", members: null } });
  assert.equal(p.state, "absent");
});

test("eligibility keys off vendor, not connected — offline still projects members", () => {
  const p = base({ connected: false });
  assert.equal(p.state, "ready");
  if (p.state !== "ready") return;
  assert.equal(p.members.length, 1);
  assert.equal(p.members[0]!.identityLabel, "Docs");
  assert.equal(p.members[0]!.showLiveConnectedChip, false);
  assert.equal(p.connectedCount, 0);
  assert.equal(p.totalCount, 1);
  assert.equal(p.offlineCopy, MCP_OFFLINE);
  assert.equal(p.reconnectCopy, null);
});

test("hydrating → Loading copy; keeps prior members", () => {
  const p = base({
    mcpServers: { disposition: "hydrating", members: [idleSearch, connectedDocs] },
  });
  assert.equal(p.state, "loading");
  if (p.state !== "loading") return;
  assert.equal(p.sectionCopy, MCP_LOADING);
  assert.equal(p.reconnectCopy, null);
  assert.ok(p.members);
  assert.equal(p.members!.length, 2);
  assert.deepEqual(p.members!.map((m) => m.serverId), ["s2", "s1"]);
});

test("hydrating with no prior ready → loading + null members (not false empty)", () => {
  const p = base({
    mcpServers: { disposition: "hydrating", members: null },
  });
  assert.equal(p.state, "loading");
  if (p.state !== "loading") return;
  assert.equal(p.members, null);
  assert.equal(p.sectionCopy, MCP_LOADING);
});

test("hydrating ∩ offline still uses Loading as section lead (not offline string)", () => {
  const p = base({
    mcpServers: { disposition: "hydrating", members: [connectedDocs] },
    connected: false,
  });
  assert.equal(p.state, "loading");
  if (p.state !== "loading") return;
  assert.equal(p.sectionCopy, MCP_LOADING);
  assert.equal(p.reconnectCopy, null);
  assert.equal(p.members![0]!.showLiveConnectedChip, false);
  assert.notEqual(p.sectionCopy, MCP_OFFLINE);
  assert.notEqual(p.sectionCopy, MCP_RECONNECT_SHORT);
});

test("obtain_failed keep-visible members + Couldn't load (fail if wiped)", () => {
  const p = base({
    mcpServers: { disposition: "obtain_failed", members: [idleSearch] },
  });
  assert.equal(p.state, "error");
  if (p.state !== "error") return;
  assert.equal(p.message, MCP_FAILED);
  assert.ok(p.members);
  assert.equal(p.members!.length, 1);
  assert.equal(p.members![0]!.serverId, "s2");
  assert.equal(p.members![0]!.identityLabel, "Search");
  assert.equal(p.members![0]!.status, "idle");
});

test("obtain_failed with null members → error + null members", () => {
  const p = base({
    mcpServers: { disposition: "obtain_failed", members: null },
  });
  assert.equal(p.state, "error");
  if (p.state !== "error") return;
  assert.equal(p.message, MCP_FAILED);
  assert.equal(p.members, null);
});

test("live connected with current voucher shows Connected chip and counts in connectedCount", () => {
  const p = base({});
  assert.equal(p.state, "ready");
  if (p.state !== "ready") return;
  assert.equal(p.members[0]!.showLiveConnectedChip, true);
  assert.equal(p.members[0]!.status, "connected");
  assert.equal(p.connectedCount, 1);
  assert.equal(p.totalCount, 1);
  assert.equal(p.liveGrowing, true);
  assert.equal(p.offlineCopy, null);
  assert.equal(p.reconnectCopy, null);
});

test("name null → generic MCP server identity, status still shown", () => {
  const p = base({
    mcpServers: readyFact([member({ name: null, status: "idle" })]),
  });
  assert.equal(p.state, "ready");
  if (p.state !== "ready") return;
  assert.equal(p.members[0]!.identityLabel, MCP_GENERIC_IDENTITY);
  assert.equal(p.members[0]!.status, "idle");
});

test("offline + three historical connected → rows stay, no live chip, N does not collapse to 0", () => {
  const three = [
    member({ serverId: "a", name: "A", firstEventSeq: 1 }),
    member({ serverId: "b", name: "B", firstEventSeq: 2 }),
    member({ serverId: "c", name: "C", firstEventSeq: 3 }),
  ];
  const p = base({
    mcpServers: readyFact(three),
    connected: false,
    runNonTerminal: true,
  });
  assert.equal(p.state, "ready");
  if (p.state !== "ready") return;
  assert.equal(p.totalCount, 3);
  assert.equal(p.members.length, 3);
  assert.equal(p.connectedCount, 0);
  assert.ok(p.members.every((m) => m.showLiveConnectedChip === false));
  assert.ok(p.members.every((m) => m.status === "connected"));
  assert.equal(p.offlineCopy, MCP_OFFLINE);
  assert.equal(p.reconnectCopy, null);
  assert.equal(p.liveGrowing, false);
});

test("parent terminal + connected → short reconnect copy; Idle/Error still chipped", () => {
  const p = base({
    mcpServers: readyFact([connectedDocs, idleSearch, errorAuth]),
    connected: true,
    parentTerminal: true,
    runNonTerminal: false,
  });
  assert.equal(p.state, "ready");
  if (p.state !== "ready") return;
  assert.equal(p.reconnectCopy, MCP_RECONNECT_SHORT);
  assert.equal(p.offlineCopy, null);
  assert.equal(p.connectedCount, 0);
  assert.equal(p.members.find((m) => m.status === "connected")!.showLiveConnectedChip, false);
  assert.equal(p.idleCount, 1);
  assert.equal(p.errorCount, 1);
  assert.equal(p.liveGrowing, false);
});

test("ownership loss withholds live Connected even while connected", () => {
  const p = base({ ownershipLost: true });
  assert.equal(p.state, "ready");
  if (p.state !== "ready") return;
  assert.equal(p.members[0]!.showLiveConnectedChip, false);
  assert.equal(p.connectedCount, 0);
  assert.equal(p.reconnectCopy, MCP_RECONNECT_SHORT);
});

test("withheld connected → showLiveConnectedChip false (no Connected tooltip path)", () => {
  const p = base({ connected: false });
  assert.equal(p.state, "ready");
  if (p.state !== "ready") return;
  assert.equal(p.members[0]!.showLiveConnectedChip, false);
  assert.equal(p.members[0]!.status, "connected");
});

test("mixed unrestorable listed Unavailable ≠ Error; included in totalCount not chip counts", () => {
  const p = base({
    mcpServers: readyFact([idleSearch, unrestorableGone]),
  });
  assert.equal(p.state, "ready");
  if (p.state !== "ready") return;
  assert.equal(p.totalCount, 2);
  assert.equal(p.idleCount, 1);
  assert.equal(p.errorCount, 0);
  assert.equal(p.connectedCount, 0);
  const gone = p.members.find((m) => m.serverId === "gone")!;
  assert.equal(gone.restore, "unrestorable");
  assert.equal(gone.identityLabel, MCP_GENERIC_IDENTITY);
  assert.equal(gone.status, null);
  assert.equal(gone.showLiveConnectedChip, false);
  const restored = p.members.find((m) => m.serverId === "s2")!;
  assert.equal(restored.identityLabel, "Search");
  assert.equal(restored.status, "idle");
});

test("multi-member preserves identities and firstEventSeq order", () => {
  const p = base({
    mcpServers: readyFact([connectedDocs, idleSearch, errorAuth]),
  });
  assert.equal(p.state, "ready");
  if (p.state !== "ready") return;
  assert.deepEqual(p.members.map((m) => m.serverId), ["s2", "s1", "s3"]);
  assert.deepEqual(p.members.map((m) => m.identityLabel), ["Search", "Docs", "Auth"]);
  assert.equal(p.connectedCount, 1);
  assert.equal(p.idleCount, 1);
  assert.equal(p.errorCount, 1);
  assert.equal(p.totalCount, 3);
});

test("incomplete members without serverId or status are withheld", () => {
  const p = base({
    mcpServers: readyFact([
      connectedDocs,
      member({ serverId: "", name: "Ghost" }),
      member({ serverId: "half", name: "Half", status: null, restore: "restored", firstEventSeq: 8 }),
    ]),
  });
  assert.equal(p.state, "ready");
  if (p.state !== "ready") return;
  assert.equal(p.members.length, 1);
  assert.equal(p.members[0]!.serverId, "s1");
});

test("paints mcpServers.members only — extra journalMembers field is ignored", () => {
  const hostOnly = member({ serverId: "host-1", name: "From host", firstEventSeq: 1 });
  const journalOnly = member({ serverId: "journal-1", name: "From journal", firstEventSeq: 2 });
  const p = projectMcpServers({
    mode: "code",
    codeAgent: vendor,
    mcpServers: readyFact([hostOnly]),
    connected: true,
    parentTerminal: false,
    runNonTerminal: true,
    journalMembers: [journalOnly],
  } as Parameters<typeof projectMcpServers>[0]);
  assert.equal(p.state, "ready");
  if (p.state !== "ready") return;
  assert.equal(p.members.length, 1);
  assert.equal(p.members[0]!.serverId, "host-1");
  assert.equal(p.members[0]!.identityLabel, "From host");
});

test("ready empty stays absent even if a journal-shaped extra field is present", () => {
  const p = projectMcpServers({
    mode: "code",
    codeAgent: vendor,
    mcpServers: readyFact([]),
    connected: true,
    parentTerminal: false,
    runNonTerminal: true,
    journalMembers: [connectedDocs],
  } as Parameters<typeof projectMcpServers>[0]);
  assert.equal(p.state, "absent");
});

test("status transition connected→idle while voucher current → Idle chip only", () => {
  const p = base({
    mcpServers: readyFact([member({ status: "idle" })]),
  });
  assert.equal(p.state, "ready");
  if (p.state !== "ready") return;
  assert.equal(p.members[0]!.status, "idle");
  assert.equal(p.members[0]!.showLiveConnectedChip, false);
  assert.equal(p.connectedCount, 0);
  assert.equal(p.idleCount, 1);
});

test("first-frame idle / error is legal (no force to connected)", () => {
  const idle = base({ mcpServers: readyFact([idleSearch]) });
  assert.equal(idle.state, "ready");
  if (idle.state === "ready") {
    assert.equal(idle.members[0]!.status, "idle");
    assert.equal(idle.members[0]!.showLiveConnectedChip, false);
  }
  const failed = base({ mcpServers: readyFact([errorAuth]) });
  assert.equal(failed.state, "ready");
  if (failed.state === "ready") {
    assert.equal(failed.members[0]!.status, "error");
  }
});

test("liveGrowing only while run non-terminal and current voucher exists", () => {
  const live = base({ runNonTerminal: true });
  const terminal = base({ runNonTerminal: false, parentTerminal: true });
  if (live.state === "ready") assert.equal(live.liveGrowing, true);
  if (terminal.state === "ready") assert.equal(terminal.liveGrowing, false);
});

test("no elapsed-timer status mutation helper is exported", async () => {
  const mod = await import("./mcpServersProjection.ts");
  for (const name of Object.keys(mod)) {
    assert.equal(/stuck|elapsed|timer|silence/i.test(name), false, name);
  }
});
