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

/** Same shape on both twin sites. Junk-last-only is insufficient. */
export const INTERIOR_JUNK_CASES: Array<{ label: string; junk: unknown }> = [
  { label: "whitespace-name", junk: { name: "has space" } },
  { label: "number", junk: 1 },
  { label: "null", junk: null },
  { label: "raw-string", junk: "raw" },
];

function interiorJunkPayload(junk: unknown) {
  return [
    { name: "/a", description: null },
    junk,
    { name: "/b", description: "bee" },
  ];
}

const EXPECTED_AFTER_SKIP = [
  { name: "/a", description: null },
  { name: "/b", description: "bee" },
];

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

  it("transport-disconnect does not share keep-ready with obtain-timer", () => {
    const ready: SkillsCatalogFact = applyValidCommands(enterAwaiting(ABSENT_NON_VENDOR), [
      { name: "/stale", description: null },
    ]);
    assert.equal(markTransportDisconnect(ready).disposition, "awaiting_first_valid");
    assert.equal(markObtainFailed(ready).disposition, "ready");
  });
});

describe("parseAvailableCommands skip-invalid", () => {
  it("non-array → null (wholly unusable)", () => {
    assert.equal(parseAvailableCommands(null), null);
    assert.equal(parseAvailableCommands({ name: "/a" }), null);
  });

  it("empty array → [] (empty≠error; not null)", () => {
    assert.deepEqual(parseAvailableCommands([]), []);
  });

  it("all-skipped non-empty → null (not ready-empty [])", () => {
    assert.equal(parseAvailableCommands([{ name: "has space" }]), null);
    assert.equal(parseAvailableCommands([{ name: "has space" }, 1, null]), null);
  });

  it("ACP names without slash normalize to /name", () => {
    assert.deepEqual(
      parseAvailableCommands([
        { name: "web", description: "Search the web" },
        { name: "/ok" },
        { name: "plan" },
      ]),
      [
        { name: "/web", description: "Search the web" },
        { name: "/ok", description: null },
        { name: "/plan", description: null },
      ],
    );
  });

  for (const { label, junk } of INTERIOR_JUNK_CASES) {
    it(`interior-junk (${label}) keeps /a and /b — not wipe, not prefix-only`, () => {
      assert.deepEqual(parseAvailableCommands(interiorJunkPayload(junk)), EXPECTED_AFTER_SKIP);
    });
  }

  it("junk never appears; whitespace / short names skip", () => {
    assert.deepEqual(
      parseAvailableCommands([
        { name: "/ok", description: "d" },
        { name: "/ " },
        { name: "/" },
        { name: 1 },
        { name: "/keep" },
      ]),
      [
        { name: "/ok", description: "d" },
        { name: "/keep", description: null },
      ],
    );
  });

  it("non-string description coerces to null", () => {
    assert.deepEqual(parseAvailableCommands([{ name: "/x", description: 3 }]), [
      { name: "/x", description: null },
    ]);
  });
});

describe("first-mixed / replace / keep-ready / obtain≠transport", () => {
  it("first mixed with no prior → ready with every accepted (not obtain_failed)", () => {
    const accepted = parseAvailableCommands(interiorJunkPayload({ name: "has space" }));
    assert.ok(accepted);
    const next = applyValidCommands(enterAwaiting(ABSENT_NON_VENDOR), accepted!);
    assert.equal(next.disposition, "ready");
    assert.deepEqual(next.commands, EXPECTED_AFTER_SKIP);
  });

  it("later valid mixed/partial replaces — not union", () => {
    const prior = applyValidCommands(enterAwaiting(ABSENT_NON_VENDOR), [
      { name: "/keep", description: null },
      { name: "/stale", description: null },
    ]);
    const accepted = parseAvailableCommands([
      { name: "/keep" },
      { name: "has space" },
      { name: "/new", description: "n" },
    ]);
    assert.ok(accepted);
    const next = applyValidCommands(prior, accepted!);
    assert.deepEqual(next.commands, [
      { name: "/keep", description: null },
      { name: "/new", description: "n" },
    ]);
    assert.equal(next.commands!.some((c) => c.name === "/stale"), false);
  });

  it("all-skipped after ready → ignoreMalformed keeps prior", () => {
    const ready = applyValidCommands(enterAwaiting(ABSENT_NON_VENDOR), [
      { name: "/keep-me", description: null },
    ]);
    assert.equal(parseAvailableCommands([{ name: "has space" }, 1]), null);
    assert.deepEqual(ignoreMalformed(ready), ready);
  });

  it("all-skipped with no prior → obtain_failed (exits Checking)", () => {
    assert.equal(parseAvailableCommands([null, { name: "has space" }]), null);
    const next = ignoreMalformed(enterAwaiting(ABSENT_NON_VENDOR));
    assert.equal(next.disposition, "obtain_failed");
    assert.equal(next.commands, null);
  });

  it("transport-disconnect does not share keep-ready with obtain-timer", () => {
    const ready = applyValidCommands(enterAwaiting(ABSENT_NON_VENDOR), [
      { name: "/stale", description: null },
    ]);
    assert.equal(markTransportDisconnect(ready).disposition, "awaiting_first_valid");
    assert.equal(markTransportDisconnect(ready).commands, null);
    assert.equal(markObtainFailed(ready).disposition, "ready");
    assert.deepEqual(ignoreMalformed(ready), ready);
  });

  it("enterAwaiting does not undo obtain_failed back to Checking", () => {
    const failed = ignoreMalformed(enterAwaiting(ABSENT_NON_VENDOR));
    assert.equal(failed.disposition, "obtain_failed");
    const next = enterAwaiting(failed);
    assert.equal(next.disposition, "obtain_failed");
    assert.equal(next.commands, null);
  });
});
