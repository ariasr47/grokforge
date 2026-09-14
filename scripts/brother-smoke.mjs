/**
 * Brother dogfood smoke: host health + Grok connectors honesty.
 * Does not require Grok auth. Paste-catalog token/test is parked.
 */
const BASE = process.env.GROKFORGE_HOST || "http://127.0.0.1:8787";

async function get(path) {
  const r = await fetch(`${BASE}${path}`);
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json();
}

const fails = [];
function ok(name) {
  console.log(`  PASS  ${name}`);
}
function fail(name, e) {
  fails.push(name);
  console.error(`  FAIL  ${name}: ${e?.message || e}`);
}

console.log(`Brother smoke → ${BASE}\n`);

try {
  const health = await get("/api/health");
  if (!health.ok) throw new Error("health not ok");
  ok("GET /api/health");
} catch (e) {
  fail("GET /api/health", e);
  process.exit(1);
}

try {
  const state = await get("/api/state");
  ok(`GET /api/state (mode=${state.mode || state.productMode || "?"})`);
} catch (e) {
  fail("GET /api/state", e);
}

try {
  const body = await get("/api/connectors");
  if (body.linkedStatus !== "unknown") {
    throw new Error(`linkedStatus ${body.linkedStatus}`);
  }
  if (body.chatUsesGrokConnectors !== false) {
    throw new Error("chat must not claim grok.com connectors");
  }
  if (body.manageUrl !== "https://grok.com/connectors") {
    throw new Error(`manageUrl ${body.manageUrl}`);
  }
  if (Array.isArray(body.connectors)) {
    throw new Error("paste catalog must not ship as connectors[]");
  }
  if (!Array.isArray(body.catalogDocs) || !body.catalogDocs.includes("Gmail")) {
    throw new Error("catalogDocs missing Gmail");
  }
  ok("GET /api/connectors honesty");
} catch (e) {
  fail("connectors honesty", e);
}

try {
  const r = await fetch(`${BASE}/api/connectors/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: "gmail" }),
  });
  if (r.status !== 410) throw new Error(`expected 410, got ${r.status}`);
  ok("POST /api/connectors/test parked 410");
} catch (e) {
  fail("test parked", e);
}

console.log("");
if (fails.length) {
  console.error(`Brother smoke FAILED (${fails.length})`);
  process.exit(1);
}
console.log("Brother smoke PASS");
