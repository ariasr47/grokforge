import test from "node:test";
import assert from "node:assert/strict";
import { StdioAcpClient } from "./client.js";
import { isValidToolRunEvent } from "./types.js";

test("spawn config requires explicit profile and frozen environment", () => {
  const profile = { status:"available" as const, platform:"win32", osFamily:"windows" as const, executable:"C:\\Windows\\System32\\cmd.exe", argvPrefix:["/d","/s","/c"] as const, displayName:"Command Prompt (cmd.exe)", dialect:"cmd" as const, pathSeparator:"\\" as const, syntax:{quoting:"",chaining:"",redirection:""} };
  assert.ok(new StdioAcpClient({workspaceRoot:"C:\\repo",command:process.execPath,args:[],env:Object.freeze({FOO:"bar"}),executionProfile:profile}));
});
test("tool-run validator rejects legacy and illegal tuples", () => {
  assert.equal(isValidToolRunEvent({type:"tool_request",id:"x"}), false);
  assert.equal(isValidToolRunEvent({schemaVersion:2,type:"tool_run",activityId:"a",toolCallId:"c",lifecycle:"pending",execution:"executed",status:"succeeded"}), false);
  assert.equal(isValidToolRunEvent({schemaVersion:2,type:"tool_run",activityId:"a",toolCallId:"c",lifecycle:"terminal",execution:"not_executed",status:"rejected",name:"run_shell",input:{},summary:null,command:"ls",output:"",error:null,reasonCode:"leading_command_unresolved",reason:"missing",shellDisplayName:"Command Prompt (cmd.exe)",detailAvailable:true}), true);
  const base:any={schemaVersion:2,type:"tool_run",activityId:"a",toolCallId:"c",name:"run_shell",input:{},summary:null,command:"ls",output:null,error:null,reasonCode:null,reason:null,shellDisplayName:null,detailAvailable:true};
  assert.equal(isValidToolRunEvent({...base,lifecycle:"terminal",execution:"not_executed",status:"rejected",reasonCode:"invented",reason:"x"}),false);
  assert.equal(isValidToolRunEvent({...base,lifecycle:"pending",execution:null,status:"running",output:"terminal leaked"}),false);
  assert.equal(isValidToolRunEvent({...base,lifecycle:"terminal",execution:"executed",status:"succeeded",reasonCode:"leading_command_unresolved",reason:"wrong"}),false);
  const deleteRefuse:any={schemaVersion:2,type:"tool_run",activityId:"a",toolCallId:"c",lifecycle:"terminal",execution:"not_executed",status:"rejected",name:"delete_file",input:{},summary:null,command:null,output:"",error:null,reasonCode:"missing_target",reason:"missing_target",shellDisplayName:"cmd",detailAvailable:true,kind:null,fromPath:null,toPath:null};
  assert.equal(isValidToolRunEvent(deleteRefuse), true);
  assert.equal(isValidToolRunEvent({...deleteRefuse,reasonCode:"non_regular_file",reason:"non_regular_file"}), true);
  assert.equal(isValidToolRunEvent({...deleteRefuse,name:"rename_file",reasonCode:"dest_exists",reason:"dest_exists"}), true);
});
test("file_edit forwards kind, rename pair, and null diff", async () => {
  const script = `const r=require('readline').createInterface({input:process.stdin}); r.on('line',l=>{const m=JSON.parse(l); if(m.method==='initialize') process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{}})+'\\n'); if(m.method==='session/new'){ process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{sessionId:'capture'}})+'\\n'); process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'agent/file_edit',params:{id:'e-ren',editId:'e-ren',path:'from.txt',diff:null,status:'proposed',kind:'rename',fromPath:'from.txt',toPath:'to.txt',toolCallId:'call',invocationId:'call'}})+'\\n'); }});`;
  const profile = { status:"available" as const, platform:"win32", osFamily:"windows" as const, executable:"C:\\Windows\\System32\\cmd.exe", argvPrefix:["/d","/s","/c"] as const, displayName:"Command Prompt (cmd.exe)", dialect:"cmd" as const, pathSeparator:"\\" as const, syntax:{quoting:"",chaining:"",redirection:""} };
  const client = new StdioAcpClient({workspaceRoot:process.cwd(),command:process.execPath,args:["-e",script],env:Object.freeze({}),executionProfile:profile});
  let captured:any; const seen = new Promise<void>(resolve=>client.onEvent((event:any)=>{ if(event.type==="file_edit"){ captured=event; resolve(); } }));
  try {
    await client.initialize();
    await client.newSession();
    await Promise.race([seen, new Promise((_, reject) => setTimeout(() => reject(new Error("file_edit timeout")), 1000))]);
    assert.equal(captured.kind, "rename");
    assert.equal(captured.path, "from.txt");
    assert.equal(captured.fromPath, "from.txt");
    assert.equal(captured.toPath, "to.txt");
    assert.equal(captured.diff, null);
  } finally { await client.dispose(); }
});
test("child receives exact env and session/new profile without env serialization", async () => {
  const script = `const r=require('readline').createInterface({input:process.stdin}); r.on('line',l=>{const m=JSON.parse(l); if(m.method==='initialize') process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{}})+'\\n'); if(m.method==='session/new'){ process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{sessionId:'capture'}})+'\\n'); process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'agent/tool_run',params:{schemaVersion:2,type:'tool_run',activityId:'capture',toolCallId:'capture',lifecycle:'terminal',execution:'executed',status:'succeeded',name:'capture',input:null,summary:null,command:null,output:JSON.stringify({sentinel:process.env.SENTINEL||null,ambient:process.env.AMBIENT_SENTINEL||null,params:m.params}),error:null,reasonCode:null,reason:null,shellDisplayName:null,detailAvailable:true}})+'\\n'); }});`;
  const profile = { status:"available" as const, platform:"win32", osFamily:"windows" as const, executable:"C:\\Windows\\System32\\cmd.exe", argvPrefix:["/d","/s","/c"] as const, displayName:"Command Prompt (cmd.exe)", dialect:"cmd" as const, pathSeparator:"\\" as const, syntax:{quoting:"",chaining:"",redirection:""} };
  const client = new StdioAcpClient({workspaceRoot:process.cwd(),command:process.execPath,args:["-e",script],env:Object.freeze({SENTINEL:"exact-only"}),executionProfile:profile});
  let captured:any; const seen = new Promise<void>(resolve=>client.onEvent((event:any)=>{ if(event.type==="tool_run"){ captured=JSON.parse(event.output); resolve(); } }));
  try { await client.initialize(); const id=await client.newSession(); assert.equal(id,"capture"); await Promise.race([seen,new Promise((_,reject)=>setTimeout(()=>reject(new Error("capture timeout")),1000))]); assert.equal(captured.sentinel,"exact-only"); assert.equal(captured.ambient,null); assert.deepEqual(captured.params.executionProfile,profile); assert.equal(captured.params.cwd,process.cwd()); assert.equal("env" in captured.params,false); } finally { await client.dispose(); }
});
test("prompt serializes trustedCommandClasses onto session/prompt", async () => {
  const script = `const r=require('readline').createInterface({input:process.stdin}); r.on('line',l=>{const m=JSON.parse(l); if(m.method==='initialize') process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{}})+'\\n'); if(m.method==='session/new') process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{sessionId:'capture'}})+'\\n'); if(m.method==='session/prompt'){ process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{ok:true}})+'\\n'); process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'agent/tool_run',params:{schemaVersion:2,type:'tool_run',activityId:'p',toolCallId:'p',lifecycle:'terminal',execution:'executed',status:'succeeded',name:'capture',input:null,summary:null,command:null,output:JSON.stringify(m.params),error:null,reasonCode:null,reason:null,shellDisplayName:null,detailAvailable:true}})+'\\n'); }});`;
  const profile = { status:"available" as const, platform:"win32", osFamily:"windows" as const, executable:"C:\\Windows\\System32\\cmd.exe", argvPrefix:["/d","/s","/c"] as const, displayName:"Command Prompt (cmd.exe)", dialect:"cmd" as const, pathSeparator:"\\" as const, syntax:{quoting:"",chaining:"",redirection:""} };
  const client = new StdioAcpClient({workspaceRoot:process.cwd(),command:process.execPath,args:["-e",script],env:Object.freeze({}),executionProfile:profile});
  let captured:any; const seen = new Promise<void>(resolve=>client.onEvent((event:any)=>{ if(event.type==="tool_run"){ captured=JSON.parse(event.output); resolve(); } }));
  try {
    await client.initialize();
    await client.newSession();
    await client.prompt("capture", "hi", { runId: "run-1", connectionGeneration: 1, trustedCommandClasses: ["npm", "git:show"] });
    await Promise.race([seen, new Promise((_, reject) => setTimeout(() => reject(new Error("capture timeout")), 1000))]);
    assert.deepEqual(captured.trustedCommandClasses, ["npm", "git:show"]);
    assert.equal(captured.prompt, "hi");
  } finally { await client.dispose(); }
});
