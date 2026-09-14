import assert from "node:assert/strict";
import test from "node:test";
// Live: vendor non-zero exit must stay visible in Forge chrome.
import { outputImpliesNonZeroExit, vendorUpdateImpliesNonZeroExit } from "./vendorShellExit.js";

test("empty or missing output is not a failure", () => {
  assert.equal(outputImpliesNonZeroExit(null), false);
  assert.equal(outputImpliesNonZeroExit(""), false);
  assert.equal(outputImpliesNonZeroExit("   "), false);
});

test("JSON exit_code / exitCode", () => {
  assert.equal(outputImpliesNonZeroExit(JSON.stringify({ stdout: "", exit_code: 0 })), false);
  assert.equal(outputImpliesNonZeroExit(JSON.stringify({ exit_code: 2 })), true);
  assert.equal(outputImpliesNonZeroExit(JSON.stringify({ exitCode: 1 })), true);
});

test("Grok wrapper exit: N at the start of a line", () => {
  assert.equal(outputImpliesNonZeroExit("exit: 0\n"), false);
  assert.equal(
    outputImpliesNonZeroExit(
      "exit: 1\n\n<system-reminder>\nBackground task completed (exit code: 1).\n",
    ),
    true,
  );
});

test("completed (exit code: N) in a task reminder", () => {
  assert.equal(
    outputImpliesNonZeroExit('Background task "abc" completed (exit code: 1).'),
    true,
  );
  assert.equal(
    outputImpliesNonZeroExit('Background task "abc" completed (exit code: 0).'),
    false,
  );
});

test("a command string in the output is not enough", () => {
  assert.equal(outputImpliesNonZeroExit('Command: node -e "process.exit(2)"'), false);
});

test("Exit code: N prose from vendor shells", () => {
  assert.equal(outputImpliesNonZeroExit("Exit code: 1\n\nSyntaxError: Unexpected token"), true);
  assert.equal(outputImpliesNonZeroExit("exited with code 2"), true);
  assert.equal(outputImpliesNonZeroExit("exit status: 0"), false);
});

test("vendorUpdateImpliesNonZeroExit reads rawOutput objects", () => {
  assert.equal(
    vendorUpdateImpliesNonZeroExit({
      status: "completed",
      rawOutput: { stdout: "", stderr: "", exit_code: 2 },
    }),
    true,
  );
  assert.equal(
    vendorUpdateImpliesNonZeroExit({
      status: "completed",
      rawOutput: { stdout: "ok", exit_code: 0 },
    }),
    false,
  );
  assert.equal(
    vendorUpdateImpliesNonZeroExit({
      status: "completed",
      content: [{ type: "text", text: "Exit code: 1" }],
    }),
    true,
  );
});
