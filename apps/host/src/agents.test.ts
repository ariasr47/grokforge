import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAgent, listAgents, resolveAgentSpawn } from "./agents.js";

describe("agent registry", () => {
  it("lists grok as ready and others planned", () => {
    const agents = listAgents();
    assert.ok(agents.some((a) => a.id === "grok-acp" && a.status === "ready"));
    assert.ok(agents.some((a) => a.id === "codex-acp" && a.status === "planned"));
    assert.ok(agents.some((a) => a.id === "claude-acp" && a.status === "planned"));
  });

  it("defaults unknown id to grok", () => {
    assert.equal(getAgent("nope").id, "grok-acp");
    assert.equal(getAgent(null).id, "grok-acp");
  });

  it("resolves grok-acp spawn without throwing", () => {
    const spec = resolveAgentSpawn("grok-acp");
    assert.equal(spec.id, "grok-acp");
    assert.ok(spec.command);
    assert.ok(spec.args.length >= 1);
  });

  it("rejects planned agents", () => {
    assert.throws(() => resolveAgentSpawn("codex-acp"), /not available/);
  });
});
