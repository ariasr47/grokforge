import test from "node:test";
import assert from "node:assert/strict";
// Plan-phase updates are vendor ACP, not a Forge plan engine.
import { StdioAcpClient } from "./client.js";
import { isValidToolRunEvent } from "./types.js";

test("prompt serializes executionPhase onto session/prompt", async () => {
  const script = `const r=require('readline').createInterface({input:process.stdin}); r.on('line',l=>{const m=JSON.parse(l); if(m.method==='initialize') process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{}})+'\\n'); if(m.method==='session/new') process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{sessionId:'capture'}})+'\\n'); if(m.method==='session/prompt'){ process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{ok:true}})+'\\n'); process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'agent/tool_run',params:{schemaVersion:2,type:'tool_run',activityId:'p',toolCallId:'p',lifecycle:'terminal',execution:'executed',status:'succeeded',name:'capture',input:null,summary:null,command:null,output:JSON.stringify(m.params),error:null,reasonCode:null,reason:null,shellDisplayName:null,detailAvailable:true}})+'\\n'); }});`;
  const profile = { status:"available" as const, platform:"win32", osFamily:"windows" as const, executable:"C:\\Windows\\System32\\cmd.exe", argvPrefix:["/d","/s","/c"] as const, displayName:"Command Prompt (cmd.exe)", dialect:"cmd" as const, pathSeparator:"\\" as const, syntax:{quoting:"",chaining:"",redirection:""} };
  const client = new StdioAcpClient({workspaceRoot:process.cwd(),command:process.execPath,args:["-e",script],env:Object.freeze({}),executionProfile:profile});
  let captured:any; const seen = new Promise<void>(resolve=>client.onEvent((event:any)=>{ if(event.type==="tool_run"){ captured=JSON.parse(event.output); resolve(); } }));
  try {
    await client.initialize();
    await client.newSession();
    await client.prompt("capture", "hi", { runId: "run-1", connectionGeneration: 1, executionPhase: "plan" });
    await Promise.race([seen, new Promise((_, reject) => setTimeout(() => reject(new Error("capture timeout")), 1000))]);
    assert.equal(captured.executionPhase, "plan");
    assert.equal(captured.prompt, "hi");
  } finally { await client.dispose(); }
});

test("prompt defaults executionPhase to execute", async () => {
  const script = `const r=require('readline').createInterface({input:process.stdin}); r.on('line',l=>{const m=JSON.parse(l); if(m.method==='initialize') process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{}})+'\\n'); if(m.method==='session/new') process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{sessionId:'capture'}})+'\\n'); if(m.method==='session/prompt'){ process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{ok:true}})+'\\n'); process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'agent/tool_run',params:{schemaVersion:2,type:'tool_run',activityId:'p',toolCallId:'p',lifecycle:'terminal',execution:'executed',status:'succeeded',name:'capture',input:null,summary:null,command:null,output:JSON.stringify(m.params),error:null,reasonCode:null,reason:null,shellDisplayName:null,detailAvailable:true}})+'\\n'); }});`;
  const profile = { status:"available" as const, platform:"win32", osFamily:"windows" as const, executable:"C:\\Windows\\System32\\cmd.exe", argvPrefix:["/d","/s","/c"] as const, displayName:"Command Prompt (cmd.exe)", dialect:"cmd" as const, pathSeparator:"\\" as const, syntax:{quoting:"",chaining:"",redirection:""} };
  const client = new StdioAcpClient({workspaceRoot:process.cwd(),command:process.execPath,args:["-e",script],env:Object.freeze({}),executionProfile:profile});
  let captured:any; const seen = new Promise<void>(resolve=>client.onEvent((event:any)=>{ if(event.type==="tool_run"){ captured=JSON.parse(event.output); resolve(); } }));
  try {
    await client.initialize();
    await client.newSession();
    await client.prompt("capture", "hi", { runId: "run-1", connectionGeneration: 1 });
    await Promise.race([seen, new Promise((_, reject) => setTimeout(() => reject(new Error("capture timeout")), 1000))]);
    assert.equal(captured.executionPhase, "execute");
    assert.equal(captured.sessionWrite, false);
    assert.equal(captured.sessionShell, false);
  } finally { await client.dispose(); }
});

