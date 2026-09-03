import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { cleanup, render, screen } from "@testing-library/react";
import {
  MessageList,
  waitHeading,
  WAITING_PLACEHOLDER_HEAD,
} from "./MessageList";

afterEach(() => cleanup());

test("idle transcript never paints the retired Your turn delimiter", () => {
  render(<MessageList messages={[]} busy={false} />);
  assert.equal(screen.queryByText("Your turn") === null, true);
  assert.equal(screen.queryByText(/type the next message/i) === null, true);
});

test("wait chrome uses locked Waiting for model…, not retired Thinking field", () => {
  render(<MessageList messages={[]} busy />);
  assert.ok(screen.getByText(WAITING_PLACEHOLDER_HEAD));
  assert.equal(screen.queryByText("Thinking field") === null, true);
  assert.equal(screen.queryByText("Thinking field…") === null, true);
});

test("wait chrome prefers the live detail as the heading", () => {
  render(<MessageList messages={[]} busy thinkingDetail="Recovering run…" />);
  assert.ok(screen.getByText("Recovering run…"));
  assert.equal(screen.queryByText("Thinking field") === null, true);
});

test("F1 wait copy never shouts WAITING FOR GROK or effort", () => {
  assert.equal(waitHeading(null), WAITING_PLACEHOLDER_HEAD);
  assert.equal(waitHeading("Waiting for Grok (heavy effort)…"), WAITING_PLACEHOLDER_HEAD);
  assert.equal(waitHeading("Waiting for Grok…"), WAITING_PLACEHOLDER_HEAD);
  assert.doesNotMatch(waitHeading("Waiting for Grok (heavy effort)…"), /Grok/i);
  render(<MessageList messages={[]} busy thinkingDetail="Waiting for Grok (heavy effort)…" />);
  assert.ok(screen.getByText(WAITING_PLACEHOLDER_HEAD));
  assert.equal(screen.queryByText(/Waiting for Grok/i) === null, true);
});
