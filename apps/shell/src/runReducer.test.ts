import test from "node:test";
import assert from "node:assert/strict";
import { initialRunProjection, mergeRunSnapshot, reduceRunEvent, type RunEventEnvelope, type RunSnapshot } from "./runReducer";
const snap = (sessionId="s1", runId="r1"): RunSnapshot => ({ sessionId, runId, connectionGeneration:1, state:"admitted", acceptedPrompt:"prompt", admittedAt:"", updatedAt:"", lastEventSeq:0, policy:{mode:"review"}, model:{model:"grok-4.6"}, terminalKind:null, finalAnswer:null, answerVouched:false, failure:null });
const started = (s=snap(), seq=1): RunEventEnvelope => ({ schemaVersion:1,type:"run_started",sessionId:s.sessionId,runId:s.runId,eventSeq:seq,connectionGeneration:s.connectionGeneration,occurredAt:"",payload:{kind:"run_started",run:s} });
function event(payload: RunEventEnvelope["payload"], seq:number, s="s1", r="r1"): RunEventEnvelope { return {schemaVersion:1,type:payload.kind,sessionId:s,runId:r,eventSeq:seq,connectionGeneration:1,occurredAt:"",payload}; }
test("deduplicates replay by runId/eventSeq",()=>{const a=reduceRunEvent(initialRunProjection(),started()); assert.strictEqual(reduceRunEvent(a,started()),a);});
test("wrong session returns same reference",()=>{const a=reduceRunEvent(initialRunProjection(),started()); assert.strictEqual(reduceRunEvent(a,event({kind:"run_state",state:"running",liveness:null},2,"other")),a);});
test("stale generation returns same reference",()=>{const a=reduceRunEvent(initialRunProjection(),started()); const e=event({kind:"run_state",state:"running",liveness:null},2); e.connectionGeneration=2; assert.strictEqual(reduceRunEvent(a,e),a);});
test("reasoning and answer segments remain distinct",()=>{let a=reduceRunEvent(initialRunProjection(),started()); a=reduceRunEvent(a,event({kind:"reasoning_delta",segmentId:"x",delta:"think"},2)); a=reduceRunEvent(a,event({kind:"answer_delta",segmentId:"x",delta:"answer"},3)); assert.equal(a.runsById.r1.reasoning.x,"think"); assert.equal(a.runsById.r1.answer.x,"answer");});
test("answered terminal requires vouch",()=>{let a=reduceRunEvent(initialRunProjection(),started()); a=reduceRunEvent(a,event({kind:"run_terminal",terminalKind:"answered",finalAnswer:"answer",answerVouched:false,failure:null,terminalAt:""},2)); assert.equal(a.runsById.r1.finalAnswer,null);});
test("failed terminal retains null answer",()=>{let a=reduceRunEvent(initialRunProjection(),started()); a=reduceRunEvent(a,event({kind:"run_terminal",terminalKind:"failed",finalAnswer:null,answerVouched:false,failure:{code:"missing_final_answer",message:"Missing final answer",retryable:true,recoveryAction:"retry_prompt"},terminalAt:""},2)); assert.equal(a.runsById.r1.finalAnswer,null);});
test("late events cannot mutate terminal",()=>{let a=reduceRunEvent(initialRunProjection(),started()); a=reduceRunEvent(a,event({kind:"run_terminal",terminalKind:"cancelled",finalAnswer:null,answerVouched:false,failure:null,terminalAt:""},2)); assert.strictEqual(reduceRunEvent(a,event({kind:"answer_delta",segmentId:"x",delta:"late"},3)),a);});
test("replay cursor tracks last accepted event",()=>{let a=reduceRunEvent(initialRunProjection(),started()); a=reduceRunEvent(a,event({kind:"run_state",state:"running",liveness:"provider"},3)); assert.equal(a.sessionCursors.s1,3);});
test("snapshots remain immutable after event",()=>{let a=reduceRunEvent(initialRunProjection(),started()); const before=a.runsById.r1.policy; a=reduceRunEvent(a,event({kind:"run_state",state:"running",liveness:null},2)); assert.deepEqual(a.runsById.r1.policy,before);});
test("two sessions retain independent runs",()=>{let a=reduceRunEvent(initialRunProjection(),started(snap("s1","r1"))); a=reduceRunEvent(a,started(snap("s2","r2"))); assert.deepEqual(a.runOrder,["r1","r2"]);});
test("terminal projection cannot be downgraded by a late admission snapshot",()=>{let a=reduceRunEvent(initialRunProjection(),started()); a=reduceRunEvent(a,event({kind:"run_terminal",terminalKind:"answered",finalAnswer:"ok",answerVouched:true,failure:null,terminalAt:""},2)); const b=mergeRunSnapshot(a,{...snap(),state:"running"}); assert.equal(b.runsById.r1.state,"terminal"); assert.equal(b.runsById.r1.finalAnswer,"ok");});
test("terminal admission snapshot upgrades admitted projection without losing identity",()=>{let a=mergeRunSnapshot(initialRunProjection(),snap()); const b=mergeRunSnapshot(a,{...snap(),state:"terminal",terminalKind:"answered",finalAnswer:"ok",answerVouched:true,lastEventSeq:2}); assert.equal(b.runsById.r1.state,"terminal"); assert.equal(b.runsById.r1.acceptedPrompt,"prompt"); assert.equal(b.runsById.r1.lastEventSeq,0);});
test("activity_update copies original command and defaults missing command to null",()=>{
  let a=reduceRunEvent(initialRunProjection(),started());
  a=reduceRunEvent(a,event({kind:"activity_update",activity:{activityId:"a1",invocationId:"i1",name:"run_shell",lifecycle:"terminal",execution:"executed",status:"succeeded",input:{},output:"ok",error:null,diff:null,path:null,policy:{},automaticEligibility:"trusted_command_class",autoApplied:true,command:"npm test",editId:null,recovery:null}},2));
  assert.equal(a.runsById.r1.activities.a1.command,"npm test");
  a=reduceRunEvent(a,event({kind:"activity_update",activity:{activityId:"a2",invocationId:"i2",name:"read_file",lifecycle:"terminal",execution:"executed",status:"succeeded",input:{},output:"ok",error:null,diff:null,path:null,policy:{},automaticEligibility:"read",autoApplied:false,command:undefined as unknown as string,editId:null,recovery:null}},3));
  assert.equal(a.runsById.r1.activities.a2.command,null);
});
test("activity_update retains first-class path with diff and editId", () => {
  let a = reduceRunEvent(initialRunProjection(), started());
  a = reduceRunEvent(
    a,
    event(
      {
        kind: "activity_update",
        activity: {
          activityId: "a1",
          invocationId: "i1",
          name: "write_file",
          lifecycle: "terminal",
          execution: "executed",
          status: "succeeded",
          input: {},
          output: null,
          error: null,
          diff: "--- a/x\n+++ b/x\n+hi",
          path: "x.ts",
          policy: {},
          automaticEligibility: "text_edit",
          autoApplied: true,
          command: null,
          editId: "e1",
          recovery: { kind: "guarded_revert", available: true, status: "available" },
        },
      },
      2,
    ),
  );
  assert.equal(a.runsById.r1.activities.a1.path, "x.ts");
  assert.equal(a.runsById.r1.activities.a1.editId, "e1");
  assert.ok(a.runsById.r1.activities.a1.diff?.includes("+hi"));
});
test("activity_update defaults missing path to null", () => {
  let a = reduceRunEvent(initialRunProjection(), started());
  a = reduceRunEvent(
    a,
    event(
      {
        kind: "activity_update",
        activity: {
          activityId: "a3",
          invocationId: "i3",
          name: "read_file",
          lifecycle: "terminal",
          execution: "executed",
          status: "succeeded",
          input: {},
          output: "ok",
          error: null,
          diff: null,
          path: undefined as unknown as null,
          policy: {},
          automaticEligibility: "read",
          autoApplied: false,
          command: null,
          editId: null,
          recovery: null,
        },
      },
      2,
    ),
  );
  assert.equal(a.runsById.r1.activities.a3.path, null);
});
