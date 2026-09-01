import test from "node:test"; import assert from "node:assert/strict"; import { systemPromptForMode } from "./xai.js";
import { toolDefinitionsFor } from "./tools.js";
test("system prompt names explicit shell and structured tools",()=>{ const text=systemPromptForMode({status:"available",platform:"win32",executable:"C:\\Windows\\System32\\cmd.exe",displayName:"Command Prompt (cmd.exe)",dialect:"cmd"}); assert.match(text,/Command Prompt/); assert.match(text,/list_dir/); assert.match(text,/delete_file \/ rename_file/); });
test("unavailable prompt carries canonical reason",()=>{ const text=systemPromptForMode({status:"unavailable",platform:"plan9",reasonCode:"unsupported_platform",reason:"Unsupported host platform"}); assert.match(text,/unsupported_platform/); });
test("A4 named package tests stay in that package — not the workspace-root script",()=>{
  const text=systemPromptForMode({status:"available",platform:"win32",executable:"C:\\Windows\\System32\\cmd.exe",displayName:"Command Prompt (cmd.exe)",dialect:"cmd"});
  assert.match(text,/npm test -w/);
  assert.match(text,/workspace-root test script/);
  assert.match(text,/node --test/);
  assert.match(text,/walk up to the workspace-root/);
  assert.match(text,/do not immediately retry the same command/i);
  assert.match(text,/do step 1 only/i);
  assert.match(text,/Do not treat a read or list as step 1/);
  const shell=toolDefinitionsFor({status:"available",displayName:"Command Prompt (cmd.exe)",dialect:"cmd"}).find((t)=>t.function.name==="run_shell");
  assert.match(shell?.function.description??"",/cd into it first/);
  assert.match(shell?.function.description??"",/npm test -w/);
});
