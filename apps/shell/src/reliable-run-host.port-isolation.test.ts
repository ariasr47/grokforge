import test from "node:test";
import assert from "node:assert/strict";
import { startReliableRunHost, type ReliableRunHost } from "./test-support/reliable-run-host";

/**
 * The harness used to pick its port at random from a fixed 1000-wide range with
 * no collision check. When two hosts drew the same number the loser died on
 * bind while the winner kept answering `/api/health`, so the loser's test
 * silently drove a FOREIGN host — different data dir, different fixture agent —
 * and failed minutes later as `run event timeout`. Nothing in the suite could
 * see that, which is why it read as unexplained flake for so long.
 *
 * Both guarantees below are invisible when they hold and silent when they
 * break, so they are asserted rather than left to review.
 */

const closeAll = async (hosts: ReliableRunHost[]) => {
  for (const host of hosts) await host.close().catch(() => undefined);
};

test("concurrent hosts never share a port, and each answers as its own child", { timeout: 90_000 }, async () => {
  const hosts = await Promise.all([
    startReliableRunHost(),
    startReliableRunHost(),
    startReliableRunHost(),
  ]);
  try {
    const ports = hosts.map((host) => Number(new URL(host.baseUrl).port));
    assert.equal(new Set(ports).size, ports.length, `two hosts bound the same port: ${ports.join(", ")}`);

    // Identity, not just reachability: a port that answers is worthless if the
    // process answering it belongs to somebody else.
    for (const host of hosts) {
      const health = await (await fetch(`${host.baseUrl}/api/health`)).json() as { pid: number; port: number };
      assert.equal(health.pid, host.process.pid, `${host.baseUrl} is served by pid ${health.pid}, not our child ${host.process.pid}`);
      assert.equal(health.port, Number(new URL(host.baseUrl).port), "health must report the port it actually bound");
    }
  } finally {
    await closeAll(hosts);
  }
});

test("a port already owned by another host fails loudly instead of driving that host", { timeout: 90_000 }, async () => {
  const owner = await startReliableRunHost();
  const takenPort = Number(new URL(owner.baseUrl).port);
  try {
    await assert.rejects(
      () => startReliableRunHost("", takenPort),
      (error: unknown) => {
        const message = String(error instanceof Error ? error.message : error);
        assert.match(message, /already in use|EADDRINUSE|foreign host/i, `startup failure must name the cause, got: ${message}`);
        return true;
      },
      "a host that cannot bind must reject, never hand back the stranger already on that port",
    );
  } finally {
    await owner.close();
  }
});
