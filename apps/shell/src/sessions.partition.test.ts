import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isChatPartition, partitionKey } from "./sessions.js";

describe("partitionKey", () => {
  it("normalizes chat sandbox variants", () => {
    assert.equal(partitionKey("chat", null), "chat:__sandbox__");
    assert.equal(partitionKey("chat", ""), "chat:__sandbox__");
    assert.equal(
      partitionKey("chat", "C:\\Users\\x\\.grokforge\\chat-sandbox"),
      "chat:__sandbox__",
    );
    assert.equal(
      partitionKey("chat", "D:\\docs"),
      "chat:D:\\docs",
    );
  });

  it("uses workspace path for code", () => {
    assert.equal(partitionKey("code", null), "__no_workspace__");
    assert.equal(partitionKey("code", "C:\\Dev\\app"), "C:\\Dev\\app");
  });
});

describe("isChatPartition", () => {
  it("detects chat keys", () => {
    assert.equal(isChatPartition("chat:__sandbox__"), true);
    assert.equal(isChatPartition("C:\\Dev"), false);
  });
});
