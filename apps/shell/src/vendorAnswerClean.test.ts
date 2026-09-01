import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanVendorAnswer,
  collapseIntentThenDoneParagraphs,
  stripVendorSystemReminders,
} from "./vendorAnswerClean.js";

test("drops vendor system-reminder blocks from a Code answer", () => {
  const raw = [
    "Ran the command once.",
    "",
    "```",
    "exit: 1",
    "",
    "<system-reminder>",
    "Background task completed (exit code: 1).",
    "Use get_command_or_subagent_output to see the full output.",
    "</system-reminder>",
    "```",
    "",
    "No files were edited.",
  ].join("\n");
  const cleaned = stripVendorSystemReminders(raw);
  assert.equal(cleaned.includes("system-reminder"), false);
  assert.equal(cleaned.includes("get_command_or_subagent_output"), false);
  assert.match(cleaned, /No files were edited/);
  assert.match(cleaned, /Ran the command once/);
});

test("leaves answers without reminders untouched", () => {
  assert.equal(stripVendorSystemReminders("Created STACK.md."), "Created STACK.md.");
});

test("drops I'll-create lead-in when a later paragraph names the same path", () => {
  const raw = [
    "I'll create docs/dogfood/PLUSBAR.md with exactly PLUSBAR-OK and leave every other file untouched.",
    "",
    "Created docs/dogfood/PLUSBAR.md with exactly PLUSBAR-OK. No other files were changed.",
  ].join("\n");
  const cleaned = collapseIntentThenDoneParagraphs(raw);
  assert.equal(cleaned.includes("I'll create"), false);
  assert.match(cleaned, /Created docs\/dogfood\/PLUSBAR\.md/);
});

test("drops Creating-path lead-in when a later Created paragraph names the same path", () => {
  const raw = [
    "Creating docs/dogfood/ONESHOT.md with exactly ONESHOT-OK.",
    "",
    "Created docs/dogfood/ONESHOT.md with exactly ONESHOT-OK. No other files were edited.",
  ].join("\n");
  const cleaned = collapseIntentThenDoneParagraphs(raw);
  assert.equal(cleaned.includes("Creating "), false);
  assert.match(cleaned, /Created docs\/dogfood\/ONESHOT\.md/);
});

test("keeps I'll-create when no later paragraph covers the path", () => {
  const raw = "I'll create docs/dogfood/PLUSBAR.md next.";
  assert.equal(collapseIntentThenDoneParagraphs(raw), raw);
});

test("drops still-running wait lead-in when a later paragraph has pass counts", () => {
  const raw = [
    "The test is still running; I'll wait for the Node runner to finish and then report the counts.",
    "",
    "9 pass, 0 fail (9 tests, 2 suites).",
  ].join("\n");
  const cleaned = collapseIntentThenDoneParagraphs(raw);
  assert.equal(cleaned.includes("still running"), false);
  assert.equal(cleaned, "9 pass, 0 fail (9 tests, 2 suites).");
});

test("drops I'll-run lead-in when a later paragraph is the output", () => {
  const raw = [
    "I'll run that exact command and reply with its output only.",
    "",
    "FORGE-TURN-OK",
  ].join("\n");
  const cleaned = collapseIntentThenDoneParagraphs(raw);
  assert.equal(cleaned.includes("I'll run"), false);
  assert.equal(cleaned, "FORGE-TURN-OK");
});

test("keeps I'll-run when it is the only paragraph", () => {
  const raw = "I'll run the tests next.";
  assert.equal(collapseIntentThenDoneParagraphs(raw), raw);
});

test("drops first-run-at-root retry lead-in when a later paragraph has the result", () => {
  const raw = [
    "The first run started at the workspace root, so I'll rerun it from apps/shell.",
    "",
    "src/App.slash-skills.test.tsx passed from apps/shell.",
  ].join("\n");
  const cleaned = collapseIntentThenDoneParagraphs(raw);
  assert.equal(cleaned.includes("workspace root"), false);
  assert.match(cleaned, /passed from apps\/shell/);
});

test("drops I'll-inspect / I-have-the-layout lead-in when a later paragraph is the plan", () => {
  const raw = [
    "I'll inspect apps/shell TypeScript config and how typecheck is invoked so the three-step plan matches this repo.",
    "",
    "I have the shell TypeScript layout. Next I'll write a three-step typecheck plan and exit plan mode without running tsc.",
    "",
    "Three-step plan for apps/shell typecheck (not run):",
    "",
    "1. Change into `apps/shell`",
    "",
    "Out of scope: Vite, Vitest, Tauri, and any source edits.",
  ].join("\n");
  const cleaned = collapseIntentThenDoneParagraphs(raw);
  assert.equal(cleaned.includes("I'll inspect"), false);
  assert.equal(cleaned.includes("I have the shell"), false);
  assert.match(cleaned, /Three-step plan for apps\/shell typecheck/);
  assert.match(cleaned, /1\. Change into/);
});

test("keeps I'll-inspect when no later plan body exists", () => {
  const raw = "I'll inspect apps/shell TypeScript config next.";
  assert.equal(collapseIntentThenDoneParagraphs(raw), raw);
});

test("drops Running-the-test lead-in when a later paragraph has pass counts", () => {
  const raw = [
    "Running the specified test in apps/shell with no file changes.",
    "",
    "pass 16 / fail 0",
  ].join("\n");
  const cleaned = collapseIntentThenDoneParagraphs(raw);
  assert.equal(cleaned.includes("Running the specified"), false);
  assert.equal(cleaned, "pass 16 / fail 0");
});

test("drops Running-the-check lead-in when a later paragraph is a bare exit code", () => {
  const raw = [
    "Running the TypeScript check in apps/shell and reporting only the exit code.",
    "",
    "0",
  ].join("\n");
  const cleaned = collapseIntentThenDoneParagraphs(raw);
  assert.equal(cleaned.includes("Running the TypeScript"), false);
  assert.equal(cleaned, "0");
});

test("drops I'll-read lead-in when a later paragraph is the numbered steps", () => {
  const raw = [
    "I'll read the first line of those two docs, then reply with the three numbered steps as requested.",
    "",
    "STEPS-VISIBLE-OK",
    "",
    "1. First line of docs/dogfood/KEEP.md is KEEP-FORTYEIGHT.",
    "",
    "2. First heading of docs/FORGE_DAILY_GOAL.md is Forge Code — daily-dev goal (accelerated).",
    "",
    "3. No files were edited and plan mode was not entered.",
  ].join("\n");
  const cleaned = collapseIntentThenDoneParagraphs(raw);
  assert.equal(cleaned.includes("I'll read"), false);
  assert.match(cleaned, /STEPS-VISIBLE-OK/);
  assert.match(cleaned, /1\. First line/);
});

test("cleanVendorAnswer runs reminder strip then intent collapse", () => {
  const raw = [
    "I'll create docs/dogfood/PLUSBAR.md.",
    "",
    "Created docs/dogfood/PLUSBAR.md.",
    "",
    "<system-reminder>ignore</system-reminder>",
  ].join("\n");
  const cleaned = cleanVendorAnswer(raw);
  assert.equal(cleaned.includes("I'll create"), false);
  assert.equal(cleaned.includes("system-reminder"), false);
  assert.match(cleaned, /Created docs\/dogfood\/PLUSBAR\.md/);
});
