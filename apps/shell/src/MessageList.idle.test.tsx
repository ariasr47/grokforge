import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { cleanup, render, screen } from "@testing-library/react";
import {
  MessageList,
  TURN_IDLE_COPY,
  waitHeading,
  WAITING_PLACEHOLDER_HEAD,
} from "./MessageList";

afterEach(() => cleanup());

test("idle delimiter is a short Your turn, not a shouted instruction", () => {
  render(<MessageList messages={[]} showTurnDelimiter busy={false} />);
  assert.equal(TURN_IDLE_COPY, "Your turn");
  assert.ok(screen.getByText(TURN_IDLE_COPY));
  assert.equal(screen.queryByText(/type the next message/i), null);
});

test("wait chrome uses locked Waiting for model…, not retired Thinking field", () => {
  render(<MessageList messages={[]} busy />);
  assert.ok(screen.getByText(WAITING_PLACEHOLDER_HEAD));
  assert.equal(screen.queryByText("Thinking field"), null);
  assert.equal(screen.queryByText("Thinking field…"), null);
});

test("wait chrome prefers the live detail as the heading", () => {
  render(<MessageList messages={[]} busy thinkingDetail="Recovering run…" />);
  assert.ok(screen.getByText("Recovering run…"));
  assert.equal(screen.queryByText("Thinking field"), null);
});

test("F1 wait copy never shouts WAITING FOR GROK or effort", () => {
  assert.equal(waitHeading(null), WAITING_PLACEHOLDER_HEAD);
  assert.equal(waitHeading("Waiting for Grok (heavy effort)…"), WAITING_PLACEHOLDER_HEAD);
  assert.equal(waitHeading("Waiting for Grok…"), WAITING_PLACEHOLDER_HEAD);
  assert.doesNotMatch(waitHeading("Waiting for Grok (heavy effort)…"), /Grok/i);
  render(<MessageList messages={[]} busy thinkingDetail="Waiting for Grok (heavy effort)…" />);
  assert.ok(screen.getByText(WAITING_PLACEHOLDER_HEAD));
  assert.equal(screen.queryByText(/Waiting for Grok/i), null);
});
