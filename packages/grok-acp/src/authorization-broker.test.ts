import test from "node:test";
import assert from "node:assert/strict";
import { AuthorizationBroker } from "./authorization-broker.js";

const broker = new AuthorizationBroker();
const classes = ["npm", "git:show"];

test("Review ignores the saved class list for generic shell", () => {
  const result = broker.authorize(
    { kind: "shell", command: "npm test" },
    { mode: "review", trustedCommandClasses: classes },
  );
  assert.equal(result.decision, "decision");
  assert.equal(result.automaticEligibility, "not_eligible");
});

test("Trusted matching npm is list-auto", () => {
  const result = broker.authorize(
    { kind: "shell", command: "npm test" },
    { mode: "trusted_workspace", trustedCommandClasses: classes },
  );
  assert.equal(result.decision, "auto");
  assert.equal(result.automaticEligibility, "trusted_command_class");
});

test("Trusted multi-statement never list-autos", () => {
  const result = broker.authorize(
    { kind: "shell", command: "npm test && echo x" },
    { mode: "trusted_workspace", trustedCommandClasses: classes },
  );
  assert.equal(result.decision, "decision");
  assert.equal(result.automaticEligibility, "not_eligible");
});

test("Bypass stays independent of an empty list", () => {
  const result = broker.authorize(
    { kind: "shell", command: "npm test" },
    { mode: "bypass_permissions", trustedCommandClasses: [] },
  );
  assert.equal(result.decision, "auto");
  assert.equal(result.automaticEligibility, "bypass");
});

test("fixed inspection still wins before the shell list branch", () => {
  const result = broker.authorize(
    { kind: "inspection", command: "git status --short" },
    {
      mode: "trusted_workspace",
      inspection: "git status --short",
      trustedCommandClasses: classes,
    },
  );
  assert.equal(result.decision, "auto");
  assert.equal(result.automaticEligibility, "fixed_inspection");
});
