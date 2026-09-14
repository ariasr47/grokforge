import test from "node:test";
import assert from "node:assert/strict";
// Workspace-confinement tests cover grok-acp protected delete, not a Forge undo engine.
import { parseProtectedDelete } from "./protected-delete.js";
import { AuthorizationBroker } from "./authorization-broker.js";

test("protected delete circuit breaker covers quoted and LiteralPath forms", () => {
  const workspace = process.cwd();
  assert.equal(parseProtectedDelete(`Remove-Item -Force -LiteralPath \"${workspace}\" -Recurse`, workspace), true);
  assert.equal(parseProtectedDelete(`rm -rf \"${workspace}\"`, workspace), true);
  assert.equal(parseProtectedDelete("Remove-Item -Recurse child.txt", workspace), false);
});

test("Trusted workspace auto-authorizes regular text creates", () => {
  const result = new AuthorizationBroker().authorize({ kind: "text_edit", regularText: true, exists: false }, { mode: "trusted_workspace", confined: true });
  assert.equal(result.decision, "auto"); assert.equal(result.automaticEligibility, "text_edit");
});
