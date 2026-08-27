import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deriveLivePhase, lastContentKindFromRun, phaseCopy } from "./derivedLivePhase.js";
import type { RunProjectionRun } from "./runReducer.js";

describe("DerivedLivePhase B1 order", () => {
  it("in-flight tool owns busy over leftover Writing… and Plan", () => {
    const d = deriveLivePhase({
      terminal: false,
      ownedBusy: true,
      liveness: "provider",
      planOwned: true,
      pendingTool: { title: "Reading notes.md", summary: "Read notes.md", name: "read_file" },
      lastContentKind: "message",
      decisionPending: false,
    });
    assert.equal(d.kind, "tool");
    assert.equal(phaseCopy(d).status, "Reading notes.md");
  });

  it("decision demotes leftover thought/message (AC 6)", () => {
    const d = deriveLivePhase({
      terminal: false,
      ownedBusy: true,
      liveness: "decision",
      planOwned: false,
      pendingTool: null,
      lastContentKind: "message",
      decisionPending: true,
    });
    assert.equal(d.kind, "decision");
    assert.notEqual(phaseCopy(d).status, "Writing…");
    assert.notEqual(phaseCopy(d).status, "Thinking…");
  });

  it("Plan-owned beats leftover message and generic provider-wait", () => {
    const d = deriveLivePhase({
      terminal: false,
      ownedBusy: true,
      liveness: "provider",
      planOwned: true,
      pendingTool: null,
      lastContentKind: "message",
      decisionPending: false,
    });
    assert.equal(d.kind, "plan");
    assert.equal(phaseCopy(d).status, "Planning");
    assert.equal(phaseCopy(d).footer, "Plan · no edits applied");
  });

  it("post-tool provider demotes leftover thought/message and tool title (AC 7)", () => {
    const d = deriveLivePhase({
      terminal: false,
      ownedBusy: true,
      liveness: "provider",
      planOwned: false,
      pendingTool: null,
      lastContentKind: "message",
      decisionPending: false,
      postToolProviderWait: true,
    });
    assert.equal(d.kind, "provider_wait");
    assert.equal(phaseCopy(d).status, "Waiting for model…");
  });

  it("newest live content kind: thought → Thinking…; message → Writing…", () => {
    assert.equal(phaseCopy(deriveLivePhase({
      terminal: false, ownedBusy: true, liveness: "provider", planOwned: false,
      pendingTool: null, lastContentKind: "thought", decisionPending: false,
    })).status, "Thinking…");
    assert.equal(phaseCopy(deriveLivePhase({
      terminal: false, ownedBusy: true, liveness: "provider", planOwned: false,
      pendingTool: null, lastContentKind: "message", decisionPending: false,
    })).status, "Writing…");
  });

  it("background/journal_recovery hide live phase", () => {
    const d = deriveLivePhase({
      terminal: false, ownedBusy: true, liveness: "background", planOwned: false,
      pendingTool: null, lastContentKind: null, decisionPending: false,
    });
    assert.equal(d.kind, "hidden");
    assert.equal(phaseCopy(d).status, null);
  });

  it("terminal clears live phase", () => {
    const d = deriveLivePhase({
      terminal: true, ownedBusy: false, liveness: null, planOwned: false,
      pendingTool: null, lastContentKind: "message", decisionPending: false,
    });
    assert.equal(d.kind, "clear");
  });

  it("no Writing answer… branch", () => {
    const labels = ["Waiting for model…", "Thinking…", "Writing…", "Using tools…", "Planning"];
    for (const l of labels) assert.equal(/Writing answer/.test(l), false);
    const writing = phaseCopy(deriveLivePhase({
      terminal: false, ownedBusy: true, liveness: "provider", planOwned: false,
      pendingTool: null, lastContentKind: "message", decisionPending: false,
    }));
    assert.equal(writing.status, "Writing…");
    assert.equal(/Writing answer/.test(writing.status ?? ""), false);
  });

  it("null tool title/summary/name uses Using tools…", () => {
    const d = deriveLivePhase({
      terminal: false, ownedBusy: true, liveness: "tool", planOwned: false,
      pendingTool: { title: null, summary: null, name: null }, lastContentKind: "tool",
      decisionPending: false,
    });
    assert.equal(d.kind, "tool");
    assert.equal(phaseCopy(d).status, "Using tools…");
  });
});

describe("lastContentKindFromRun", () => {
  it("reads shell-derive lastContentKind, not a journal slot", () => {
    const run = {
      lastContentKind: "message",
      reasoning: { r: "think" },
      message: { m: "mid" },
      activities: {},
    } as Pick<RunProjectionRun, "lastContentKind" | "reasoning" | "message" | "activities">;
    assert.equal(lastContentKindFromRun(run), "message");
  });
});
