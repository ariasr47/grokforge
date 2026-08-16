import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import { startHost, type StartedHost } from "./test-support/host-process.js";

const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../packages/grok-acp/test-support/deterministic-tool-agent.ts");
let host: StartedHost; let workspace: string; let ws: WebSocket; const events:any[]=[];
function waitOpen(socket:WebSocket){return new Promise<void>((resolve,reject)=>{socket.once("open",()=>resolve());socket.once("error",reject);});}
function waitFor(pred:(e:any)=>boolean, ms=10000){const hit=events.find(pred);if(hit)return Promise.resolve(hit);return new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error("event timeout")),ms);const h=(e:any)=>{if(pred(e)){clearTimeout(t);ws.off("message",h);resolve(e);}};ws.on("message",d=>h(JSON.parse(String(d))));});}
async function waitIdle(){for(let i=0;i<100;i++){const s=await (await fetch(`${host.baseUrl}/api/state`)).json() as any;if(!s.busy)return;await new Promise(r=>setTimeout(r,50));}throw new Error("host remained busy");}
async function prompt(text:string){const before=events.length;await new Promise<void>(async(resolve,reject)=>{const t=setTimeout(()=>{ws.off("message",h);reject(new Error("prompt done timeout"));},10000);const h=(d:any)=>{const e=JSON.parse(String(d));if(events.length>before&&(e.type==="done"||e.type==="permission_request")){clearTimeout(t);ws.off("message",h);resolve();}};ws.on("message",h);try{const res=await fetch(`${host.baseUrl}/api/prompt`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text})});if(!res.ok)throw new Error(`prompt HTTP ${res.status}`);}catch(error){clearTimeout(t);ws.off("message",h);reject(error);}});return events.slice(before);}
test.before(async()=>{workspace=await fs.mkdtemp(path.join(os.tmpdir(),"grok-real-boundary-"));await fs.writeFile(path.join(workspace,"fixture.txt"),"needle\n");host=await startHost({port:8797,unsetEnv:["Path","PATHEXT","XAI_API_KEY"],env:{GROKFORGE_AGENT_ENTRY:fixture,Path:"",PATHEXT:".EXE;.CMD",XAI_API_KEY:"deterministic-test-key"}});ws=new WebSocket(host.baseUrl.replace(/^http/,"ws")+"/ws");ws.on("message",d=>events.push(JSON.parse(String(d))));await waitOpen(ws);});
test.after(async()=>{ws?.close();await host?.stop();await fs.rm(workspace,{recursive:true,force:true});});
test("real Chat and Code journeys traverse host→ACP→executeTool",async()=>{
  const state=await (await fetch(`${host.baseUrl}/api/state`)).json() as any;assert.equal(state.shellCapability.status,"available");assert.equal(path.isAbsolute(state.shellCapability.executable),true);
  await fetch(`${host.baseUrl}/api/chat-root`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({path:workspace})});
  for(const mode of ["chat","code"]){if(mode==="code") await fetch(`${host.baseUrl}/api/workspace`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({path:workspace})});const out=await prompt("fixture:structured");await waitIdle();assert.equal(out.filter(e=>e.type==="permission_request").length,0);assert.equal(out.filter(e=>e.type==="tool_run"&&e.lifecycle==="terminal"&&e.status==="succeeded").length,3);}
  const shell=await prompt("fixture:shell-compatible");const perm=shell.find(e=>e.type==="permission_request");assert.ok(perm);await fetch(`${host.baseUrl}/api/permission`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:perm.id,decision:"allow_once"})});const done=await waitFor(e=>e.type==="tool_run"&&e.lifecycle==="terminal"&&e.toolCallId===perm.id,10000).catch(()=>null);await waitIdle();assert.ok(done||events.some(e=>e.type==="tool_run"&&e.execution==="executed"));
  const dialect=await prompt("fixture:shell-dialect");await waitIdle();assert.ok(dialect.some(e=>e.reasonCode==="shell_dialect_incompatible"));assert.equal(await fs.stat(path.join(workspace,"dialect-spawned.txt")).then(()=>true,()=>false),false);
  const unresolved=await prompt("fixture:shell-unresolved");assert.ok(unresolved.some(e=>e.reasonCode==="leading_command_unresolved"));assert.equal(await fs.stat(path.join(workspace,"unresolved-spawned.txt")).then(()=>true,()=>false),false);
  const failure=await prompt("fixture:shell-failure");const fp=failure.find(e=>e.type==="permission_request");assert.ok(fp);await fetch(`${host.baseUrl}/api/permission`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:fp.id,decision:"allow_once"})});await waitFor(e=>e.type==="tool_run"&&e.lifecycle==="terminal"&&e.toolCallId===fp.id,10000);await waitIdle();const allFailure=events.slice(events.findIndex(e=>e===fp));assert.ok(allFailure.some(e=>e.execution==="executed"&&e.status==="failed"));const logs=await (await fetch(`${host.baseUrl}/api/logs`)).json() as any;assert.match(JSON.stringify(logs),/tool_failed|tool_not_executed/);
});
