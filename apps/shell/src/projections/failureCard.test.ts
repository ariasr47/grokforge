// F3 — the six failure cards and the class -> card mapping (SPEC §5's nine
// detection rows, AC-U3). Pure-function coverage, no rendering.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CARD_COPY, cardFor } from "./failureCard";
import type { LaunchReason } from "../lib/api";

describe("cardFor — SPEC §5 class -> card mapping (all nine rows + edges, AC-U3)", () => {
  it("row 1: entry_missing -> missing-file", () => {
    assert.equal(cardFor({ reason: "entry_missing", osError: null }), "missing-file");
  });

  it("row 2: runtime_missing, osError 2 (ERROR_FILE_NOT_FOUND) -> missing-file", () => {
    assert.equal(cardFor({ reason: "runtime_missing", osError: 2 }), "missing-file");
  });

  it("row 2: runtime_missing, osError 3 (ERROR_PATH_NOT_FOUND) -> missing-file", () => {
    assert.equal(cardFor({ reason: "runtime_missing", osError: 3 }), "missing-file");
  });

  it("row 3: runtime_missing, osError 5 (ERROR_ACCESS_DENIED) -> windows-blocked", () => {
    assert.equal(cardFor({ reason: "runtime_missing", osError: 5 }), "windows-blocked");
  });

  it("row 3: runtime_missing, osError 225 (ERROR_VIRUS_INFECTED) -> windows-blocked", () => {
    assert.equal(cardFor({ reason: "runtime_missing", osError: 225 }), "windows-blocked");
  });

  it("row 3: runtime_missing, osError 226 (ERROR_VIRUS_DELETED) -> windows-blocked", () => {
    assert.equal(cardFor({ reason: "runtime_missing", osError: 226 }), "windows-blocked");
  });

  it("row 3: runtime_missing, osError 740 (ERROR_ELEVATION_REQUIRED) -> windows-blocked", () => {
    assert.equal(cardFor({ reason: "runtime_missing", osError: 740 }), "windows-blocked");
  });

  it("row 4: runtime_missing, other OS error (e.g. 193 ERROR_BAD_EXE_FORMAT) -> neutral", () => {
    assert.equal(cardFor({ reason: "runtime_missing", osError: 193 }), "neutral");
  });

  it("row 4b: runtime_missing with osError null (missing sub-signal) -> neutral, NOT missing-file", () => {
    // The exact integrity failure §5 is written against: a lane that defaults
    // a missing sub-signal to a cause-named card is wrong.
    assert.equal(cardFor({ reason: "runtime_missing", osError: null }), "neutral");
  });

  it("row 5: crashed -> engine-stopped", () => {
    assert.equal(cardFor({ reason: "crashed", osError: null }), "engine-stopped");
  });

  it("row 6: health_timeout -> neutral", () => {
    assert.equal(cardFor({ reason: "health_timeout", osError: null }), "neutral");
  });

  it("row 7: port_unavailable -> no-connection", () => {
    assert.equal(cardFor({ reason: "port_unavailable", osError: null }), "no-connection");
  });

  it("row 8: origin_refused -> refused-copy", () => {
    assert.equal(cardFor({ reason: "origin_refused", osError: null }), "refused-copy");
  });

  it("row 9: foreign_host -> neutral (unreachable in prod; invariant-break fallback)", () => {
    assert.equal(cardFor({ reason: "foreign_host", osError: null }), "neutral");
  });

  it("reason: null -> neutral", () => {
    assert.equal(cardFor({ reason: null, osError: null }), "neutral");
  });

  it("reason: unknown -> neutral", () => {
    assert.equal(cardFor({ reason: "unknown", osError: null }), "neutral");
  });

  it("an unmapped string cast to LaunchReason -> neutral (closed set fallback)", () => {
    assert.equal(
      cardFor({ reason: "totally_unmapped" as unknown as LaunchReason, osError: null }),
      "neutral",
    );
  });
});

describe("CARD_COPY — retry affordance table (AC-U5)", () => {
  it("card 6 (refused-copy) offers no Try again at all", () => {
    assert.equal(CARD_COPY["refused-copy"].retryOffered, false);
    assert.notEqual(CARD_COPY["refused-copy"].primaryAction, "try-again");
    assert.notEqual(CARD_COPY["refused-copy"].secondaryAction, "try-again");
  });

  it("card 4 (missing-file) offers Try again only as secondary", () => {
    assert.equal(CARD_COPY["missing-file"].primaryAction, "save-diagnostics");
    assert.equal(CARD_COPY["missing-file"].secondaryAction, "try-again");
    assert.equal(CARD_COPY["missing-file"].retryOffered, true);
  });

  it("cards 1/2/3/5 offer Try again as the primary action", () => {
    for (const id of ["neutral", "engine-stopped", "no-connection", "windows-blocked"] as const) {
      assert.equal(CARD_COPY[id].primaryAction, "try-again");
      assert.equal(CARD_COPY[id].retryOffered, true);
    }
  });

  it("no card copy mentions nodejs.org", () => {
    for (const copy of Object.values(CARD_COPY)) {
      assert.equal(`${copy.headline} ${copy.body}`.toLowerCase().includes("nodejs.org"), false);
    }
  });
});
