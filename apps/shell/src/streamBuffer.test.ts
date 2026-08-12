import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { StreamBuffer } from "./streamBuffer.js";

describe("StreamBuffer", () => {
  it("batches pushes into one flush via timer fallback", async () => {
    const chunks: string[] = [];
    // Node has no rAF — uses setTimeout(32)
    const buf = new StreamBuffer((t) => chunks.push(t));
    buf.push("a");
    buf.push("b");
    buf.push("c");
    assert.deepEqual(chunks, []);
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(chunks, ["abc"]);
  });

  it("reset drops unflushed text", async () => {
    const chunks: string[] = [];
    const buf = new StreamBuffer((t) => chunks.push(t));
    buf.push("gone");
    buf.reset();
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(chunks, []);
  });

  it("flush emits immediately", () => {
    const chunks: string[] = [];
    const buf = new StreamBuffer((t) => chunks.push(t));
    buf.push("x");
    buf.flush();
    assert.deepEqual(chunks, ["x"]);
  });
});
