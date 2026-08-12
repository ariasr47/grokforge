import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_SESSION_MESSAGES,
  trimSessionMessages,
} from "./server.js";
import type { ChatMessage } from "./xai.js";

function m(role: ChatMessage["role"], content: string): ChatMessage {
  return { role, content };
}

describe("trimSessionMessages", () => {
  it("keeps system + most recent when over cap", () => {
    const messages: ChatMessage[] = [m("system", "sys")];
    for (let i = 0; i < MAX_SESSION_MESSAGES + 20; i++) {
      messages.push(m(i % 2 === 0 ? "user" : "assistant", `t${i}`));
    }
    const before = messages.length;
    trimSessionMessages(messages);
    assert.ok(before > MAX_SESSION_MESSAGES);
    assert.equal(messages.length, MAX_SESSION_MESSAGES);
    assert.equal(messages[0]?.role, "system");
    assert.equal(messages[0]?.content, "sys");
    assert.equal(
      messages[messages.length - 1]?.content,
      `t${MAX_SESSION_MESSAGES + 19}`,
    );
  });

  it("no-ops under cap", () => {
    const messages = [m("system", "s"), m("user", "u")];
    trimSessionMessages(messages);
    assert.equal(messages.length, 2);
  });
});
