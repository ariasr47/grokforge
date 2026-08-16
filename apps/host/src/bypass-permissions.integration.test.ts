import test from "node:test";
import assert from "node:assert/strict";
import { BypassActivation } from "./bypass-activation.js";
import { AgentSession } from "./session.js";

test("bypass capability is single-use and process-pair bound", () => {
  const b = new BypassActivation("test-secret");
  const token = b.issue({ sessionId: "session-01", desktopProcessId: 10, hostProcessId: 20, expiresAt: Date.now() + 10_000 });
  assert.equal(b.verify(token, "session-01", 10, 20), true);
  assert.equal(b.verify(token, "session-01", 10, 20), false);
  const other = b.issue({ sessionId: "session-01", desktopProcessId: 10, hostProcessId: 20, expiresAt: Date.now() + 10_000 });
  assert.equal(b.verify(other, "session-01", 11, 20), false);
});

test("bypass activation fails closed without a configured secret", () => {
  const b = new BypassActivation("");
  assert.equal(b.available, false);
  assert.equal(b.verify("anything", "session-01", 10, 20), false);
  assert.throws(() => b.issue({ sessionId: "session-01", desktopProcessId: 10, hostProcessId: 20, expiresAt: Date.now() + 1000 }));
});

test("managed-disabled Bypass rejects with no session mutation", async () => {
  const previous = process.env.GROKFORGE_BYPASS_DISABLED;
  process.env.GROKFORGE_BYPASS_DISABLED = "1";
  const s = Object.create(AgentSession.prototype) as any;
  s.stableClientSessionId = "session"; s.bypassActive = false; s.activeRunId = null;
  try { await assert.rejects(() => s.setPermissionMode("bypass_permissions", "valid-looking-token"), (e: any) => e?.code === "bypass_managed_disabled"); assert.equal(s.bypassActive, false); }
  finally { if (previous === undefined) delete process.env.GROKFORGE_BYPASS_DISABLED; else process.env.GROKFORGE_BYPASS_DISABLED = previous; }
});

test("packaged managed-disable flag is honored end to end", async () => {
  const previousCanonical = process.env.GROKFORGE_MANAGED_BYPASS_DISABLED;
  const previousCompat = process.env.GROKFORGE_BYPASS_DISABLED;
  process.env.GROKFORGE_MANAGED_BYPASS_DISABLED = "1";
  delete process.env.GROKFORGE_BYPASS_DISABLED;
  const s = Object.create(AgentSession.prototype) as any;
  s.stableClientSessionId = "session"; s.bypassActive = false; s.activeRunId = null;
  try {
    await assert.rejects(() => s.setPermissionMode("bypass_permissions", "valid-looking-token"), (e: any) => e?.code === "bypass_managed_disabled");
    assert.equal(s.bypassActive, false);
    assert.equal(s.bypassView().blockedReason, "managed_disabled");
  } finally {
    if (previousCanonical === undefined) delete process.env.GROKFORGE_MANAGED_BYPASS_DISABLED; else process.env.GROKFORGE_MANAGED_BYPASS_DISABLED = previousCanonical;
    if (previousCompat === undefined) delete process.env.GROKFORGE_BYPASS_DISABLED; else process.env.GROKFORGE_BYPASS_DISABLED = previousCompat;
  }
});

test("run_active Bypass rejects before mutation", async () => {
  const s = Object.create(AgentSession.prototype) as any;
  s.stableClientSessionId = "session"; s.bypassActive = false; s.activeRunId = "run";
  s.runCoordinator = { get: () => ({ state: "running" }) };
  await assert.rejects(() => s.setPermissionMode("bypass_permissions", "valid-looking-token"), (e: any) => e?.code === "run_active");
  assert.equal(s.bypassActive, false);
});
