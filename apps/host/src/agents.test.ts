import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAgent, listAgents, resolveAgentSpawn, resolveVendorCodeSpawn, vendorCliArgs } from "./agents.js";

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

  it("from-source grok-acp prefers tsx src over dist so TS workspace packages load", () => {
    const prev = process.env.GROKFORGE_AGENT_ENTRY;
    delete process.env.GROKFORGE_AGENT_ENTRY;
    try {
      const spec = resolveAgentSpawn("grok-acp");
      const joined = spec.args.join(" ");
      assert.match(joined, /tsx/);
      assert.match(joined, /packages[/\\]grok-acp[/\\]src[/\\]index\.ts/);
      assert.equal(/packages[/\\]grok-acp[/\\]dist[/\\]index\.js/.test(joined), false);
    } finally {
      if (prev === undefined) delete process.env.GROKFORGE_AGENT_ENTRY;
      else process.env.GROKFORGE_AGENT_ENTRY = prev;
    }
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
    assert.equal(spec.args[0], "--cwd");
    assert.equal(spec.args[1], "C:\\ws");
    assert.equal(spec.args[2], "--rules");
    assert.match(spec.args[3] ?? "", /workingDirectory/);
    assert.match(spec.args[3] ?? "", /SAME invocation/);
    assert.match(spec.args[3] ?? "", /Set-Location apps\/shell/);
    assert.deepEqual(spec.args.slice(4), ["--permission-mode", "default", "agent", "stdio"]);
    assert.equal(spec.cwd, "C:\\ws");
    assert.equal("XAI_API_KEY" in (spec.env ?? {}), false);
  });

  it("maps Forge Review / Trusted / Bypass onto vendor CLI flags that override user config", () => {
    assert.deepEqual(vendorCliArgs("review"), ["--permission-mode", "default", "agent", "stdio"]);
    const review = vendorCliArgs("review", "C:\\ws");
    assert.equal(review[0], "--cwd");
    assert.equal(review[1], "C:\\ws");
    assert.equal(review[2], "--rules");
    assert.match(review[3] ?? "", /workingDirectory/);
    assert.deepEqual(review.slice(4), ["--permission-mode", "default", "agent", "stdio"]);
    const trusted = vendorCliArgs("trusted_workspace", "C:\\ws");
    assert.equal(trusted[0], "--cwd");
    assert.deepEqual(trusted.slice(4), ["--permission-mode", "acceptEdits", "agent", "stdio"]);
    const bypass = vendorCliArgs("bypass_permissions", "C:\\ws");
    assert.equal(bypass[0], "--cwd");
    assert.deepEqual(bypass.slice(4), ["agent", "--always-approve", "stdio"]);
    assert.equal(vendorCliArgs("review").includes("--always-approve"), false);
  });

  it("Chat / grok-acp resolve still returns grok-acp id", () => {
    const spec = resolveAgentSpawn("grok-acp");
    assert.equal(spec.id, "grok-acp");
    assert.notDeepEqual(spec.args, ["agent", "stdio"]);
  });
});
