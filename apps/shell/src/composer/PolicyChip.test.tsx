// W3-1: the policy sentence contradicted itself on fact — PolicyChip claimed
// Review writes edits straight to disk (no ask) while PermissionPolicyControl
// and copyDock's GATE_WRITE_POLICY both said Review asks before writing.
// Verified against packages/grok-acp/src/authorization-broker.ts: review mode
// always falls through to `decision: "decision"` for both text_edit and shell
// — it never auto-applies either. These tests lock POLICY_SENTENCE to that
// fact and cross-check it against the sibling surfaces named in the finding
// so the three can't drift apart again.
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render } from "@testing-library/react";
import { PolicyChip, POLICY_SENTENCE } from "./PolicyChip";
import { PermissionPolicyControl } from "./PermissionPolicyControl";
import { BypassPermissionsControl } from "./BypassPermissionsControl";

afterEach(() => cleanup());

test("POLICY_SENTENCE.review says Forge asks before writing, never that it writes to disk unasked", () => {
  const sentence = POLICY_SENTENCE.review;
  assert.match(sentence, /asks/i);
  assert.match(sentence, /edit/i);
  assert.match(sentence, /shell/i);
  assert.equal(/writes .* to disk/i.test(sentence), false);
});

test("POLICY_SENTENCE.trusted_workspace names the real 'eligible' limiter, matching PermissionPolicyControl", () => {
  assert.match(POLICY_SENTENCE.trusted_workspace, /eligible/i);
});

test("POLICY_SENTENCE.bypass names the same OS/circuit-breaker limiter BypassPermissionsControl's own copy does", () => {
  assert.match(POLICY_SENTENCE.bypass, /circuit breakers still apply/i);
});

test("the composer chip trigger's title is the exact POLICY_SENTENCE for its kind", () => {
  const { getByRole } = render(<PolicyChip kind="review" content={null} />);
  assert.equal(getByRole("button").getAttribute("title"), POLICY_SENTENCE.review);
});

test("cross-file: PolicyChip and PermissionPolicyControl agree review asks before edits and shell", () => {
  const { getByText } = render(
    <PermissionPolicyControl status="confirmed" confirmedMode="review" />,
  );
  // PermissionPolicyControl's own real copy for the review radio option.
  assert.ok(getByText("Ask before edits and shell actions."));
  assert.match(POLICY_SENTENCE.review, /asks? before edits? and shell/i);
});

test("cross-file: PolicyChip and BypassPermissionsControl agree on the standing OS/destructive-operation limit", () => {
  const { getByText } = render(
    <BypassPermissionsControl sessionId="s1" unlocked available active />,
  );
  assert.ok(
    getByText(/OS permissions and destructive-operation circuit breakers still apply/),
  );
  assert.match(POLICY_SENTENCE.bypass, /OS permissions and destructive-operation circuit breakers still apply/);
});
