import test from "node:test";
import assert from "node:assert/strict";
import type { PublicState } from "./api";
import type { RunSnapshot } from "./runReducer";
import {
  CODE_AGENT_CHECKING,
  CODE_AGENT_FALLBACK_CLI,
  CODE_AGENT_FALLBACK_GENERIC,
  CODE_AGENT_FALLBACK_SPAWN,
  CODE_AGENT_HARD_FAIL,
  CODE_AGENT_OFFLINE,
  CODE_AGENT_VENDOR,
  CODE_AGENT_HOUSE,
  codeAgentPrimaryCopy,
  projectCodeAgentComposer,
} from "./codeAgentComposer";

const vendorFact = {
  resolveStatus: "ready" as const,
  identity: "vendor" as const,
  fallbackReason: null,
};

const fallbackCli = {
  resolveStatus: "ready" as const,
  identity: "fallback" as const,
  fallbackReason: "cli_missing" as const,
};

test("PublicState / RunSnapshot fixtures accept INTERFACE codeAgent fields", () => {
  const state = {
    codeAgent: vendorFact,
    connected: false,
    mode: "code",
  } as PublicState;
  assert.equal(state.codeAgent?.identity, "vendor");
  assert.equal(state.connected, false);
  const snap = {
    sessionId: "s1",
    runId: "r1",
    connectionGeneration: 1,
    state: "running",
    acceptedPrompt: "p",
    admittedAt: "",
    updatedAt: "",
    lastEventSeq: 0,
    policy: {},
    model: {},
    terminalKind: null,
    finalAnswer: null,
    answerVouched: false,
    failure: null,
    codeAgentProvenance: { identity: "vendor", fallbackReason: null },
  } satisfies RunSnapshot;
  assert.equal(snap.codeAgentProvenance?.identity, "vendor");
});

test("Chat → absent_chat even with a vendor voucher", () => {
  const projection = projectCodeAgentComposer({
    mode: "chat",
    codeAgent: vendorFact,
    transportOk: true,
  });
  assert.equal(projection.state, "absent_chat");
  assert.equal(codeAgentPrimaryCopy(projection), "");
});

test("Code + missing codeAgent → checking, never vendor", () => {
  const projection = projectCodeAgentComposer({
    mode: "code",
    codeAgent: null,
    transportOk: true,
  });
  assert.equal(projection.state, "checking");
  assert.equal(codeAgentPrimaryCopy(projection), CODE_AGENT_CHECKING);
  assert.notEqual(codeAgentPrimaryCopy(projection), CODE_AGENT_VENDOR);
});

test("resolving never flashes vendor even if identity leaked", () => {
  const projection = projectCodeAgentComposer({
    mode: "code",
    codeAgent: {
      resolveStatus: "resolving",
      identity: "vendor",
      fallbackReason: null,
    },
    transportOk: true,
  });
  assert.equal(projection.state, "checking");
  assert.equal(codeAgentPrimaryCopy(projection), CODE_AGENT_CHECKING);
});

test("A0 Code house identity is Grok, not Mini-Grok or Grok Code", () => {
  const projection = projectCodeAgentComposer({
    mode: "code",
    codeAgent: {
      resolveStatus: "ready",
      identity: "house",
      fallbackReason: null,
    },
    transportOk: true,
  });
  assert.equal(projection.state, "house");
  assert.equal(codeAgentPrimaryCopy(projection), CODE_AGENT_HOUSE);
  assert.equal(codeAgentPrimaryCopy(projection), "Grok");
  assert.equal(codeAgentPrimaryCopy(projection).includes("Mini-Grok"), false);
  assert.notEqual(codeAgentPrimaryCopy(projection), CODE_AGENT_VENDOR);
});

test("vouched vendor", () => {
  const projection = projectCodeAgentComposer({
    mode: "code",
    codeAgent: vendorFact,
    transportOk: true,
  });
  assert.equal(projection.state, "vendor");
  assert.equal(codeAgentPrimaryCopy(projection), CODE_AGENT_VENDOR);
});

test("fallback reasons prefer distinct secondary copy", () => {
  assert.equal(
    codeAgentPrimaryCopy(
      projectCodeAgentComposer({
        mode: "code",
        codeAgent: fallbackCli,
        transportOk: true,
      }),
    ),
    CODE_AGENT_FALLBACK_CLI,
  );
  assert.equal(
    codeAgentPrimaryCopy(
      projectCodeAgentComposer({
        mode: "code",
        codeAgent: {
          resolveStatus: "ready",
          identity: "fallback",
          fallbackReason: "spawn_failed",
        },
        transportOk: true,
      }),
    ),
    CODE_AGENT_FALLBACK_SPAWN,
  );
  assert.equal(
    codeAgentPrimaryCopy(
      projectCodeAgentComposer({
        mode: "code",
        codeAgent: {
          resolveStatus: "ready",
          identity: "fallback",
          fallbackReason: null,
        },
        transportOk: true,
      }),
    ),
    CODE_AGENT_FALLBACK_GENERIC,
  );
});

test("hard_fail is not fallback identity copy", () => {
  const projection = projectCodeAgentComposer({
    mode: "code",
    codeAgent: {
      resolveStatus: "hard_fail",
      identity: "hard_fail",
      fallbackReason: null,
    },
    transportOk: true,
  });
  assert.equal(projection.state, "hard_fail");
  assert.equal(codeAgentPrimaryCopy(projection), CODE_AGENT_HARD_FAIL);
  assert.notEqual(codeAgentPrimaryCopy(projection), CODE_AGENT_FALLBACK_GENERIC);
});

test("transportOk true + ACP connected would-be false still shows vendor", () => {
  const projection = projectCodeAgentComposer({
    mode: "code",
    codeAgent: vendorFact,
    transportOk: true,
  });
  assert.equal(projection.state, "vendor");
  assert.notEqual(projection.state, "offline_unconfirmed");
});

test("transport down keeps last fallback and never upgrades to vendor", () => {
  const projection = projectCodeAgentComposer({
    mode: "code",
    codeAgent: fallbackCli,
    transportOk: false,
  });
  assert.equal(projection.state, "offline_unconfirmed");
  if (projection.state !== "offline_unconfirmed") return;
  assert.equal(projection.last.state, "fallback");
  if (projection.last.state !== "fallback") return;
  assert.equal(projection.last.reason, "cli_missing");
  assert.equal(codeAgentPrimaryCopy(projection), CODE_AGENT_OFFLINE);
  assert.equal(codeAgentPrimaryCopy(projection.last), CODE_AGENT_FALLBACK_CLI);
  assert.notEqual(codeAgentPrimaryCopy(projection.last), CODE_AGENT_VENDOR);
});

test("transport down keeps last vendor", () => {
  const projection = projectCodeAgentComposer({
    mode: "code",
    codeAgent: vendorFact,
    transportOk: false,
  });
  assert.equal(projection.state, "offline_unconfirmed");
  if (projection.state !== "offline_unconfirmed") return;
  assert.equal(projection.last.state, "vendor");
});
