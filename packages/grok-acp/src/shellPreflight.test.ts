import test from "node:test";
import assert from "node:assert/strict";
import { bindExecutionCapability } from "./executionCapability.js";
import { preflightShell } from "./shellPreflight.js";

const cap = bindExecutionCapability({ status: "available", platform: "win32", osFamily: "windows", executable: "C:\\Windows\\System32\\cmd.exe", argvPrefix: ["/d", "/s", "/c"], displayName: "Command Prompt (cmd.exe)", dialect: "cmd", pathSeparator: "\\", syntax: { quoting: "", chaining: "", redirection: "" } }, "C:\\repo", { Path: "C:\\bin", PATHEXT: ".EXE;.CMD" });
type StatFn = (p: string) => Promise<{ isFile: () => boolean }>;
const absent: StatFn = async (_p) => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); };
const found: StatFn = async (p) => ({ isFile: () => p.toLowerCase().endsWith(".exe") });
const uncertain: StatFn = async (_p) => { throw Object.assign(new Error("denied"), { code: "EACCES" }); };

const rows: Array<[string, "continue" | "reject", string | null, typeof absent]> = [
  ["FOO=bar echo ok", "reject", "shell_dialect_incompatible", absent],
  ["A=1 B=two echo ok", "reject", "shell_dialect_incompatible", absent],
  ['FOO="hello world" echo ok', "reject", "shell_dialect_incompatible", absent],
  ['echo "a & b"', "continue", null, absent],
  ["echo a ^& b", "continue", null, absent],
  ["echo a && echo b", "continue", null, absent],
  ["echo a || echo b", "continue", null, absent],
  ["echo a & echo b", "continue", null, absent],
  ["echo a | echo b", "continue", null, absent],
  ["echo ok && FOO=bar echo bad", "reject", "shell_dialect_incompatible", absent],
  ['set "NAME=value" && echo ok', "continue", null, absent],
  ["1BAD=x echo", "continue", null, found],
  ["FOO= echo", "reject", "shell_dialect_incompatible", absent],
  ["FOO=bar", "continue", null, absent],
  ['"FOO"=bar echo', "continue", null, absent],
  ['echo "unterminated', "continue", null, absent],
  ["echo dangling^", "continue", null, absent],
  ["echo ok &&", "continue", null, absent],
  ["(echo ok)", "continue", null, absent],
  ["echo %PATH%", "continue", null, absent],
  ["echo !PATH!", "continue", null, absent],
  ["echo ok", "continue", null, found],
  ["ls", "reject", "leading_command_unresolved", absent],
  ["C:\\missing\\thing.exe", "reject", "leading_command_unresolved", absent],
  ["echo ok", "continue", null, uncertain],
];

for (const [command, disposition, reasonCode, stat] of rows) {
  test(`${command} → ${disposition}`, async () => {
    const result = await preflightShell(cap, command, { stat: stat as never });
    assert.equal(result.disposition, disposition);
    if (reasonCode) assert.equal((result as { reasonCode?: string }).reasonCode, reasonCode);
  });
}

test("path entries are searched in cwd then ordered Path and PATHEXT", async () => {
  const calls: string[] = [];
  const result = await preflightShell(cap, "tool", { stat: (async (p: string) => { calls.push(p); if (p === "C:\\bin\\tool.EXE") return { isFile: () => true }; throw Object.assign(new Error(), { code: "ENOENT" }); }) as never });
  assert.equal(result.disposition, "continue");
  assert.ok(calls.includes("C:\\repo\\tool"));
  assert.ok(calls.includes("C:\\bin\\tool.EXE"));
});

test("malformed Path entries continue without authoritative rejection", async () => {
  const malformed = bindExecutionCapability(cap, "C:\\repo", { Path: "relative", PATHEXT: ".EXE" });
  assert.equal((await preflightShell(malformed, "ls", { stat: absent as never })).disposition, "continue");
});
