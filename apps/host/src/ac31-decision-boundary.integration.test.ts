import test from "node:test";
import assert from "node:assert/strict";
import { AgentSession } from "./session.js";

const policy:any={workspace:"C:\\workspace",storedMode:null,effectiveMode:"review",source:"fallback",revision:"r",fallbackReason:"missing",snapshottedAt:new Date().toISOString()};
function harness(kind:"permission"|"diff", state:"running"|"terminal"="running", generation=1, expiresAt=Date.now()+60_000){
  let calls=0;
  const s=Object.create(AgentSession.prototype) as any;
  s.client=kind==="permission"?{respondPermission:async()=>{calls++}}:{respondEdit:async()=>{calls++}};
  s.sessionId="acp"; s.pendingDecisions=new Map([["request",{sessionId:"stable",runId:"run",generation,invocationId:"inv",kind,status:"pending",expiresAt}]]);
  s.runCoordinator={get:()=>({sessionId:"stable",runId:"run",state,connectionGeneration:1,policy}),appendOwnedEvent:async()=>{}};
  s.getRun=(runId:string,sessionId:string)=>runId==="run"&&sessionId==="stable"?s.runCoordinator.get():undefined;
  return {s,get calls(){return calls}};
}

for(const kind of ["permission","diff"] as const){
  test(`AC31 ${kind}: a late Allow still reaches ACP`, async()=>{
    const h=harness(kind,"running",1,Date.now()-400_000);
    if(kind==="permission"){
      const settled=await h.s.permission("request","allow_once",{sessionId:"stable",runId:"run",connectionGeneration:1},"inv");
      assert.equal(settled,"accepted");
    }else{
      const settled=await h.s.diffAction("request","accept",{sessionId:"stable",runId:"run",connectionGeneration:1},"inv");
      assert.equal(settled,"accepted");
    }
    assert.equal(h.calls,1);
  });
  test(`AC31 ${kind}: cancelled request is not pending and has no ACP effect`, async()=>{
    const h=harness(kind); h.s.pendingDecisions.get("request").status="declined";
    const op=kind==="permission"?h.s.permission("request","allow_once",{sessionId:"stable",runId:"run",connectionGeneration:1},"inv"):h.s.diffAction("request","accept",{sessionId:"stable",runId:"run",connectionGeneration:1},"inv");
    await assert.rejects(op,(e:any)=>e?.code==="decision_not_found"); assert.equal(h.calls,0);
  });
  test(`AC31 ${kind}: replaced generation is stale and has no ACP effect`, async()=>{
    const h=harness(kind,"running",1); const ownership={sessionId:"stable",runId:"run",connectionGeneration:2};
    const op=kind==="permission"?h.s.permission("request","allow_once",ownership,"inv"):h.s.diffAction("request","accept",ownership,"inv");
    await assert.rejects(op,(e:any)=>e?.code==="decision_not_found"); assert.equal(h.calls,0);
  });
  test(`AC31 ${kind}: terminal run is immutable and has no ACP effect`, async()=>{
    const h=harness(kind,"terminal");
    const op=kind==="permission"?h.s.permission("request","allow_once",{sessionId:"stable",runId:"run",connectionGeneration:1},"inv"):h.s.diffAction("request","accept",{sessionId:"stable",runId:"run",connectionGeneration:1},"inv");
    await assert.rejects(op,(e:any)=>e?.code==="run_terminal"); assert.equal(h.calls,0);
  });
}
