import assert from "node:assert/strict";
import test from "node:test";
import { computeOverview, filesJumpNeedsStart, overviewShellCaption, pickToolsJumpEl, scrollDeltaBelowYou, scrollDeltaToClearStickyYou, scrollDeltaToKeepCueAboveComposer, shouldKeepEndAfterToolsJump, toolsJumpNeedsStart, transcriptScrollAfterOpenFileDiff, youHeightToKeepCueVisible } from "./OverviewStrip.js";

test("message tools count when no run activities", () => {
  const o = computeOverview(
    [
      { role: "user", content: "hi" },
      { role: "tool", content: "ok", toolMeta: { ok: true } },
      { role: "tool", content: "no", toolMeta: { ok: false } },
    ],
    [],
  );
  assert.equal(o.tools, 2);
  assert.equal(o.toolFails, 1);
  assert.equal(o.userTurns, 1);
});

test("run activities win over message tools so the strip matches Tool activity", () => {
  const o = computeOverview(
    [
      { role: "user", content: "hi" },
      { role: "tool", content: "ok", toolMeta: { ok: true } },
      { role: "tool", content: "ok2", toolMeta: { ok: true } },
    ],
    [],
    { count: 3, fails: 0 },
  );
  assert.equal(o.tools, 3);
  assert.equal(o.toolFails, 0);
});

test("vendor Windows shell caption is PowerShell, not cmd.exe", () => {
  const cap = {
    status: "available" as const,
    platform: "win32",
    osFamily: "windows" as const,
    executable: "C:\\Windows\\System32\\cmd.exe",
    displayName: "Command Prompt (cmd.exe)",
    dialect: "cmd" as const,
    reasonCode: null,
    reason: null,
  };
  const vendor = overviewShellCaption(cap, "vendor");
  assert.equal(vendor?.text, "PowerShell");
  assert.match(vendor?.title ?? "", /not Forge Command Prompt/);
  const fallback = overviewShellCaption(cap, "fallback");
  assert.equal(fallback?.text, "Command Prompt (cmd.exe)");
});

test("TOOLS jump uses start when the header sits under the You card", () => {
  assert.equal(toolsJumpNeedsStart({ toolsTop: 140, youBottom: 210 }), true);
  assert.equal(toolsJumpNeedsStart({ toolsTop: 222, youBottom: 210 }), false);
});

test("E5 FILES jump detects File changes under the You card", () => {
  assert.equal(filesJumpNeedsStart({ filesTop: 132, youBottom: 213 }), true);
  assert.equal(filesJumpNeedsStart({ filesTop: 220, youBottom: 213 }), false);
  assert.equal(scrollDeltaBelowYou({ targetTop: 132, youBottom: 213, gap: 8 }), -89);
});

test("FILES jump detects collapsed Thought tucked under sticky You even when File changes is below You", () => {
  // Live desktop-one-write: You 132–213, Thought 191, File changes 229.
  assert.equal(
    filesJumpNeedsStart({ filesTop: 229, youBottom: 213, thoughtTop: 191 }),
    true,
  );
  assert.equal(
    filesJumpNeedsStart({ filesTop: 229, youBottom: 213, thoughtTop: 220 }),
    false,
  );
  assert.equal(
    scrollDeltaBelowYou({ targetTop: 229, youBottom: 213, gap: 8, thoughtTop: 191 }),
    -30,
  );
  assert.equal(
    scrollDeltaBelowYou({ targetTop: 229, youBottom: 213, gap: 8, thoughtTop: 220 }),
    8,
  );
});

test("opening View diff that yanked File changes under Thought needs a transcript nudge, not scroll-to-end", () => {
  // Live desktop-d7-parse-recapture: File changes box y=80, You 132–213, Thought 225–251.
  assert.equal(
    transcriptScrollAfterOpenFileDiff({
      nearEnd: true,
      fileTop: 80,
      youBottom: 213,
      thoughtBottom: 251,
    }),
    80 - (251 + 8),
  );
  assert.equal(
    transcriptScrollAfterOpenFileDiff({
      nearEnd: true,
      fileTop: 263,
      youBottom: 213,
      thoughtBottom: 251,
    }),
    263 - (251 + 8),
  );
});

test("FILES jump detects File changes header tucked under collapsed Thought that is already below You", () => {
  // Live desktop-d7-parse after View diff: You 132–213, Thought 225–251, File changes header 242.
  assert.equal(
    filesJumpNeedsStart({
      filesTop: 242,
      youBottom: 213,
      thoughtTop: 225,
      thoughtBottom: 251,
    }),
    true,
  );
  assert.equal(
    filesJumpNeedsStart({
      filesTop: 260,
      youBottom: 213,
      thoughtTop: 225,
      thoughtBottom: 251,
    }),
    false,
  );
  assert.equal(
    scrollDeltaBelowYou({
      targetTop: 242,
      youBottom: 213,
      gap: 8,
      thoughtTop: 225,
      thoughtBottom: 251,
    }),
    -17,
  );
  assert.equal(
    scrollDeltaBelowYou({
      targetTop: 260,
      youBottom: 213,
      gap: 8,
      thoughtTop: 225,
      thoughtBottom: 251,
    }),
    1,
  );
});

