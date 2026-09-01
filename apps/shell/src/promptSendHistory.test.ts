import assert from "node:assert/strict";
import test from "node:test";
import {
  cancelledDoneShouldPaint,
  foldRunAnswersIntoHistory,
  RETRY_PROMPT_SEND_OPTS,
  stopChipBelongsOnTranscript,
  stripTrailingStopAndAssistant,
} from "./promptSendHistory.js";

test("follow-up history includes the vouched run answer when messages are user-only", () => {
  // Live desktop-chat-followup: historyTurns 1 (first You only). Second turn replied FOLLOW-MEM-SET not FOLLOW-MEM-OK.
  const folded = foldRunAnswersIntoHistory(
    [
      {
        role: "user",
        content: "Remember the token FOLLOW-MEM-OK. Reply with exactly FOLLOW-MEM-SET and stop.",
        projectedRunId: "r1",
      },
    ],
    { r1: "FOLLOW-MEM-SET" },
  );
  assert.deepEqual(
    folded.map((m) => m.role),
    ["user", "assistant"],
  );
  assert.equal(folded[1]!.content, "FOLLOW-MEM-SET");
});

test("does not duplicate an assistant already in messages", () => {
  const folded = foldRunAnswersIntoHistory(
    [
      { role: "user", content: "hi", projectedRunId: "r1" },
      { role: "assistant", content: "hello" },
    ],
    { r1: "hello" },
  );
  assert.equal(folded.length, 2);
  assert.equal(folded.filter((m) => m.role === "assistant").length, 1);
});

test("retry after Cancel drops Stopped by you so the next Answered is not followed by the stop chip", () => {
  // Live desktop-retry: Code Retry called sendText(prompt) without stripTrailingAssistant.
  // MessageList kept "Stopped by you." after the retry Answered.
  const afterCancel = [
    {
      role: "user",
      content:
        "Write a 20-line numbered explanation of how Forge Review differs from Plan, then stop. Do not edit files.",
    },
    { role: "system", content: "Stopped by you." },
  ];
  const withoutStrip = afterCancel;
  assert.equal(
    withoutStrip.some((m) => m.content.startsWith("Stopped by you")),
    true,
  );
  const forRetry = stripTrailingStopAndAssistant(afterCancel);
  assert.equal(
    forRetry.some((m) => m.content.startsWith("Stopped by you")),
    false,
  );
  assert.equal(forRetry.at(-1)?.role, "user");
  assert.equal(RETRY_PROMPT_SEND_OPTS.stripTrailingAssistant, true);
});

test("retry strip also drops Run ended and a trailing assistant", () => {
  const afterPartial = [
    { role: "user", content: "go" },
    { role: "assistant", content: "partial" },
    { role: "system", content: "Run ended — connection lost." },
  ];
  const forRetry = stripTrailingStopAndAssistant(afterPartial);
  assert.deepEqual(
    forRetry.map((m) => m.role),
    ["user"],
  );
});

test("stale cancelled done does not paint Stopped by you after Retry has started a new prompt", () => {
  // Live desktop-retry-recapture: strip ran, then run1's cancelled `done` arrived
  // and appended Stopped by you after the retry user / Answered.
  assert.equal(
    cancelledDoneShouldPaint({
      promptGeneration: 2,
      cancelGeneration: 1,
      lastRole: "user",
      lastContent: "Write a 20-line numbered explanation",
      userCount: 2,
    }),
    false,
  );
  assert.equal(
    cancelledDoneShouldPaint({
      promptGeneration: 1,
      cancelGeneration: 1,
      lastRole: "user",
      lastContent: "Write a 20-line numbered explanation",
      userCount: 1,
    }),
    true,
  );
});

test("stop chip leaves the transcript once the newest run is no longer Cancelled", () => {
  assert.equal(
    stopChipBelongsOnTranscript([{ state: "terminal", terminalKind: "cancelled" }]),
    true,
  );
  assert.equal(
    stopChipBelongsOnTranscript([
      { state: "terminal", terminalKind: "cancelled" },
      { state: "terminal", terminalKind: "answered" },
    ]),
    false,
  );
  assert.equal(
    stopChipBelongsOnTranscript([
      { state: "terminal", terminalKind: "cancelled" },
      { state: "streaming", terminalKind: null },
    ]),
    false,
  );
});
