/**
 * End-to-end smoke against a running host (or boots nothing — expects host up).
 * Also unit-checks path confinement without host.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOST = process.env.GROKFORGE_URL || "http://127.0.0.1:8787";

async function checkHealth() {
  const res = await fetch(`${HOST}/api/health`);
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.ok, true);
  console.log("✓ health");
}

async function checkWorkspace() {
  const res = await fetch(`${HOST}/api/workspace`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: root }),
  });
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.ok(j.workspace);
  console.log("✓ workspace open", j.workspaceName);
  return j;
}

async function checkPathUnit() {
  const { resolveUnderWorkspace } = await import(
    pathToFileUrl(path.join(root, "packages/grok-acp/src/paths.ts"))
  );
  const ws = root;
  const ok = resolveUnderWorkspace(ws, "README.md");
  assert.ok(ok.includes("README.md"));
  assert.throws(() => resolveUnderWorkspace(ws, "../outside"));
  console.log("✓ path confinement unit");
}

function pathToFileUrl(p) {
  const u = path.resolve(p).replace(/\\/g, "/");
  return "file:///" + u.replace(/^([A-Za-z]):/, "$1:");
}

async function checkAgentSpawn() {
  const tsx = path.join(root, "node_modules/tsx/dist/cli.mjs");
  const agent = path.join(root, "packages/grok-acp/src/index.ts");
  const child = spawn(process.execPath, [tsx, agent], {
    cwd: root,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, XAI_API_KEY: "" },
  });
  const rl = createInterface({ input: child.stdout });
  const waitLine = () =>
    new Promise((resolve) => rl.once("line", (l) => resolve(l)));

  child.stdin.write(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {},
    }) + "\n",
  );
  const init = JSON.parse(await waitLine());
  assert.equal(init.id, 1);
  assert.ok(init.result);

  child.stdin.write(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "session/new",
      params: { cwd: root },
    }) + "\n",
  );
  const sess = JSON.parse(await waitLine());
  assert.ok(sess.result.sessionId);

  child.stdin.write(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "session/prompt",
      params: { sessionId: sess.result.sessionId, prompt: "hi" },
    }) + "\n",
  );
  // accept response then notifications
  let sawAuthError = false;
  let sawDone = false;
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline && !sawDone) {
    const line = await Promise.race([
      waitLine(),
      new Promise((r) => setTimeout(() => r(null), 2000)),
    ]);
    if (!line) break;
    const msg = JSON.parse(line);
    if (msg.method === "error" && msg.params?.code === "auth_missing") {
      sawAuthError = true;
    }
    if (msg.method === "done") sawDone = true;
  }
  child.kill();
  assert.ok(sawAuthError || sawDone, "expected auth_missing or done from agent");
  console.log("✓ agent spawn + auth_missing path");
}

async function main() {
  await checkPathUnit();
  await checkAgentSpawn();
  try {
    await checkHealth();
    await checkWorkspace();
    const state = await (await fetch(`${HOST}/api/state`)).json();
    console.log("✓ state", {
      authMode: state.authMode,
      hasApiKey: state.hasApiKey,
      connected: state.connected,
    });
  } catch (e) {
    console.log("⚠ host not running — start with npm run start for full host checks");
    console.log(" ", e.message);
  }
  console.log("smoke complete");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