test("You height growth that tucks File changes under sticky You needs a transcript nudge", () => {
  // Live desktop-long-hierarchy-expand: You 132–559 (h=427), File changes 229,
  // tools 467, Thought 571. Expand after FILES/TOOLS left the docks under You.
  assert.equal(
    scrollDeltaToClearStickyYou({
      youBottom: 559,
      tops: [571, 229, 467],
    }),
    229 - (559 + 8),
  );
  assert.equal(
    scrollDeltaToClearStickyYou({
      youBottom: 213,
      tops: [225, 229, 467],
    }),
    0,
  );
  assert.equal(scrollDeltaToClearStickyYou({ youBottom: 559, tops: [] }), 0);
});

test("expanded You shrinks so Your turn stays above the composer", () => {
  // Live desktop-long-hierarchy-recapture: You h=245, Your turn 857–882, composer 750.
  assert.equal(
    youHeightToKeepCueVisible({
      youHeight: 245,
      cueBottom: 882,
      composerTop: 750,
    }),
    245 - (882 + 8 - 750),
  );
  // Extra gap so Your turn clears the composer after expand (floors at 81).
  assert.equal(
    youHeightToKeepCueVisible({
      youHeight: 245,
      cueBottom: 882,
      composerTop: 750,
      gap: 40,
    }),
    81,
  );
  assert.equal(
    youHeightToKeepCueVisible({
      youHeight: 245,
      cueBottom: 701,
      composerTop: 750,
    }),
    245,
  );
  assert.equal(
    youHeightToKeepCueVisible({
      youHeight: 245,
      cueBottom: 1000,
      composerTop: 750,
      minYouHeight: 81,
    }),
    81,
  );
  // Cue still fits at 701 before the files nudge; after clear-You it does not.
  // Live desktop-cue-above-composer after clamp to 81: Your turn 735–760, composer 750, files 263.
  assert.equal(
    scrollDeltaToKeepCueAboveComposer({
      cueBottom: 760,
      composerTop: 750,
      youBottom: 213,
      filesTop: 263,
    }),
    760 + 8 - 750,
  );
  assert.equal(
    scrollDeltaToKeepCueAboveComposer({
      cueBottom: 701,
      composerTop: 750,
      youBottom: 213,
      filesTop: 229,
    }),
    0,
  );

  const clearDelta = scrollDeltaToClearStickyYou({
    youBottom: 377,
    tops: [389, 229, 467],
  });
  assert.equal(
    youHeightToKeepCueVisible({
      youHeight: 245,
      cueBottom: 701 - clearDelta,
      composerTop: 750,
    }),
    245 - (701 - clearDelta + 8 - 750),
  );
});

test("TOOLS jump keep-end only when tools still fit above the composer", () => {
  assert.equal(
    shouldKeepEndAfterToolsJump({
      toolsTop: 200,
      toolsBottom: 280,
      transcriptTop: 120,
      composerTop: 750,
      cueBottom: 760,
      hiddenBelow: 20,
    }),
    true,
  );
  assert.equal(
    shouldKeepEndAfterToolsJump({
      toolsTop: 140,
      toolsBottom: 400,
      transcriptTop: 120,
      composerTop: 750,
      cueBottom: 900,
      hiddenBelow: 400,
    }),
    false,
  );
  assert.equal(
    shouldKeepEndAfterToolsJump({
      toolsTop: 200,
      toolsBottom: 260,
      transcriptTop: 120,
      composerTop: 750,
      cueBottom: 700,
      hiddenBelow: 0,
    }),
    false,
  );
});

test("TOOLS keep-end does not clamp File changes header under collapsed Thought", () => {
  // Live desktop-f6-nested: FILES left header at 263; TOOLS keep-end scrolled 362px
  // and clamped the header at 242 under Thought 225–251.
  assert.equal(
    shouldKeepEndAfterToolsJump({
      toolsTop: 648,
      toolsBottom: 798,
      transcriptTop: 120,
      composerTop: 750,
      cueBottom: 1064,
      hiddenBelow: 362,
      fileHeadTop: 263,
      youBottom: 213,
      thoughtBottom: 251,
    }),
    false,
  );
  assert.equal(
    shouldKeepEndAfterToolsJump({
      toolsTop: 200,
      toolsBottom: 280,
      transcriptTop: 120,
      composerTop: 750,
      cueBottom: 760,
      hiddenBelow: 20,
      fileHeadTop: 280,
      youBottom: 213,
      thoughtBottom: 251,
    }),
    true,
  );
});

test("TOOLS jump target prefers the receipts header over the tall receipts box", () => {
  const order: string[] = [];
  const header = { className: "rhead" };
  const root = {
    querySelector(sel: string) {
      order.push(sel);
      if (sel === ".rhead") return header;
      return null;
    },
  } as unknown as ParentNode;
  const el = pickToolsJumpEl(root);
  assert.equal(el, header);
  assert.deepEqual(order, [".rhead"]);
});
