import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SETTLE_CARD_BELOW,
  SETTLE_IN_CHANGES,
  SETTLE_IN_DOCK,
  settleLockCopy,
  settlePendingCopy,
} from "./copyDock.js";

describe("settlePendingCopy", () => {
  it("names Changes when Changes owns Accept and the action dock is empty", () => {
    assert.equal(
      settlePendingCopy({ actionDockOwns: false, changesOwns: true }),
      SETTLE_IN_CHANGES,
    );
    assert.notEqual(
      settlePendingCopy({ actionDockOwns: false, changesOwns: true }),
      SETTLE_CARD_BELOW,
    );
    assert.notEqual(
      settlePendingCopy({ actionDockOwns: false, changesOwns: true }),
      SETTLE_IN_DOCK,
    );
  });

  it("keeps dock-below copy when the action dock owns the card", () => {
    assert.equal(
      settlePendingCopy({ actionDockOwns: true, changesOwns: false }),
      SETTLE_CARD_BELOW,
    );
    assert.equal(
      settlePendingCopy({ actionDockOwns: true, changesOwns: true }),
      SETTLE_CARD_BELOW,
    );
  });

  it("is null when nothing is pending", () => {
    assert.equal(
      settlePendingCopy({ actionDockOwns: false, changesOwns: false }),
      null,
    );
  });
});

describe("settleLockCopy", () => {
  it("pending Changes Accept with an empty action dock names Changes", () => {
    assert.equal(
      settleLockCopy({
        oauth: false,
        permissionCount: 0,
        planPending: false,
        dockOwnedPending: true,
        changeCount: 1,
      }),
      SETTLE_IN_CHANGES,
    );
  });

  it("pending permission keeps dock-below copy", () => {
    assert.equal(
      settleLockCopy({
        oauth: false,
        permissionCount: 1,
        planPending: false,
        dockOwnedPending: true,
        changeCount: 0,
      }),
      SETTLE_CARD_BELOW,
    );
  });

  it("permission plus a pending diff still names the action dock", () => {
    assert.equal(
      settleLockCopy({
        oauth: false,
        permissionCount: 1,
        planPending: false,
        dockOwnedPending: true,
        changeCount: 1,
      }),
      SETTLE_CARD_BELOW,
    );
  });
});
