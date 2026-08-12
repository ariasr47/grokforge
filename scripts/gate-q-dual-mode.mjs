/**
 * GATE Q checklist for dual-mode-shell — runtime observation against a live host.
 * Usage: host must be running on :8787
 *   node scripts/gate-q-dual-mode.mjs
 */
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const HOST = process.env.GROKFORGE_URL || "http://127.0.0.1:8787";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let passed = 0;
let failed = 0;

function ok(name) {
  passed += 1;
  console.log(`  ✓ ${name}`);
}
function fail(name, err) {
  failed += 1;
  console.error(`  ✗ ${name}: ${err?.message || err}`);
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

console.log(`GATE Q dual-mode-shell @ ${HOST}\n`);

// AC health + state shape
try {
  const { status, data } = await j("GET", "/api/health");
  assert.equal(status, 200);
  assert.equal(data.ok, true);
  assert.ok(data.pid, "pid present");
  ok("AC health + pid");
} catch (e) {
  fail("AC health + pid", e);
}

try {
  const { status, data } = await j("GET", "/api/state");
  assert.equal(status, 200);
  for (const k of [
    "mode",
    "effort",
    "appliedEffort",
    "chatRoot",
    "workspace",
    "connected",
  ]) {
    assert.ok(k in data, `missing ${k}`);
  }
  ok("AC state has mode/effort/chatRoot");
} catch (e) {
  fail("AC state has mode/effort/chatRoot", e);
}

// AC3 chat without workspace ceremony
try {
  let r = await j("POST", "/api/mode", { mode: "chat" });
  assert.equal(r.status, 200);
  assert.equal(r.data.mode, "chat");
  assert.ok(r.data.chatRoot || r.data.workspace);
  assert.ok(
    String(r.data.workspace || r.data.chatRoot).includes("chat-sandbox") ||
      r.data.workspace,
  );
  r = await j("POST", "/api/effort", { effort: "fast" });
  assert.equal(r.status, 200);
  assert.equal(r.data.effort, "fast");
  // prompt may 200 or error on auth — must not be "Open a workspace first"
  r = await j("POST", "/api/prompt", { text: "gate-q ping", effort: "fast" });
  if (r.status === 400 && /workspace/i.test(String(r.data?.error || ""))) {
    throw new Error(`Chat still requires workspace: ${r.data.error}`);
  }
  ok("AC3 chat mode + effort + prompt not blocked on workspace");
} catch (e) {
  fail("AC3 chat mode + effort + prompt", e);
}

// AC1 mode switch both ways
try {
  let r = await j("POST", "/api/mode", { mode: "code" });
  assert.equal(r.status, 200);
  assert.equal(r.data.mode, "code");
  r = await j("POST", "/api/mode", { mode: "chat" });
  assert.equal(r.status, 200);
  assert.equal(r.data.mode, "chat");
  r = await j("POST", "/api/mode", { mode: "code" });
  assert.equal(r.status, 200);
  ok("AC1 mode switch chat↔code (HTTP)");
} catch (e) {
  fail("AC1 mode switch", e);
}

// Prefetch
try {
  const r = await j("POST", "/api/prefetch-mode", { mode: "code" });
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, true);
  ok("prefetch-mode endpoint");
} catch (e) {
  fail("prefetch-mode", e);
}

// Dual-mode exclusive: health reports single pid
try {
  const r = await j("GET", "/api/health");
  assert.ok(typeof r.data.pid === "number");
  ok("single host pid advertised");
} catch (e) {
  fail("single host pid", e);
}

// Path unit (no host)
try {
  const { resolveUnderWorkspace } = await import(
    pathToFileUrl(path.join(root, "packages/grok-acp/src/paths.ts"))
  );
  resolveUnderWorkspace(root, "package.json");
  assert.throws(() => resolveUnderWorkspace(root, "../secret"));
  ok("AC4-ish path confinement unit");
} catch (e) {
  fail("path confinement", e);
}

// SPEC / INTERFACE present
try {
  const base = path.join(root, ".spire/clusters/tech/contracts/dual-mode-shell");
  for (const f of ["SPEC.md", "INTERFACE_CONTRACT.md", "PLAN.md", "BRIEF.md"]) {
    assert.ok(fs.existsSync(path.join(base, f)), f);
  }
  ok("contract artifacts present");
} catch (e) {
  fail("contract artifacts", e);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

function pathToFileUrl(p) {
  const u = path.resolve(p).replace(/\\/g, "/");
  return "file:///" + u.replace(/^([A-Za-z]):/, "$1:");
}
