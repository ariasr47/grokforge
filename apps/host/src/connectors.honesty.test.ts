import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import net from "node:net";
import {
  GROK_CONNECTORS_MANAGE_URL,
  grokConnectorsView,
} from "./connectors.js";
import { startHost, type StartedHost } from "./test-support/host-process.js";

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) =>
    server.listen(0, "127.0.0.1", resolve).on("error", reject),
  );
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

describe("grokConnectorsView", () => {
  it("never lists a Forge catalog or connected badges", () => {
    const view = grokConnectorsView();
    assert.equal(view.linkedStatus, "unknown");
    assert.equal(view.chatUsesGrokConnectors, false);
    assert.equal(view.manageUrl, GROK_CONNECTORS_MANAGE_URL);
    assert.ok(view.catalogDocs.includes("Gmail"));
    assert.equal(Object.hasOwn(view, "connectors"), false);
  });
});

describe("GET /api/connectors — honesty, not paste catalog", () => {
  let host: StartedHost;

  before(async () => {
    host = await startHost({ port: await freePort() });
  });
  after(async () => {
    await host.stop();
  });

  it("returns unknown linked status and no connectors array", async () => {
    const res = await fetch(`${host.baseUrl}/api/connectors`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.linkedStatus, "unknown");
    assert.equal(body.chatUsesGrokConnectors, false);
    assert.equal(body.manageUrl, GROK_CONNECTORS_MANAGE_URL);
    assert.equal(Object.hasOwn(body, "connectors"), false);
    assert.ok(Array.isArray(body.catalogDocs));
  });

  it("parks token and test writes", async () => {
    const token = await fetch(`${host.baseUrl}/api/connectors/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "notion", token: "secret" }),
    });
    assert.equal(token.status, 410);
    const test = await fetch(`${host.baseUrl}/api/connectors/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "gmail" }),
    });
    assert.equal(test.status, 410);
  });
});