test("prompt serializes Always-this-chat grants onto session/prompt", async () => {
  const script = `const r=require('readline').createInterface({input:process.stdin}); r.on('line',l=>{const m=JSON.parse(l); if(m.method==='initialize') process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{}})+'\\n'); if(m.method==='session/new') process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{sessionId:'capture'}})+'\\n'); if(m.method==='session/prompt'){ process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{ok:true}})+'\\n'); process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'agent/tool_run',params:{schemaVersion:2,type:'tool_run',activityId:'p',toolCallId:'p',lifecycle:'terminal',execution:'executed',status:'succeeded',name:'capture',input:null,summary:null,command:null,output:JSON.stringify(m.params),error:null,reasonCode:null,reason:null,shellDisplayName:null,detailAvailable:true}})+'\\n'); }});`;
  const profile = { status:"available" as const, platform:"win32", osFamily:"windows" as const, executable:"C:\\Windows\\System32\\cmd.exe", argvPrefix:["/d","/s","/c"] as const, displayName:"Command Prompt (cmd.exe)", dialect:"cmd" as const, pathSeparator:"\\" as const, syntax:{quoting:"",chaining:"",redirection:""} };
  const client = new StdioAcpClient({workspaceRoot:process.cwd(),command:process.execPath,args:["-e",script],env:Object.freeze({}),executionProfile:profile});
  let captured:any; const seen = new Promise<void>(resolve=>client.onEvent((event:any)=>{ if(event.type==="tool_run"){ captured=JSON.parse(event.output); resolve(); } }));
  try {
    await client.initialize();
    await client.newSession();
    await client.prompt("capture", "hi", { runId: "run-1", connectionGeneration: 1, sessionWrite: true, sessionShell: true });
    await Promise.race([seen, new Promise((_, reject) => setTimeout(() => reject(new Error("capture timeout")), 1000))]);
    assert.equal(captured.sessionWrite, true);
    assert.equal(captured.sessionShell, true);
  } finally { await client.dispose(); }
});

test("prompt serializes denied write paths onto session/prompt", async () => {
  const script = `const r=require('readline').createInterface({input:process.stdin}); r.on('line',l=>{const m=JSON.parse(l); if(m.method==='initialize') process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{}})+'\\n'); if(m.method==='session/new') process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{sessionId:'capture'}})+'\\n'); if(m.method==='session/prompt'){ process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{ok:true}})+'\\n'); process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'agent/tool_run',params:{schemaVersion:2,type:'tool_run',activityId:'p',toolCallId:'p',lifecycle:'terminal',execution:'executed',status:'succeeded',name:'capture',input:null,summary:null,command:null,output:JSON.stringify(m.params),error:null,reasonCode:null,reason:null,shellDisplayName:null,detailAvailable:true}})+'\\n'); }});`;
  const profile = { status:"available" as const, platform:"win32", osFamily:"windows" as const, executable:"C:\\Windows\\System32\\cmd.exe", argvPrefix:["/d","/s","/c"] as const, displayName:"Command Prompt (cmd.exe)", dialect:"cmd" as const, pathSeparator:"\\" as const, syntax:{quoting:"",chaining:"",redirection:""} };
  const client = new StdioAcpClient({workspaceRoot:process.cwd(),command:process.execPath,args:["-e",script],env:Object.freeze({}),executionProfile:profile});
  let captured:any; const seen = new Promise<void>(resolve=>client.onEvent((event:any)=>{ if(event.type==="tool_run"){ captured=JSON.parse(event.output); resolve(); } }));
  try {
    await client.initialize();
    await client.newSession();
    await client.prompt("capture", "hi", { runId: "run-1", connectionGeneration: 1, sessionWrite: true, deniedWritePaths: ["docs/dogfood/fold.js"] });
    await Promise.race([seen, new Promise((_, reject) => setTimeout(() => reject(new Error("capture timeout")), 1000))]);
    assert.deepEqual(captured.deniedWritePaths, ["docs/dogfood/fold.js"]);
  } finally { await client.dispose(); }
});

test("plan_phase_refused is a valid not_executed reason code", () => {
  assert.equal(isValidToolRunEvent({
    schemaVersion: 2,
    type: "tool_run",
    activityId: "a",
    toolCallId: "c",
    lifecycle: "terminal",
    execution: "not_executed",
    status: "rejected",
    name: "write_file",
    input: {},
    summary: null,
    command: null,
    output: "",
    error: null,
    reasonCode: "plan_phase_refused",
    reason: "Plan phase: edits and non-inspection shell are not executed",
    shellDisplayName: "Command Prompt (cmd.exe)",
    detailAvailable: true,
  }), true);
});
