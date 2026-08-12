import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatAttachBlock } from "./contextAttach.js";

describe("formatAttachBlock", () => {
  it("wraps name and text", () => {
    const s = formatAttachBlock({
      ok: true,
      name: "notes.txt",
      text: "hello",
      truncated: false,
    });
    assert.match(s, /Attached: notes\.txt/);
    assert.match(s, /hello/);
    assert.match(s, /End: notes\.txt/);
  });
});
