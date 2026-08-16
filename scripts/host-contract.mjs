/**
 * Automated host contract tests (no browser).
 * Covers dual-mode ACs that previously needed manual click-through of HTTP.
 */
import assert from "node:assert/strict";

const HOST = process.env.GROKFORGE_URL || "http://127.0.0.1:8787";

let passed = 0;
let failed = 0;
function ok(n) {
  passed += 1;
  console.log(`  ✓ ${n}`);
}
function fail(n, e) {
  failed += 1;
  console.error(`  ✗ ${n}: ${e?.message || e}`);
}

async function j(method, p, body) {
  const res = await fetch(`${HOST}${p}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

console.log(`Host contract @ ${HOST}\n`);

try {
  const { status, data } = await j("GET", "/api/health");
  assert.equal(status, 200);
  assert.equal(data.ok, true);
  ok("health");
} catch (e) {
  fail("health", e);
}

try {
  const { status, data } = await j("GET", "/api/state");
  assert.equal(status, 200);
  for (const k of ["mode", "effort", "connected", "authMode", "agentId"]) {
    // agentId may be present after upgrade
    if (k === "agentId" && !(k in data)) continue;
    assert.ok(k in data || k === "agentId", `missing ${k}`);
  }
  ok("state shape");
} catch (e) {
  fail("state shape", e);
}

try {
  let r = await j("POST", "/api/mode", { mode: "chat" });
  assert.equal(r.status, 200);
  assert.equal(r.data.mode, "chat");
  r = await j("POST", "/api/mode", { mode: "code" });
  assert.equal(r.status, 200);
  assert.equal(r.data.mode, "code");
  r = await j("POST", "/api/mode", { mode: "chat" });
  assert.equal(r.status, 200);
  ok("mode switch chat↔code");
} catch (e) {
  fail("mode switch", e);
}

try {
  const r = await j("POST", "/api/effort", { effort: "fast" });
  assert.equal(r.status, 200);
  assert.equal(r.data.effort, "fast");
  ok("effort");
} catch (e) {
  fail("effort", e);
}

try {
  const r = await j("GET", "/api/agents");
  assert.equal(r.status, 200);
  assert.ok(r.data.agents.some((a) => a.id === "grok-acp" && a.status === "ready"));
  assert.ok(r.data.agents.some((a) => a.status === "planned"));
  ok("agents registry");
} catch (e) {
  fail("agents", e);
}

try {
  const r = await j("POST", "/api/settings", { agentId: "codex-acp" });
  assert.equal(r.status, 400);
  ok("planned agent rejected");
} catch (e) {
  fail("planned agent reject", e);
}

try {
  const r = await j("GET", "/api/policy");
  assert.equal(r.status, 200);
  assert.ok(r.data.policy);
  ok("policy read");
} catch (e) {
  fail("policy", e);
}

try {
  const r = await j("POST", "/api/prefetch-mode", { mode: "code" });
  assert.equal(r.status, 404);
  ok("removed prefetch endpoint stays absent");
} catch (e) {
  fail("removed prefetch endpoint", e);
}

try {
  // Double prompt while not busy should 200 or auth error — not 500
  await j("POST", "/api/mode", { mode: "chat" });
  const r = await j("POST", "/api/prompt", { text: "contract ping", effort: "fast" });
  assert.ok([200, 400, 409].includes(r.status), `status ${r.status}`);
  if (r.status === 400 && /workspace/i.test(String(r.data?.error || ""))) {
    throw new Error("chat still blocked on workspace");
  }
  ok("chat prompt not workspace-blocked");
} catch (e) {
  fail("chat prompt", e);
}

try {
  const r = await j("GET", "/api/audit-path");
  assert.equal(r.status, 200);
  assert.ok(r.data.path);
  ok("audit path");
} catch (e) {
  fail("audit path", e);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
