/**
 * Live GET /api/health installerSha256 (INTERFACE_CONTRACT.md).
 * Isolated ports only — never 8787.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { APP_VERSION } from "./build-version.js";
import { startHost, type StartedHost } from "./test-support/host-process.js";

const HEX =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) =>
    server.listen(0, "127.0.0.1", resolve).on("error", reject),
  );
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function writePin(dataDir: string, version: string, sha256: string): void {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    path.join(dataDir, "installer-digest.pin"),
    `version=${version}\nsha256=${sha256}\n`,
    "utf8",
  );
}

async function health(baseUrl: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${baseUrl}/api/health`);
  assert.equal(res.status, 200);
  return (await res.json()) as Record<string, unknown>;
}

describe("GET /api/health installerSha256 — live from-source host", () => {
  let host: StartedHost;

  before(async () => {
    host = await startHost({ port: await freePort() });
  });
  after(async () => {
    await host.stop();
  });

  it("fresh host with no pin emits installerSha256: null (key present)", async () => {
    const body = await health(host.baseUrl);
    assert.equal(Object.hasOwn(body, "installerSha256"), true);
    assert.equal(body.installerSha256, null);
    assert.equal(Object.hasOwn(body, "signed"), false);
  });

  it("matching pin Version + lowercase hex is vouched on health", async () => {
    writePin(host.dataDir, APP_VERSION, HEX);
    const body = await health(host.baseUrl);
    assert.equal(body.installerSha256, HEX);
    assert.equal(body.version, APP_VERSION);
  });

  it("Version mismatch yields null (not the prior hex)", async () => {
    writePin(host.dataDir, "0.6.5", HEX);
    const body = await health(host.baseUrl);
    assert.equal(body.installerSha256, null);
  });
});
