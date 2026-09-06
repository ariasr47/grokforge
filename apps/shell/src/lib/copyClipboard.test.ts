import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { writeClipboard } from "./copyClipboard.js";

describe("writeClipboard", () => {
  const original = navigator.clipboard;

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: original,
    });
  });

  it("falls back to navigator.clipboard when the Tauri plugin is absent", async () => {
    const writes: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          writes.push(text);
        },
      },
    });
    await writeClipboard("hello forge");
    assert.deepEqual(writes, ["hello forge"]);
  });
});
