import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { startHost } from "./test-support/host-process.js";
import { resolveConfinedTarget } from "./workspace-confinement.js";

async function freePort() { const s=net.createServer(); await new Promise<void>((r,j)=>s.listen(0,"127.0.0.1",()=>r()).on("error",j)); const p=(s.address() as net.AddressInfo).port; await new Promise<void>(r=>s.close(()=>r())); return p; }
async function settle(baseUrl:string) { for(let i=0;i<200;i++){const s=await (await fetch(baseUrl+"/api/state")).json() as any;if(!s.busy)return s;await new Promise(r=>setTimeout(r,20));} throw new Error("fixture did not settle"); }
async function admit(baseUrl:string,sessionId:string,text:string){const r=await fetch(baseUrl+"/api/prompt",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({sessionId,text,effort:"auto",history:[]})});const raw=await r.text();assert.equal(r.status,202,`${text}: ${raw}`);return (JSON.parse(raw) as any).run as {runId:string};}
async function replayUntil(baseUrl:string,sessionId:string,runId:string,predicate:(body:any)=>boolean){for(let i=0;i<250;i++){const r=await fetch(`${baseUrl}/api/runs/${runId}?sessionId=${sessionId}&after=0`);if(r.ok){const body=await r.json();if(predicate(body))return body;}await new Promise(resolve=>setTimeout(resolve,20));}throw new Error(`run ${runId} did not reach expected state`);}
const here=path.dirname(fileURLToPath(import.meta.url));
function fixtureEnv(){return {GROKFORGE_AGENT_ENTRY:path.resolve(here,"../../../packages/grok-acp/test-support/deterministic-tool-agent.ts"),XAI_API_KEY:"fixture"};}

test("production HTTP/ACP boundary enforces canonical confinement and fixed inspection", async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"rar-confine-")), outside=await fs.mkdtemp(path.join(os.tmpdir(),"rar-outside-")); await fs.writeFile(path.join(root,"fixture.txt"),"needle\n"); await fs.writeFile(path.join(outside,"secret.txt"),"secret"); const host=await startHost({port:await freePort(),env:fixtureEnv()});
 try { await (await fetch(host.baseUrl+"/api/workspace",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({path:root})})).json(); const ok=await fetch(host.baseUrl+"/api/workspace/read?path=fixture.txt"); assert.equal(ok.status,200); assert.equal((await ok.json() as any).content,"needle\n"); const absolute=await fetch(host.baseUrl+"/api/workspace/read?path="+encodeURIComponent(path.join(root,"fixture.txt"))); assert.equal(absolute.status,200); assert.equal((await absolute.json() as any).content,"needle\n"); const missing=await fetch(host.baseUrl+"/api/workspace/read?path=missing.txt"); assert.equal(missing.status,404); const esc=await fetch(host.baseUrl+"/api/workspace/read?path="+encodeURIComponent("..\\secret.txt")); assert.equal(esc.status,400); let linked=true; try{await fs.symlink(path.join(outside,"secret.txt"),path.join(root,"link.txt"));}catch{linked=false;} if(linked){const sy=await fetch(host.baseUrl+"/api/workspace/read?path=link.txt"); assert.notEqual(sy.status,200);} const prompt=await fetch(host.baseUrl+"/api/prompt",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({text:"fixture:structured"})}); assert.equal(prompt.status,200); const state=await settle(host.baseUrl); assert.equal(state.busy,false); assert.ok(state.session); }
 finally {await host.stop(); await fs.rm(root,{recursive:true,force:true}); await fs.rm(outside,{recursive:true,force:true});}
});

test("production workspace read rejects a Windows directory junction escape", async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"rar-junction-root-"));
 const outside=await fs.mkdtemp(path.join(os.tmpdir(),"rar-junction-outside-"));
 await fs.writeFile(path.join(outside,"secret.txt"),"outside secret\n");
 const junction=path.join(root,"escape");
 const host=await startHost({port:await freePort(),env:fixtureEnv()});
 try {
  await fs.symlink(outside,junction,"junction");
  const opened=await fetch(host.baseUrl+"/api/workspace",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({path:root})});
  assert.equal(opened.status,200);
  const escaped=await fetch(host.baseUrl+"/api/workspace/read?path="+encodeURIComponent("escape/secret.txt"));
  assert.equal(escaped.status,400,await escaped.text());
 } finally { await host.stop(); await fs.rm(root,{recursive:true,force:true}); await fs.rm(outside,{recursive:true,force:true}); }
});

