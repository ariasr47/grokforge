import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { resolveHostExecutionEnvironment } from "./executionEnvironment.js";

test("windows resolves ComSpec case-insensitively and redacts internals", () => {
  const r = resolveHostExecutionEnvironment({ platform:"win32", environment:{ cOmSpEc:"C:\\Windows\\System32\\cmd.exe", SECRET:"x" }, isFile:p=>p.toLowerCase().endsWith("cmd.exe") });
  assert.equal(r.profile.status,"available"); assert.deepEqual(r.profile.argvPrefix,["/d","/s","/c"]); assert.equal(r.publicView.reasonCode,null); assert.equal((r.publicView as any).effectiveEnvironment,undefined); assert.equal(Object.isFrozen(r.effectiveEnvironment),true);
});
test("windows falls back to SystemRoot and rejects unsupported", () => {
  const r = resolveHostExecutionEnvironment({ platform:"win32", environment:{ SystemRoot:"D:\\Windows" }, isFile:p=>p === "D:\\Windows\\System32\\cmd.exe" });
  assert.equal(r.profile.executable,"D:\\Windows\\System32\\cmd.exe");
  const u = resolveHostExecutionEnvironment({ platform:"plan9", environment:{} }); assert.equal(u.publicView.reasonCode,"unsupported_platform");
});
test("relative or missing ComSpec falls back or reports resolution failure", () => {
  const relative = resolveHostExecutionEnvironment({ platform:"win32", environment:{ComSpec:"cmd.exe",SystemRoot:"C:\\Windows"}, isFile:p=>p === "C:\\Windows\\System32\\cmd.exe" }); assert.equal(relative.profile.status,"available");
  const missing = resolveHostExecutionEnvironment({ platform:"win32", environment:{ComSpec:"C:\\Nope\\cmd.exe",SystemRoot:"C:\\Windows"}, isFile:()=>false }); assert.equal(missing.publicView.reasonCode,"shell_resolution_failed");
});
test("environment copy is exact and immutable", () => { const source={Path:"C:\\bin", Secret:"no"}; const r=resolveHostExecutionEnvironment({platform:"win32",environment:source,isFile:()=>false}); assert.deepEqual(r.effectiveEnvironment,source); assert.equal(Object.isFrozen(r.effectiveEnvironment),true); source.Path="changed"; assert.equal(r.effectiveEnvironment.Path,"C:\\bin"); assert.equal(JSON.stringify(r.publicView).includes("Secret"),false); });
test("real Windows profile is absolute and existing", () => { if (process.platform !== "win32") return; const r=resolveHostExecutionEnvironment({platform:process.platform,environment:process.env}); assert.equal(r.profile.status,"available"); assert.equal(path.isAbsolute(r.profile.executable),true); assert.equal(fs.existsSync(r.profile.executable),true); });
