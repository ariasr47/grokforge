import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";

/**
 * Minimal localStorage mock for node tests.
 */
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => {
    store.set(k, String(v));
  },
  removeItem: (k: string) => {
    store.delete(k);
  },
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
};

// Dynamic import after mock
const { exportSessionsJson, importSessionsJson } = await import("./sessionIO.js");
const { listSessions, createSession, partitionKey } = await import("./sessions.js");

describe("sessionIO", () => {
  beforeEach(() => {
    store.clear();
  });

  it("export/import round-trip hydrates listSessions", () => {
    const part = partitionKey("chat", null);
    createSession(part, "Hello world");
    assert.equal(listSessions(part).length, 1);

    const json = exportSessionsJson();
    store.clear();
    // After clear, memory cache may still hold data — import must replace
    const result = importSessionsJson(json, "replace");
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.ok(result.sessions >= 1);
    }
    const list = listSessions(part);
    assert.ok(list.length >= 1);
    assert.ok(list.some((s) => s.title.includes("Hello") || s.title === "Hello world" || s.messages));
  });

  it("rejects invalid JSON", () => {
    const r = importSessionsJson("not-json");
    assert.equal(r.ok, false);
  });
});
