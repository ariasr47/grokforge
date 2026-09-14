import { SYSTEM_PROMPT } from "./xai";
import assert from "node:assert";
import test from "node:test";

test("SYSTEM_PROMPT forbids whole-file re-reads", () => {
  assert.match(SYSTEM_PROMPT, /Never re-read the same whole file more than once/);
  assert.match(
    SYSTEM_PROMPT,
    /Rules:[\s\S]*Never re-read the same whole file more than once/,
  );
  assert.match(SYSTEM_PROMPT, /After a tool result, write a short final/);
});