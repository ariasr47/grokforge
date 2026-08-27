import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAgent, listAgents, resolveAgentSpawn, resolveVendorCodeSpawn } from "./agents.js";

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

  it("builds unique vendor Code spawn tuple", () => {
    const spec = resolveVendorCodeSpawn({
      command: "C:\\tools\\grok.exe",
      cwd: "C:\\ws",
      baseEnv: { XAI_API_KEY: "nope", PATH: "x", GROKFORGE_MODE: "code" },
    });
    assert.equal(spec.id, "grok-agent-stdio");
    assert.equal(spec.command, "C:\\tools\\grok.exe");
    assert.deepEqual(spec.args, ["agent", "stdio"]);
    assert.equal(spec.cwd, "C:\\ws");
    assert.equal("XAI_API_KEY" in (spec.env ?? {}), false);
  });

  it("Chat / grok-acp resolve still returns grok-acp id", () => {
    const spec = resolveAgentSpawn("grok-acp");
    assert.equal(spec.id, "grok-acp");
    assert.notDeepEqual(spec.args, ["agent", "stdio"]);
  });
});
