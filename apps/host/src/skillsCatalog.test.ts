import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ABSENT_NON_VENDOR,
  applyValidCommands,
  clearToAbsent,
  enterAwaiting,
  ignoreMalformed,
  markObtainFailed,
  markTransportDisconnect,
  parseAvailableCommands,
  type SkillsCatalogFact,
} from "./skillsCatalog.js";

describe("skillsCatalog dispositions", () => {
  it("Chat / non-vendor starts absent_non_vendor with null commands", () => {
    assert.deepEqual(ABSENT_NON_VENDOR, {
      disposition: "absent_non_vendor",
      commands: null,
    });
  });

  it("vendor-eligible before first valid → awaiting_first_valid", () => {
    const next = enterAwaiting(ABSENT_NON_VENDOR);
    assert.equal(next.disposition, "awaiting_first_valid");
    assert.equal(next.commands, null);
  });

  it("valid non-empty replace → ready", () => {
    const next = applyValidCommands(enterAwaiting(ABSENT_NON_VENDOR), [
      { name: "/forge-skill-fixture", description: "Fixture skill" },
    ]);
    assert.equal(next.disposition, "ready");
    assert.deepEqual(next.commands, [
      { name: "/forge-skill-fixture", description: "Fixture skill" },
    ]);
  });

  it("valid empty → ready + []", () => {
    const next = applyValidCommands(enterAwaiting(ABSENT_NON_VENDOR), []);
    assert.equal(next.disposition, "ready");
    assert.deepEqual(next.commands, []);
  });

  it("malformed with no prior → obtain_failed", () => {
    const next = ignoreMalformed(enterAwaiting(ABSENT_NON_VENDOR));
    assert.equal(next.disposition, "obtain_failed");
    assert.equal(next.commands, null);
  });

  it("malformed with prior ready → keep prior", () => {
    const ready = applyValidCommands(enterAwaiting(ABSENT_NON_VENDOR), [
      { name: "/keep-me", description: null },
    ]);
    const next = ignoreMalformed(ready);
    assert.deepEqual(next, ready);
  });

  it("obtain timeout with no prior → obtain_failed", () => {
    assert.equal(markObtainFailed(enterAwaiting(ABSENT_NON_VENDOR)).disposition, "obtain_failed");
  });

  it("obtain timeout with prior ready → keep ready", () => {
    const ready = applyValidCommands(enterAwaiting(ABSENT_NON_VENDOR), [
      { name: "/a", description: null },
    ]);
    assert.deepEqual(markObtainFailed(ready), ready);
  });

  it("transport disconnect while vendor-eligible → awaiting_first_valid (withhold)", () => {
    const ready = applyValidCommands(enterAwaiting(ABSENT_NON_VENDOR), [
      { name: "/stale", description: null },
    ]);
    const next = markTransportDisconnect(ready);
    assert.equal(next.disposition, "awaiting_first_valid");
    assert.equal(next.commands, null);
  });

  it("fallback / hard_fail / generation replace → absent_non_vendor", () => {
    const ready = applyValidCommands(enterAwaiting(ABSENT_NON_VENDOR), [
      { name: "/x", description: null },
    ]);
    assert.deepEqual(clearToAbsent(ready), ABSENT_NON_VENDOR);
  });

  it("parseAvailableCommands rejects malformed members and requires slash names", () => {
    assert.equal(parseAvailableCommands(null), null);
    assert.equal(parseAvailableCommands([{ name: "no-slash" }]), null);
    assert.deepEqual(parseAvailableCommands([{ name: "/ok", description: "d" }, { name: 1 }]), null);
    assert.deepEqual(parseAvailableCommands([{ name: "/ok" }]), [
      { name: "/ok", description: null },
    ]);
  });

  it("transport-disconnect does not share keep-ready with obtain-timer", () => {
    const ready: SkillsCatalogFact = applyValidCommands(enterAwaiting(ABSENT_NON_VENDOR), [
      { name: "/stale", description: null },
    ]);
    assert.equal(markTransportDisconnect(ready).disposition, "awaiting_first_valid");
    assert.equal(markObtainFailed(ready).disposition, "ready");
  });
});
