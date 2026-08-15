import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildSessionMarkdown } from "./exportDiagnostics";
import type { DesktopHostStatus, PublicState } from "./api";

function baseState(overrides: Partial<PublicState> = {}): PublicState {
  return {
    workspace: null,
    workspaceName: null,
    authMode: "sub_pool",
    hasApiKey: true,
    authSource: "oauth",
    model: "grok-4",
    connected: true,
    busy: false,
    sessionId: null,
    recent: [],
    mode: "chat",
    effort: "auto",
    appliedEffort: null,
    appliedModel: null,
    chatRoot: null,
    ...overrides,
  };
}

describe("buildSessionMarkdown — AC10 diagnostics export", () => {
  it("includes mode and the selected effort when no fallback occurred", () => {
    const md = buildSessionMarkdown({
      state: baseState({ mode: "chat", effort: "fast", appliedEffort: null }),
      sessionId: null,
      messages: [],
    });
    assert.match(md, /Mode: chat/);
    assert.match(md, /Effort: fast \(applied: —\)/);
  });

  it("surfaces the applied effort distinctly when a fallback changed it", () => {
    const md = buildSessionMarkdown({
      state: baseState({ mode: "code", effort: "heavy", appliedEffort: "expert" }),
      sessionId: null,
      messages: [],
    });
    assert.match(md, /Effort: heavy \(applied: expert\)/);
  });

  it("never includes API keys or bearer tokens even if present on state-adjacent fields", () => {
    const secret = "sk-super-secret-token-value";
    const state = baseState({ authSource: "oauth" }) as PublicState & {
      apiKey?: string;
      token?: string;
    };
    state.apiKey = secret;
    state.token = secret;
    const md = buildSessionMarkdown({ state, sessionId: null, messages: [] });
    assert.equal(md.includes(secret), false);
  });
});

const LAUNCH: DesktopHostStatus = {
  ok: false,
  phase: "failed",
  owned: true,
  port: 8801,
  pid: 4242,
  reason: "crashed",
  osError: 42,
  message: "child exited unexpectedly",
};

describe("buildSessionMarkdown — F10 '## Launch' section (AC-U18)", () => {
  it("carries reason, osError, message, phase, owned, port, pid verbatim", () => {
    const md = buildSessionMarkdown({
      state: null,
      sessionId: null,
      messages: [],
      launch: LAUNCH,
    });
    assert.match(md, /### Launch/);
    assert.match(md, /reason: crashed/);
    assert.match(md, /osError: 42/);
    assert.match(md, /message: child exited unexpectedly/);
    assert.match(md, /phase: failed/);
    assert.match(md, /owned: true/);
    assert.match(md, /port: 8801/);
    assert.match(md, /pid: 4242/);
  });

  it("omits the Launch section entirely when no launch status is supplied", () => {
    const md = buildSessionMarkdown({ state: null, sessionId: null, messages: [] });
    assert.equal(md.includes("### Launch"), false);
  });

  it("carries version/channel from /api/health when supplied (AC25/AC26/AC-S8)", () => {
    const md = buildSessionMarkdown({
      state: null,
      sessionId: null,
      messages: [],
      health: { version: "0.3.1", channel: "prod", channelLabel: "PROD" },
    });
    assert.match(md, /### Build/);
    assert.match(md, /version: 0\.3\.1/);
    assert.match(md, /channel: prod \(PROD\)/);
  });
});
