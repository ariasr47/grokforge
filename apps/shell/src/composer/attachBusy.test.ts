import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scheduleExtractingCue } from "./attachBusy.js";

describe("scheduleExtractingCue", () => {
  it("fires cue when settle is after the frame", () => {
    let cue = false;
    let frameCb: (() => void) | null = null;
    const handle = scheduleExtractingCue(
      true,
      () => {
        cue = true;
      },
      (cb) => {
        frameCb = cb;
        return 1;
      },
      () => {},
    );
    assert.equal(cue, false);
    frameCb!();
    assert.equal(cue, true);
    handle.settle();
  });

  it("omits cue when settle happens before the frame", () => {
    let cue = false;
    let frameCb: (() => void) | null = null;
    const handle = scheduleExtractingCue(
      true,
      () => {
        cue = true;
      },
      (cb) => {
        frameCb = cb;
        return 1;
      },
      () => {},
    );
    handle.settle();
    frameCb!();
    assert.equal(cue, false);
  });

  it("no cue scheduling when batch has no PDF", () => {
    let scheduled = false;
    scheduleExtractingCue(
      false,
      () => {},
      () => {
        scheduled = true;
        return 1;
      },
      () => {},
    );
    assert.equal(scheduled, false);
  });
});
