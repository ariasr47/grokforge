// F2 — launch state machine: pure phase-line unit tests (AC-U2).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { INITIAL_PHASE_LINE, phaseLine } from "./launchState";

describe("phaseLine — AC-U2 (each launcher status maps to exactly one line)", () => {
  it("no status yet -> keeps the previous (initial) line", () => {
    assert.equal(phaseLine(null, INITIAL_PHASE_LINE), INITIAL_PHASE_LINE);
  });

  it("phase: starting -> 'Starting the local engine…'", () => {
    assert.equal(
      phaseLine({ phase: "starting" }, INITIAL_PHASE_LINE),
      "Starting the local engine…",
    );
  });

  it("phase: ready -> 'Connecting…'", () => {
    assert.equal(
      phaseLine({ phase: "ready" }, "Starting the local engine…"),
      "Connecting…",
    );
  });

  it("phase: failed -> no phase line of its own; keeps previous (the failure card takes over rendering)", () => {
    assert.equal(phaseLine({ phase: "failed" }, "Connecting…"), "Connecting…");
  });

  it("no elapsed time alone advances a phase — repeating the SAME status never changes the line", () => {
    const a = phaseLine({ phase: "starting" }, INITIAL_PHASE_LINE);
    const b = phaseLine({ phase: "starting" }, a);
    assert.equal(a, b);
  });

  it("'Almost ready…' never appears — withdrawn from shipped copy", () => {
    for (const phase of ["starting", "ready", "failed"] as const) {
      assert.notEqual(phaseLine({ phase }, INITIAL_PHASE_LINE), "Almost ready…");
    }
  });
});