test("confinement fails closed on non-absence realpath errors", async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"rar-invalid-path-"));
 try {
  await assert.rejects(
   () => resolveConfinedTarget({workspace:root,target:"invalid\0path",kind:"read"}),
   (error:any) => error?.code === "ERR_INVALID_ARG_VALUE",
  );
 } finally { await fs.rm(root,{recursive:true,force:true}); }
});

test("production ACP boundary applies Trusted text only and protects binary/root delete", async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"rar-policy-")); const host=await startHost({port:await freePort(),env:fixtureEnv()});
 try {
  await fetch(host.baseUrl+"/api/workspace",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({path:root})});
  const sessionId="policy-session";
  const saved=await fetch(host.baseUrl+"/api/workspace-policy",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({sessionId,workspace:root,mode:"trusted_workspace"})});
  assert.equal(saved.status,200);
  const trusted=await admit(host.baseUrl,sessionId,"fixture:trusted-edit");
  const trustedReplay=await replayUntil(host.baseUrl,sessionId,trusted.runId,body=>body.run?.state==="terminal");
  for (const event of trustedReplay.events) { assert.equal(event.sessionId,sessionId,JSON.stringify(event)); assert.equal(event.runId,trusted.runId,JSON.stringify(event)); }
  assert.equal(trustedReplay.run.policy.effectiveMode,"trusted_workspace");
  const trustedActivity=trustedReplay.events.find((event:any)=>event.type==="activity_update"&&event.payload?.activity?.name==="write_file"&&event.payload?.activity?.lifecycle==="terminal");
  assert.ok(trustedActivity,JSON.stringify(trustedReplay.events));
  assert.equal(trustedActivity.payload.activity.autoApplied,true,JSON.stringify(trustedActivity));
  assert.equal(await fs.readFile(path.join(root,"trusted.txt"),"utf8"),"trusted text");
  const journalDir=path.join(host.dataDir,"edit-recovery");
  const journalFiles=await fs.readdir(journalDir);
  assert.equal(journalFiles.length,1);
  const journal=JSON.parse(await fs.readFile(path.join(journalDir,journalFiles[0]),"utf8"));
  assert.equal(journal.runId,trusted.runId);
  const recovered=await fetch(host.baseUrl+"/api/edit-recovery",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({sessionId,runId:trusted.runId,editId:journal.editId})});
  assert.equal(recovered.status,200,await recovered.text());
  assert.equal(await fs.stat(path.join(root,"trusted.txt")).then(()=>true,()=>false),false);

  const conflictRun=await admit(host.baseUrl,sessionId,"fixture:trusted-edit");
  const conflictReplay=await replayUntil(host.baseUrl,sessionId,conflictRun.runId,body=>body.run?.state==="terminal");
  assert.equal(conflictReplay.run.state,"terminal");
  const allJournals=await Promise.all((await fs.readdir(journalDir)).map(async file=>({file,entry:JSON.parse(await fs.readFile(path.join(journalDir,file),"utf8")) as any})));
  const conflictJournal=allJournals.find(({entry})=>entry.runId===conflictRun.runId);
  assert.ok(conflictJournal,JSON.stringify(allJournals));
  await fs.writeFile(path.join(root,"trusted.txt"),"user change","utf8");
  const conflict=await fetch(host.baseUrl+"/api/edit-recovery",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({sessionId,runId:conflictRun.runId,editId:conflictJournal!.entry.editId})});
  const conflictBody=await conflict.json() as any;
  assert.equal(conflict.status,409,JSON.stringify(conflictBody));
  assert.equal(conflictBody.code,"recovery_conflict");
  assert.equal(await fs.readFile(path.join(root,"trusted.txt"),"utf8"),"user change");

  const binary=await admit(host.baseUrl,sessionId,"fixture:binary-edit");
  await replayUntil(host.baseUrl,sessionId,binary.runId,body=>body.events?.some((event:any)=>event.type==="decision_request"));
  const cancelled=await fetch(host.baseUrl+"/api/cancel",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({sessionId,runId:binary.runId})});
  assert.equal(cancelled.status,202);
  await replayUntil(host.baseUrl,sessionId,binary.runId,body=>body.run?.state==="terminal");
  assert.equal(await fs.stat(path.join(root,"binary.bin")).then(()=>true,()=>false),false);

  const protectedRun=await admit(host.baseUrl,sessionId,"fixture:protected-delete");
  const protectedReplay=await replayUntil(host.baseUrl,sessionId,protectedRun.runId,body=>body.run?.state==="terminal");
  assert.ok(protectedReplay.events.some((event:any)=>event.type==="activity_update"&&event.payload?.activity?.execution==="not_executed"));
  assert.equal(await fs.stat(root).then(()=>true,()=>false),true);
 }
 finally {await host.stop(); await fs.rm(root,{recursive:true,force:true});}
});
