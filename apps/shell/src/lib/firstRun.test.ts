import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";

const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => {
    store.set(k, String(v));
  },
  removeItem: (k) => {
    store.delete(k);
  },
  clear: () => store.clear(),
  key: (i) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
};

const { isOnboardingDone, patchFirstRun, loadFirstRun } = await import(
  "./firstRun.js"
);

describe("isOnboardingDone", () => {
  beforeEach(() => store.clear());

  it("chat completes without folder", () => {
    patchFirstRun({ signedIn: true, sentMessage: true, openedFolder: false });
    assert.equal(isOnboardingDone(loadFirstRun(), "chat"), true);
  });

  it("code requires folder", () => {
    patchFirstRun({ signedIn: true, sentMessage: true, openedFolder: false });
    assert.equal(isOnboardingDone(loadFirstRun(), "code"), false);
    patchFirstRun({ openedFolder: true });
    assert.equal(isOnboardingDone(loadFirstRun(), "code"), true);
  });

  it("dismissed always done", () => {
    patchFirstRun({ dismissed: true });
    assert.equal(isOnboardingDone(loadFirstRun(), "code"), true);
  });
});
