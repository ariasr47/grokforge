import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FrameFlush, StreamBuffer } from "./streamBuffer.js";

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

describe("FrameFlush", () => {
  it("batches pings into one flush via timer fallback", async () => {
    let n = 0;
    const flush = new FrameFlush(() => {
      n += 1;
    });
    flush.ping();
    flush.ping();
    flush.ping();
    assert.equal(n, 0);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(n, 1);
  });

  it("cancel drops a scheduled flush", async () => {
    let n = 0;
    const flush = new FrameFlush(() => {
      n += 1;
    });
    flush.ping();
    flush.cancel();
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(n, 0);
  });

  it("flush emits immediately when pending", () => {
    let n = 0;
    const flush = new FrameFlush(() => {
      n += 1;
    });
    flush.ping();
    flush.flush();
    assert.equal(n, 1);
  });

  it("flush is a no-op when nothing is pending", () => {
    let n = 0;
    const flush = new FrameFlush(() => {
      n += 1;
    });
    flush.flush();
    assert.equal(n, 0);
  });
});
