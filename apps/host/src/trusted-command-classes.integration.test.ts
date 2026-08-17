import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { startHost } from "./test-support/host-process.js";
import { AgentSession } from "./session.js";

async function freePort() {
  const s = net.createServer();
  await new Promise<void>((resolve, reject) =>
    s.listen(0, "127.0.0.1", resolve).on("error", reject),
  );
  const p = (s.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => s.close(() => resolve()));
  return p;
}

test("catalog GET and invalid workspace GET/POST", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "tcc-http-"));
  const host = await startHost({ port: await freePort(), homeDir: home });
  try {
    const cat = await (await fetch(`${host.baseUrl}/api/trusted-command-class-catalog`)).json() as any;
    assert.equal(cat.catalog.length, 7);
    assert.ok(cat.catalog.every((e: any) => typeof e.id === "string" && typeof e.label === "string"));

    const badGet = await fetch(`${host.baseUrl}/api/trusted-command-classes?workspace=.`);
    assert.equal(badGet.status, 400);
    const badGetBody = await badGet.json() as any;
    assert.equal(typeof badGetBody.error, "string");
    assert.equal(typeof badGetBody.code, "string");
    assert.equal(typeof badGetBody.retryable, "boolean");
    assert.ok("runId" in badGetBody);

    const badPost = await fetch(`${host.baseUrl}/api/trusted-command-classes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: "conformance-missing-session",
        workspace: ".",
        classes: [],
        expectedRevision: "conformance",
      }),
    });
    assert.equal(badPost.status, 400);
  } finally {
    await host.stop();
    await fs.rm(home, { recursive: true, force: true });
  }
});

test("save / re-GET / CAS conflict / cross-workspace isolation / restart durability", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "tcc-persist-"));
  const wsA = path.join(home, "ws-a");
  const wsB = path.join(home, "ws-b");
  await fs.mkdir(wsA);
  await fs.mkdir(wsB);
  const sessionId = "tcc-session-a";
  const first = await startHost({ port: await freePort(), homeDir: home });
  try {
    const empty = await (
      await fetch(
        `${first.baseUrl}/api/trusted-command-classes?workspace=${encodeURIComponent(wsA)}`,
      )
    ).json() as any;
    assert.equal(empty.classes.fallbackReason, "missing");
    assert.deepEqual(empty.classes.classes, []);

    const saved = await fetch(`${first.baseUrl}/api/trusted-command-classes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId,
        workspace: wsA,
        classes: ["npm", "git:show"],
        expectedRevision: empty.classes.revision,
      }),
    });
    assert.equal(saved.status, 200);
    const savedBody = await saved.json() as any;
    assert.equal(savedBody.classes.source, "saved");
    assert.deepEqual(savedBody.classes.classes.slice().sort(), ["git:show", "npm"]);

    const conflict = await fetch(`${first.baseUrl}/api/trusted-command-classes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId,
        workspace: wsA,
        classes: ["cargo"],
        expectedRevision: "fallback",
      }),
    });
    assert.equal(conflict.status, 409);

    const b = await (
      await fetch(
        `${first.baseUrl}/api/trusted-command-classes?workspace=${encodeURIComponent(wsB)}`,
      )
    ).json() as any;
    assert.deepEqual(b.classes.classes, []);
    assert.equal(b.classes.fallbackReason, "missing");
  } finally {
    await first.stopProcess();
  }

  const second = await startHost({ port: await freePort(), homeDir: home });
  try {
    const re = await (
      await fetch(
        `${second.baseUrl}/api/trusted-command-classes?workspace=${encodeURIComponent(wsA)}`,
      )
    ).json() as any;
    assert.deepEqual(re.classes.classes.slice().sort(), ["git:show", "npm"]);
    assert.equal(re.classes.source, "saved");
  } finally {
    await second.stop();
    await fs.rm(home, { recursive: true, force: true });
  }
});

test("mid-run save is refused and does not mutate the store", async () => {
  const s = Object.create(AgentSession.prototype) as any;
  s.activeRunId = "run-live";
  s.runCoordinator = { get: () => ({ state: "running" }) };
  s.workspace = "C:\\bound";
  s.trustedClassesSnapshot = [];
  s.trustedClassesView = null;
  s.trustedCommandClasses = {
    save: async () => {
      throw new Error("store must not be written while a run is active");
    },
  };
  await assert.rejects(
    () => s.saveTrustedCommandClasses("C:\\bound", ["npm"], "fallback"),
    (e: any) => e?.code === "run_active",
  );
  assert.deepEqual(s.trustedClassesSnapshot, []);
});

test("W2 wrong-workspace save does not refresh the bound snapshot", async () => {
  const s = Object.create(AgentSession.prototype) as any;
  s.activeRunId = null;
  s.runCoordinator = { get: () => undefined };
  s.workspace = "C:\\bound-b";
  s.trustedClassesSnapshot = [];
  s.trustedClassesView = null;
  s.getState = () => ({});
  s.emit = () => {};
  const saved = {
    status: "confirmed",
    workspace: "C:\\posted-a",
    classes: ["npm"],
    revision: "rev-a",
    source: "saved",
    fallbackReason: null,
    savedForWorkspace: true,
    catalog: [],
  };
  s.trustedCommandClasses = { save: async () => saved };
  const result = await s.saveTrustedCommandClasses("C:\\posted-a", ["npm"], "fallback");
  assert.deepEqual(result.classes, ["npm"]);
  assert.deepEqual(s.trustedClassesSnapshot, []);
  assert.equal(s.trustedClassesView, null);
});

test("W2 same-workspace idle save refreshes the bound snapshot", async () => {
  const s = Object.create(AgentSession.prototype) as any;
  s.activeRunId = null;
  s.runCoordinator = { get: () => undefined };
  s.workspace = "C:\\bound-a";
  s.trustedClassesSnapshot = [];
  s.trustedClassesView = null;
  s.getState = () => ({});
  s.emit = () => {};
  const saved = {
    status: "confirmed",
    workspace: "C:\\bound-a",
    classes: ["npm", "cargo"],
    revision: "rev-bound",
    source: "saved",
    fallbackReason: null,
    savedForWorkspace: true,
    catalog: [],
  };
  s.trustedCommandClasses = { save: async () => saved };
  await s.saveTrustedCommandClasses("C:\\bound-a", ["npm", "cargo"], "fallback");
  assert.deepEqual(s.trustedClassesSnapshot, ["npm", "cargo"]);
  assert.equal(s.trustedClassesView, saved);
});

test("POST free-form class id is rejected without a write", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "tcc-invalid-id-"));
  const ws = path.join(home, "ws");
  await fs.mkdir(ws);
  const host = await startHost({ port: await freePort(), homeDir: home });
  try {
    const empty = await (
      await fetch(`${host.baseUrl}/api/trusted-command-classes?workspace=${encodeURIComponent(ws)}`)
    ).json() as any;
    const rejected = await fetch(`${host.baseUrl}/api/trusted-command-classes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: "tcc-invalid-id",
        workspace: ws,
        classes: ["npm", "not-a-class"],
        expectedRevision: empty.classes.revision,
      }),
    });
    assert.equal(rejected.status, 400);
    const body = await rejected.json() as any;
    assert.match(String(body.code), /invalid_classes|invalid_request/);
    const again = await (
      await fetch(`${host.baseUrl}/api/trusted-command-classes?workspace=${encodeURIComponent(ws)}`)
    ).json() as any;
    assert.deepEqual(again.classes.classes, []);
    assert.equal(again.classes.fallbackReason, "missing");
  } finally {
    await host.stop();
    await fs.rm(home, { recursive: true, force: true });
  }
});
