import assert from "node:assert/strict";
import test from "node:test";
import { sessionChromeModel } from "./sessionChromeModel.js";

test("after reload, last run appliedModel beats session.model (live grok-4-fast vs grok-4-fast-non-reasoning)", () => {
  assert.equal(
    sessionChromeModel({
      appliedModel: null,
      lastRunAppliedModel: "grok-4-fast-non-reasoning",
      sessionModel: "grok-4-fast",
      draft: "grok-4-fast",
    }),
    "grok-4-fast-non-reasoning",
  );
});

test("live session appliedModel still wins over last run", () => {
  assert.equal(
    sessionChromeModel({
      appliedModel: "grok-4",
      lastRunAppliedModel: "grok-4-fast-non-reasoning",
      sessionModel: "grok-4-fast",
    }),
    "grok-4",
  );
});

test("blank strings are not a model id", () => {
  assert.equal(
    sessionChromeModel({
      appliedModel: "  ",
      lastRunAppliedModel: null,
      sessionModel: "grok-4-fast",
    }),
    "grok-4-fast",
  );
});
