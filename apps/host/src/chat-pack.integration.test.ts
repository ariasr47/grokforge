import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { startHost } from "./test-support/host-process.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fakeAgent = path.resolve(here, "./test-support/fake-acp-agent.mjs");

async function freePort() {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) =>
    server.listen(0, "127.0.0.1", resolve).on("error", reject),
  );
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function replayUntil(
  baseUrl: string,
  sessionId: string,
  runId: string,
  predicate: (body: any) => boolean,
) {
  for (let i = 0; i < 250; i++) {
    const response = await fetch(`${baseUrl}/api/runs/${runId}?sessionId=${sessionId}&after=0`);
    if (response.ok) {
      const body = await response.json();
      if (predicate(body)) return body;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`run ${runId} did not reach expected state`);
}

function chatPackEvents(body: any) {
  return (body.events ?? []).filter((event: any) => event.type === "chat_pack");
}

async function lastAcpPrompt(dataDir: string): Promise<string> {
  for (let i = 0; i < 50; i++) {
    try {
      return await fs.readFile(path.join(dataDir, "last-acp-prompt.txt"), "utf8");
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw new Error("fake agent did not record last ACP prompt");
}

test("Chat pin then send injects delimited pack on ACP prompt-side, not acceptedPrompt", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cp-int-inc-"));
  const host = await startHost({
    port: await freePort(),
    env: { GROKFORGE_AGENT_ENTRY: fakeAgent, XAI_API_KEY: "fixture" },
  });
  try {
    await fs.writeFile(path.join(root, "ok.txt"), "BODY", "utf8");
    const chatRoot = await fetch(host.baseUrl + "/api/chat-root", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: root }),
    });
    assert.equal(chatRoot.status, 200, await chatRoot.text());
    const sessionId = "chatpckin01";
    const conversationId = "home-a";
    const pin = await fetch(host.baseUrl + "/api/chat-pack", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId,
        conversationId,
        action: "hydrate",
        members: { files: [{ path: "ok.txt" }], note: "n1" },
      }),
    });
    const pinRaw = await pin.text();
    assert.equal(pin.status, 200, pinRaw);
    const pinBody = JSON.parse(pinRaw) as any;
    assert.equal(pinBody.chatPack.vouched, true);
    const prompt = await fetch(host.baseUrl + "/api/prompt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId,
        conversationId,
        text: "hello pack",
        effort: "auto",
        history: [],
      }),
    });
    const promptRaw = await prompt.text();
    assert.equal(prompt.status, 202, promptRaw);
    const admitted = JSON.parse(promptRaw) as any;
    assert.equal(admitted.run.acceptedPrompt.includes("## Chat pack"), false);
    const replay = await replayUntil(host.baseUrl, sessionId, admitted.run.runId, (body) =>
      chatPackEvents(body).length > 0 &&
      (body.events ?? []).some((e: any) => e.type === "run_terminal"),
    );
    const events = chatPackEvents(replay);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "chat_pack");
    assert.equal(events[0].payload.kind, "chat_pack");
    assert.equal(events[0].payload.chatPack.inclusion, "included");
    assert.equal(events[0].payload.chatPack.noteIncluded, true);
    const acp = await lastAcpPrompt(host.dataDir);
    assert.match(acp, /\n\n## Chat pack\n\n/);
    assert.match(acp, /### Note\n\nn1\n\n/);
    assert.match(acp, /### File: `ok\.txt`\n\nBODY\n\n/);
    assert.equal(acp.startsWith("hello pack"), true);

    const prompt2 = await fetch(host.baseUrl + "/api/prompt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId,
        conversationId,
        text: "second send",
        effort: "auto",
        history: [],
      }),
    });
    const prompt2Raw = await prompt2.text();
    assert.equal(prompt2.status, 202, prompt2Raw);
    const admitted2 = JSON.parse(prompt2Raw) as any;
    assert.equal(admitted2.run.acceptedPrompt.includes("## Chat pack"), false);
    const replay2 = await replayUntil(host.baseUrl, sessionId, admitted2.run.runId, (body) =>
      chatPackEvents(body).length > 0 &&
      (body.events ?? []).some((e: any) => e.type === "run_terminal"),
    );
    assert.equal(chatPackEvents(replay2)[0].payload.chatPack.inclusion, "included");
    const acp2 = await lastAcpPrompt(host.dataDir);
    assert.equal(acp2.startsWith("second send"), true);
    assert.match(acp2, /\n\n## Chat pack\n\n/);
  } finally {
    await host.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("outside-root pin is refused and does not invent membership", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cp-int-out-"));
  const host = await startHost({
    port: await freePort(),
    env: { GROKFORGE_AGENT_ENTRY: fakeAgent, XAI_API_KEY: "fixture" },
  });
  try {
    const chatRoot = await fetch(host.baseUrl + "/api/chat-root", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: root }),
    });
    assert.equal(chatRoot.status, 200, await chatRoot.text());
    const sessionId = "chatpckout1";
    const refused = await fetch(host.baseUrl + "/api/chat-pack", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId,
        conversationId: "home-a",
        action: "pin_file",
        path: "../escape.txt",
      }),
    });
    const raw = await refused.text();
    assert.equal(refused.status, 400, raw);
    const body = JSON.parse(raw) as { error?: string; code?: string; chatPack?: unknown };
    assert.equal(body.code, "chat_pack_pin_refused");
    assert.equal(body.chatPack, undefined);
    const state = (await (await fetch(host.baseUrl + `/api/state?sessionId=${sessionId}`)).json()) as any;
    assert.equal(state.chatPack.lastAttempt, "pin_failed");
    assert.deepEqual(state.chatPack.members.files, []);
  } finally {
    await host.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("send on B before hydrate journals unconfirmed and does not include A's pack", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cp-int-sw-"));
  const host = await startHost({
    port: await freePort(),
    env: { GROKFORGE_AGENT_ENTRY: fakeAgent, XAI_API_KEY: "fixture" },
  });
  try {
    await fs.writeFile(path.join(root, "a.txt"), "SECRET_A", "utf8");
    const chatRoot = await fetch(host.baseUrl + "/api/chat-root", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: root }),
    });
    assert.equal(chatRoot.status, 200, await chatRoot.text());
    const sessionId = "chatpcksw01";
    const pin = await fetch(host.baseUrl + "/api/chat-pack", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId,
        conversationId: "home-a",
        action: "hydrate",
        members: { files: [{ path: "a.txt" }], note: null },
      }),
    });
    assert.equal(pin.status, 200, await pin.text());
    const prompt = await fetch(host.baseUrl + "/api/prompt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId,
        conversationId: "home-b",
        text: "from B",
        effort: "auto",
        history: [],
      }),
    });
    const promptRaw = await prompt.text();
    assert.equal(prompt.status, 202, promptRaw);
    const admitted = JSON.parse(promptRaw) as any;
    const replay = await replayUntil(host.baseUrl, sessionId, admitted.run.runId, (body) =>
      chatPackEvents(body).length > 0 &&
      (body.events ?? []).some((e: any) => e.type === "run_terminal"),
    );
    const events = chatPackEvents(replay);
    assert.equal(events[0].payload.chatPack.inclusion, "unconfirmed");
    assert.equal(admitted.run.acceptedPrompt, "from B");
    const acp = await lastAcpPrompt(host.dataDir);
    assert.equal(acp.includes("SECRET_A"), false);
    assert.equal(acp.includes("## Chat pack"), false);
  } finally {
    await host.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("stale path at send journals materialization_fault path and injects none", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cp-int-flt-"));
  const host = await startHost({
    port: await freePort(),
    env: { GROKFORGE_AGENT_ENTRY: fakeAgent, XAI_API_KEY: "fixture" },
  });
  try {
    await fs.writeFile(path.join(root, "ok.txt"), "BODY", "utf8");
    const chatRoot = await fetch(host.baseUrl + "/api/chat-root", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: root }),
    });
    assert.equal(chatRoot.status, 200, await chatRoot.text());
    const sessionId = "chatpckflt1";
    const pin = await fetch(host.baseUrl + "/api/chat-pack", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId,
        conversationId: "home-a",
        action: "hydrate",
        members: { files: [{ path: "ok.txt" }], note: "n" },
      }),
    });
    assert.equal(pin.status, 200, await pin.text());
    await fs.rm(path.join(root, "ok.txt"));
    const prompt = await fetch(host.baseUrl + "/api/prompt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId,
        conversationId: "home-a",
        text: "stale",
        effort: "auto",
        history: [],
      }),
    });
    const promptRaw = await prompt.text();
    assert.equal(prompt.status, 202, promptRaw);
    const admitted = JSON.parse(promptRaw) as any;
    const replay = await replayUntil(host.baseUrl, sessionId, admitted.run.runId, (body) =>
      chatPackEvents(body).length > 0 &&
      (body.events ?? []).some((e: any) => e.type === "run_terminal"),
    );
    const voucher = chatPackEvents(replay)[0].payload.chatPack;
    assert.equal(voucher.inclusion, "materialization_fault");
    assert.equal(voucher.fault, "path");
    assert.equal(voucher.noteIncluded, false);
    const acp = await lastAcpPrompt(host.dataDir);
    assert.equal(acp.includes("## Chat pack"), false);
    assert.equal(acp.includes("BODY"), false);
  } finally {
    await host.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Code prompt does not journal chat_pack", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cp-int-code-"));
  const host = await startHost({
    port: await freePort(),
    env: { GROKFORGE_AGENT_ENTRY: fakeAgent, XAI_API_KEY: "fixture" },
  });
  try {
    await fs.writeFile(path.join(root, "AGENTS.md"), "Rule A\n", "utf8");
    const opened = await fetch(host.baseUrl + "/api/workspace", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: root }),
    });
    assert.equal(opened.status, 200, await opened.text());
    const sessionId = "chatpckcd01";
    const prompt = await fetch(host.baseUrl + "/api/prompt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId,
        conversationId: "home-a",
        text: "code hello",
        effort: "auto",
        history: [],
      }),
    });
    const promptRaw = await prompt.text();
    assert.equal(prompt.status, 202, promptRaw);
    const admitted = JSON.parse(promptRaw) as any;
    const replay = await replayUntil(host.baseUrl, sessionId, admitted.run.runId, (body) =>
      (body.events ?? []).some((e: any) => e.type === "run_terminal"),
    );
    assert.equal(chatPackEvents(replay).length, 0);
  } finally {
    await host.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});
