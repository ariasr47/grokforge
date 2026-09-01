import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ABSENT_NON_VENDOR,
  applyValidCommands,
  enterAwaiting,
  markObtainFailed,
} from "./skillsCatalog.js";
import { decideSkillHandoff } from "./skillHandoff.js";

const ready = applyValidCommands(enterAwaiting(ABSENT_NON_VENDOR), [
  { name: "/forge-skill-fixture", description: "Fixture skill" },
  { name: "/keep-me", description: null },
]);

describe("decideSkillHandoff", () => {
  it("unarmed null/omitted is never a skill start", () => {
    assert.deepEqual(decideSkillHandoff(null, ready, "/forge-skill-fixture"), { action: "unarmed" });
    assert.deepEqual(decideSkillHandoff(undefined, ready, "/forge-skill-fixture"), { action: "unarmed" });
  });

  it("accepts matching ready member with first-token name", () => {
    assert.deepEqual(
      decideSkillHandoff({ name: "/forge-skill-fixture" }, ready, "/forge-skill-fixture extra"),
      { action: "accept", name: "/forge-skill-fixture" },
    );
  });

  it("refuses missing name with 409 skill_handoff_unavailable", () => {
    const decision = decideSkillHandoff({ name: "/gone" }, ready, "/gone");
    assert.deepEqual(decision, {
      action: "refuse",
      code: "skill_handoff_unavailable",
      error: "Skill no longer available.",
      status: 409,
    });
  });

  it("refuses when catalog is not ready", () => {
    assert.equal(
      decideSkillHandoff({ name: "/forge-skill-fixture" }, enterAwaiting(ABSENT_NON_VENDOR), "/forge-skill-fixture").action,
      "refuse",
    );
    assert.equal(
      decideSkillHandoff({ name: "/forge-skill-fixture" }, ABSENT_NON_VENDOR, "/forge-skill-fixture").action,
      "refuse",
    );
    assert.equal(
      decideSkillHandoff(
        { name: "/forge-skill-fixture" },
        markObtainFailed(enterAwaiting(ABSENT_NON_VENDOR)),
        "/forge-skill-fixture",
      ).action,
      "refuse",
    );
  });

  it("refuses first-token mismatch without rewrite", () => {
    const decision = decideSkillHandoff({ name: "/forge-skill-fixture" }, ready, "please /forge-skill-fixture");
    assert.equal(decision.action, "refuse");
    if (decision.action === "refuse") {
      assert.equal(decision.code, "skill_handoff_unavailable");
      assert.equal(decision.status, 409);
    }
  });

  it("does not guess skill start from leading slash text alone", () => {
    const decision = decideSkillHandoff(null, ready, "/forge-skill-fixture");
    assert.equal(decision.action, "unarmed");
  });

  it("refuses non-object or nameless handoff", () => {
    assert.equal(decideSkillHandoff({} as { name: string }, ready, "/forge-skill-fixture").action, "refuse");
    assert.equal(
      decideSkillHandoff({ name: 1 } as unknown as { name: string }, ready, "/1").action,
      "refuse",
    );
  });

  it("after replace-shrink, missing prior name refuses skill_handoff_unavailable", () => {
    const prior = applyValidCommands(enterAwaiting(ABSENT_NON_VENDOR), [
      { name: "/keep", description: null },
      { name: "/gone", description: null },
    ]);
    const shrunk = applyValidCommands(prior, [{ name: "/keep", description: null }]);
    assert.equal(shrunk.disposition, "ready");
    assert.deepEqual(
      decideSkillHandoff({ name: "/gone" }, shrunk, "/gone"),
      {
        action: "refuse",
        code: "skill_handoff_unavailable",
        error: "Skill no longer available.",
        status: 409,
      },
    );
    assert.deepEqual(
      decideSkillHandoff({ name: "/keep" }, shrunk, "/keep"),
      { action: "accept", name: "/keep" },
    );
  });
});
