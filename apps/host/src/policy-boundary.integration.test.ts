import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { WorkspacePolicyStore } from "./workspace-policy.js";
import { startHost } from "./test-support/host-process.js";

async function freePort() { const s=net.createServer(); await new Promise<void>((resolve,reject)=>s.listen(0,"127.0.0.1",resolve).on("error",reject)); const p=(s.address() as net.AddressInfo).port; await new Promise<void>(resolve=>s.close(()=>resolve())); return p; }

test("workspace policy falls back to confirmed Review and persists Trusted atomically", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rar-policy-"));
  const workspace = path.join(root, "ws"); await fs.mkdir(workspace);
  const store = new WorkspacePolicyStore(path.join(root, "data"), () => "rev-test");
  const initial = await store.read(workspace);
  assert.equal(initial.effectiveMode, "review"); assert.equal(initial.source, "fallback"); assert.equal(initial.fallbackReason, "missing");
  const saved = await store.save(workspace, "trusted_workspace");
  assert.equal(saved.effectiveMode, "trusted_workspace");
  assert.equal((await store.read(workspace)).revision, "rev-test");
  await fs.rm(root, { recursive: true, force: true });
});

test("real host reload hydrates saved Trusted policy before first state", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "rar-policy-reload-"));
  const sessionId = "policy-reload-session";
  const first = await startHost({port: await freePort(), homeDir: home});
  try {
    const initial = await (await fetch(`${first.baseUrl}/api/state`)).json() as any;
    const saved = await fetch(`${first.baseUrl}/api/workspace-policy`, {method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({sessionId, workspace:initial.workspace, mode:"trusted_workspace"})});
    assert.equal(saved.status, 200);
  } finally { await first.stopProcess(); }
  const second = await startHost({port: await freePort(), homeDir: home});
  try {
    const state = await (await fetch(`${second.baseUrl}/api/state`)).json() as any;
    assert.equal(state.workspace, state.permissionPolicy.workspace);
    assert.equal(state.permissionPolicy.effectiveMode, "trusted_workspace");
    assert.equal(state.permissionPolicy.source, "saved");
    assert.equal(state.permissionPolicy.savedForWorkspace, true);
    const stableSave = await fetch(`${second.baseUrl}/api/workspace-policy`, {method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({sessionId, workspace:state.workspace, mode:"trusted_workspace"})});
    assert.equal(stableSave.status, 200);
    const stable = await (await fetch(`${second.baseUrl}/api/state?sessionId=${sessionId}`)).json() as any;
    assert.equal(stable.permissionPolicy.effectiveMode, "trusted_workspace");
  } finally { await second.stop(); await fs.rm(home, {recursive:true, force:true}); }
});

test("legacy state refreshes after a stable-session policy save on the same host", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "rar-policy-same-host-"));
  const host = await startHost({port: await freePort(), homeDir: home});
  try {
    const initial = await (await fetch(`${host.baseUrl}/api/state`)).json() as any;
    assert.equal(initial.permissionPolicy.effectiveMode, "review");
    const saved = await fetch(`${host.baseUrl}/api/workspace-policy`, {method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({sessionId:"stable-policy-session", workspace:initial.workspace, mode:"trusted_workspace"})});
    assert.equal(saved.status, 200);
    const legacy = await (await fetch(`${host.baseUrl}/api/state`)).json() as any;
    assert.equal(legacy.permissionPolicy.effectiveMode, "trusted_workspace");
    assert.equal(legacy.permissionPolicy.source, "saved");
  } finally { await host.stop(); await fs.rm(home, {recursive:true, force:true}); }
});
