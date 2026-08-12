/**
 * Brother dogfood smoke: host health + connectors catalog + paste workflows.
 * Does not require Grok auth or live Notion token.
 */
const BASE = process.env.GROKFORGE_HOST || "http://127.0.0.1:8787";

async function get(path) {
  const r = await fetch(`${BASE}${path}`);
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json();
}

async function post(path, body = {}) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path} → ${r.status} ${await r.text()}`);
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
  const { connectors } = await get("/api/connectors");
  if (!Array.isArray(connectors) || connectors.length < 4) {
    throw new Error(`expected ≥4 connectors, got ${connectors?.length}`);
  }
  const ids = connectors.map((c) => c.id).sort().join(",");
  ok(`GET /api/connectors (${connectors.length}: ${ids})`);

  const gmail = connectors.find((c) => c.id === "gmail");
  if (!gmail?.samplePrompt || gmail.status !== "paste_workflow") {
    throw new Error("gmail paste workflow missing");
  }
  ok("gmail paste_workflow + sample");

  const local = connectors.find((c) => c.id === "local-files");
  if (local?.status !== "live") throw new Error("local-files should be live");
  ok("local-files live");
} catch (e) {
  fail("connectors catalog", e);
}

try {
  const t = await post("/api/connectors/test", { id: "local-files" });
  if (!t.ok) throw new Error(t.message);
  ok("POST /api/connectors/test local-files");
} catch (e) {
  fail("test local-files", e);
}

try {
  const t = await post("/api/connectors/test", { id: "gmail" });
  if (!t.ok) throw new Error(t.message);
  ok("POST /api/connectors/test gmail (paste path)");
} catch (e) {
  fail("test gmail", e);
}

try {
  const t = await post("/api/connectors/test", { id: "notion" });
  // no token → ok false is expected
  if (t.ok) ok("notion test (token present — live)");
  else ok(`notion test without token (expected fail): ${t.message?.slice(0, 60)}`);
} catch (e) {
  fail("test notion", e);
}

console.log("");
if (fails.length) {
  console.error(`Brother smoke FAILED (${fails.length})`);
  process.exit(1);
}
console.log("Brother smoke PASS");
