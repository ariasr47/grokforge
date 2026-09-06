import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseRunEventEnvelope } from "./runEventSchema.js";

describe("parseRunEventEnvelope", () => {
  it("accepts a v1 answer_delta and keeps extra fields", () => {
    const parsed = parseRunEventEnvelope({
      schemaVersion: 1,
      eventSeq: 2,
      sessionId: "s",
      runId: "r",
      type: "answer_delta",
      connectionGeneration: 1,
      occurredAt: "",
      payload: { kind: "answer_delta", segmentId: "a", delta: "hi" },
      extra: true,
    });
    assert.ok(parsed);
    assert.equal(parsed!.payload.kind, "answer_delta");
    assert.equal((parsed as { extra?: boolean }).extra, true);
  });

  it("rejects a missing payload kind", () => {
    assert.equal(
      parseRunEventEnvelope({
        schemaVersion: 1,
        eventSeq: 1,
        sessionId: "s",
        runId: "r",
        type: "answer_delta",
        connectionGeneration: 1,
        occurredAt: "",
        payload: {},
      }),
      null,
    );
  });
});
