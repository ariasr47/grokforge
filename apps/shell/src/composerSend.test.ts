import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import {
  beginPageSend,
  cancelDuringAdmission,
  composerChromeBusy,
  composerSendAdmitted,
  endPageSend,
} from "./composerSend.js";

afterEach(() => endPageSend());

test("idle typed send is admitted", () => {
  assert.equal(
    composerSendAdmitted({ text: "hello", sessionBusy: false, ownedRunActive: false }),
    true,
  );
});

test("empty draft is refused", () => {
  assert.equal(
    composerSendAdmitted({ text: "  ", sessionBusy: false, ownedRunActive: false }),
    false,
  );
});

test("owned non-terminal run is refused", () => {
  assert.equal(
    composerSendAdmitted({ text: "second", sessionBusy: false, ownedRunActive: true }),
    false,
  );
});

test("Enter while Cancel is showing is refused even before the run is projected", () => {
  assert.equal(
    composerSendAdmitted({
      text: "BUSY-SECOND-MUST-NOT-SEND",
      sessionBusy: true,
      ownedRunActive: false,
    }),
    false,
  );
});

test("in-flight latch refuses a second send even if render reset sessionBusy", () => {
  assert.equal(
    composerSendAdmitted({
      text: "BUSY-SECOND-MUST-NOT-SEND",
      sessionBusy: false,
      ownedRunActive: false,
      sendInFlight: true,
    }),
    false,
  );
});

test("Answered owned run does not keep Cancel just because runStartedAt is still set", () => {
  assert.equal(
    composerChromeBusy({
      activeNonTerminalRun: false,
      runStartedAt: 1,
      ownedAllTerminal: true,
    }),
    false,
  );
  assert.equal(
    composerChromeBusy({
      activeNonTerminalRun: true,
      runStartedAt: 1,
      ownedAllTerminal: false,
    }),
    true,
  );
  assert.equal(
    composerChromeBusy({
      activeNonTerminalRun: false,
      runStartedAt: 1,
      ownedAllTerminal: false,
    }),
    true,
  );
});

test("Cancel during admission aborts before post or cancels the admitted run", () => {
  assert.equal(
    cancelDuringAdmission({ cancelRequested: false, admitted: false }),
    "continue",
  );
  assert.equal(
    cancelDuringAdmission({ cancelRequested: true, admitted: false }),
    "abort_before_post",
  );
  assert.equal(
    cancelDuringAdmission({ cancelRequested: true, admitted: true }),
    "cancel_admitted_run",
  );
});

test("page send latch admits once then refuses until ended", () => {
  endPageSend();
  assert.equal(beginPageSend(), true);
  assert.equal(beginPageSend(), false);
  assert.equal(
    composerSendAdmitted({ text: "BUSY-SECOND-MUST-NOT-SEND", sessionBusy: false, ownedRunActive: false }),
    false,
  );
  endPageSend();
  assert.equal(
    composerSendAdmitted({ text: "BUSY-SECOND-MUST-NOT-SEND", sessionBusy: false, ownedRunActive: false }),
    true,
  );
});
