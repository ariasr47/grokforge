import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import net from "node:net";
import { startHost } from "./test-support/host-process.js";

async function freePort() {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => server.listen(0, "127.0.0.1", resolve).on("error", reject));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}

test("edit recovery refuses a durable edit owned by another run before filesystem effect", async () => {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "grok-edit-recovery-owner-"));
  const host = await startHost({
    port: await freePort(),
    homeDir,
    env: {
      GROKFORGE_AGENT_ENTRY: path.resolve("apps/host/src/test-support/fake-acp-agent.mjs"),
      GROKFORGE_FIXTURE: "long-run",
      XAI_API_KEY: "fixture",
    },
  });
  try {
    const sessionId = "owner-session";
    const prompt = await fetch(`${host.baseUrl}/api/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, text: "hold run", effort: "auto", history: [] }),
    });
    assert.equal(prompt.status, 202);
    const runId = (await prompt.json() as any).run.runId as string;

    const target = path.join(homeDir, "victim.txt");
    await fs.writeFile(target, "after\n", "utf8");
    const editId = "cross-run-edit";
    await fs.mkdir(path.join(host.dataDir, "edit-recovery"), { recursive: true });
    await fs.writeFile(path.join(host.dataDir, "edit-recovery", `${editId}.json`), JSON.stringify({
      editId,
      workspace: homeDir,
      target,
      before: "before\n",
      beforeHash: "ignored",
      afterHash: crypto.createHash("sha256").update("after\n").digest("hex"),
      diff: "-before\\n+after\\n",
      runId: "different-run",
      invocationId: "invocation",
      policy: "review",
      status: "applied",
    }), "utf8");
    const before = await fs.readFile(target, "utf8");

    const recovery = await fetch(`${host.baseUrl}/api/edit-recovery`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, runId, editId }),
    });
    assert.notEqual(recovery.status, 200);
    assert.equal((await recovery.json() as any).code, "recovery_unavailable");
    assert.equal(await fs.readFile(target, "utf8"), before);

    const foreign = await fetch(`${host.baseUrl}/api/edit-recovery`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "foreign-session", runId, editId }),
    });
    assert.notEqual(foreign.status, 200);
    assert.equal(await fs.readFile(target, "utf8"), before);

    const sameRunEdit = "same-run-edit";
    await fs.writeFile(target, "after-same\n", "utf8");
    await fs.writeFile(path.join(host.dataDir, "edit-recovery", `${sameRunEdit}.json`), JSON.stringify({
      editId: sameRunEdit,
      workspace: homeDir,
      target,
      before: "before-same\n",
      beforeHash: crypto.createHash("sha256").update("before-same\n").digest("hex"),
      afterHash: crypto.createHash("sha256").update("after-same\n").digest("hex"),
      diff: "-before-same\\n+after-same\\n",
      runId,
      invocationId: "invocation-same",
      policy: "review",
      status: "applied",
    }), "utf8");
    const positive = await fetch(`${host.baseUrl}/api/edit-recovery`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, runId, editId: sameRunEdit }),
    });
    assert.equal(positive.status, 200);
    assert.equal(await fs.readFile(target, "utf8"), "before-same\n");
  } finally {
    await host.stop();
  }
});
