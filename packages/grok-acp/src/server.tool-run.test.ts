import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { preflightShell } from "./shellPreflight.js";
import { bindExecutionCapability } from "./executionCapability.js";

test("server boundary rejects missing shell command before permission", async () => {
  const cap = bindExecutionCapability({ status:"available", platform:"win32", osFamily:"windows", executable:"C:\\Windows\\System32\\cmd.exe", argvPrefix:["/d","/s","/c"], displayName:"Command Prompt (cmd.exe)", dialect:"cmd", pathSeparator:"\\", syntax:{quoting:"",chaining:"",redirection:""} }, "C:\\repo", {});
  const result = await preflightShell(cap, "ls", { stat: async () => { throw Object.assign(new Error(), { code:"ENOENT" }); } } as never);
  assert.equal((result as {reasonCode?:string}).reasonCode, "leading_command_unresolved");
});

test("server refuses session construction without host execution profile", async () => {
  const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], { cwd:path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), stdio:["pipe","pipe","pipe"], windowsHide:true });
  const rl = createInterface({ input:child.stdout });
  const next = () => new Promise<string>((resolve,reject) => { const timer=setTimeout(() => reject(new Error("timeout")), 2000); const handler=(line:string)=>{clearTimeout(timer); rl.removeListener("line",handler); resolve(line);}; rl.on("line",handler); });
  child.stdin.write(JSON.stringify({jsonrpc:"2.0",id:1,method:"session/new",params:{cwd:process.cwd()}})+"\n");
  assert.match(await next(), /Missing or invalid host execution profile/);
  child.kill(); rl.close();
});
