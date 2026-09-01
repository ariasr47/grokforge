import test from "node:test";
import assert from "node:assert/strict";
import { initialRunProjection, isPostTerminalEventType, isRunStreamDelta, mergeRunSnapshot, persistableRunProjection, POST_TERMINAL_EVENT_TYPES, reduceRunEvent, restoreRunProjection, type RunEventEnvelope, type RunSnapshot } from "./runReducer";
const snap = (sessionId="s1", runId="r1"): RunSnapshot => ({ sessionId, runId, connectionGeneration:1, state:"admitted", acceptedPrompt:"prompt", admittedAt:"", updatedAt:"", lastEventSeq:0, policy:{mode:"review"}, model:{model:"grok-4.6"}, terminalKind:null, finalAnswer:null, answerVouched:false, failure:null });
const started = (s=snap(), seq=1): RunEventEnvelope => ({ schemaVersion:1,type:"run_started",sessionId:s.sessionId,runId:s.runId,eventSeq:seq,connectionGeneration:s.connectionGeneration,occurredAt:"",payload:{kind:"run_started",run:s} });
function event(payload: RunEventEnvelope["payload"], seq:number, s="s1", r="r1"): RunEventEnvelope { return {schemaVersion:1,type:payload.kind,sessionId:s,runId:r,eventSeq:seq,connectionGeneration:1,occurredAt:"",payload}; }
test("answer and reasoning deltas are the only coalesced live kinds", () => {
  assert.equal(isRunStreamDelta("answer_delta"), true);
  assert.equal(isRunStreamDelta("reasoning_delta"), true);
  assert.equal(isRunStreamDelta("run_terminal"), false);
  assert.equal(isRunStreamDelta("activity_update"), false);
  assert.equal(isRunStreamDelta("decision_request"), false);
  assert.equal(isRunStreamDelta("run_state"), false);
});
test("deduplicates replay by runId/eventSeq",()=>{const a=reduceRunEvent(initialRunProjection(),started()); assert.strictEqual(reduceRunEvent(a,started()),a);});
test("wrong session returns same reference",()=>{const a=reduceRunEvent(initialRunProjection(),started()); assert.strictEqual(reduceRunEvent(a,event({kind:"run_state",state:"running",liveness:null},2,"other")),a);});
test("stale generation returns same reference",()=>{const a=reduceRunEvent(initialRunProjection(),started()); const e=event({kind:"run_state",state:"running",liveness:null},2); e.connectionGeneration=2; assert.strictEqual(reduceRunEvent(a,e),a);});
test("reasoning and answer segments remain distinct",()=>{let a=reduceRunEvent(initialRunProjection(),started()); a=reduceRunEvent(a,event({kind:"reasoning_delta",segmentId:"x",delta:"think"},2)); a=reduceRunEvent(a,event({kind:"answer_delta",segmentId:"x",delta:"answer"},3)); assert.equal(a.runsById.r1.reasoning.x,"think"); assert.equal(a.runsById.r1.answer.x,"answer");});
test("answered terminal requires vouch",()=>{let a=reduceRunEvent(initialRunProjection(),started()); a=reduceRunEvent(a,event({kind:"run_terminal",terminalKind:"answered",finalAnswer:"answer",answerVouched:false,failure:null,terminalAt:""},2)); assert.equal(a.runsById.r1.finalAnswer,null);});
test("failed terminal retains null answer",()=>{let a=reduceRunEvent(initialRunProjection(),started()); a=reduceRunEvent(a,event({kind:"run_terminal",terminalKind:"failed",finalAnswer:null,answerVouched:false,failure:{code:"missing_final_answer",message:"Missing final answer",retryable:true,recoveryAction:"retry_prompt"},terminalAt:""},2)); assert.equal(a.runsById.r1.finalAnswer,null);});
test("late events cannot mutate terminal",()=>{let a=reduceRunEvent(initialRunProjection(),started()); a=reduceRunEvent(a,event({kind:"run_terminal",terminalKind:"cancelled",finalAnswer:null,answerVouched:false,failure:null,terminalAt:""},2)); assert.strictEqual(reduceRunEvent(a,event({kind:"answer_delta",segmentId:"x",delta:"late"},3)),a);});
test("POST_TERMINAL_EVENT_TYPES is the only post-terminal allow list", () => {
  assert.deepEqual([...POST_TERMINAL_EVENT_TYPES], ["child_agent_update", "decision_request", "plan_record"]);
  assert.equal(isPostTerminalEventType("decision_request"), true);
  assert.equal(isPostTerminalEventType("activity_update"), false);
  assert.equal(isPostTerminalEventType("answer_delta"), false);
});
test("Accept-plan settlement after terminal updates the pending decision", () => {
  const pending = {
    requestId: "p1",
    invocationId: "p1",
    kind: "plan" as const,
    status: "pending" as const,
    title: "Review plan",
    detail: "1. Edit a file",
    expiresAt: null,
    policy: { effectiveMode: "review" },
  };
  let a = reduceRunEvent(initialRunProjection(), started());
  a = reduceRunEvent(a, event({ kind: "decision_request", request: pending }, 2));
  a = reduceRunEvent(
    a,
    event(
      {
        kind: "run_terminal",
        terminalKind: "answered",
        finalAnswer: "plan body",
        answerVouched: true,
        failure: null,
        terminalAt: "",
      },
      3,
    ),
  );
  assert.equal(a.runsById.r1.decisions.p1.status, "pending");
  assert.equal(a.runsById.r1.state, "terminal");
  const before = a;
  a = reduceRunEvent(
    a,
    event(
      {
        kind: "decision_request",
        request: { ...pending, status: "accepted" },
      },
      4,
    ),
  );
  assert.notEqual(a, before);
  assert.equal(a.runsById.r1.decisions.p1.status, "accepted");
  assert.equal(a.runsById.r1.state, "terminal");
});
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
test("activity_update preserves vouched kind and rename pair without inventing from tool name", () => {
  let a = reduceRunEvent(initialRunProjection(), started());
  a = reduceRunEvent(
    a,
    event(
      {
        kind: "activity_update",
        activity: {
          activityId: "a-del",
          invocationId: "i-del",
          name: "delete_file",
          lifecycle: "terminal",
          execution: "executed",
          status: "succeeded",
          input: {},
          output: null,
          error: null,
          diff: null,
          path: "gone.txt",
          kind: "delete",
          fromPath: null,
          toPath: null,
          policy: {},
          automaticEligibility: "text_edit",
          autoApplied: true,
          command: null,
          editId: "e-del",
          recovery: { kind: "guarded_revert", available: true, status: "available" },
        },
      },
      2,
    ),
  );
  assert.equal(a.runsById.r1.activities["a-del"].kind, "delete");
  assert.equal(a.runsById.r1.activities["a-del"].path, "gone.txt");
  a = reduceRunEvent(
    a,
    event(
      {
        kind: "activity_update",
        activity: {
          activityId: "a-ren",
          invocationId: "i-ren",
          name: "rename_file",
          lifecycle: "terminal",
          execution: "executed",
          status: "succeeded",
          input: {},
          output: null,
          error: null,
          diff: null,
          path: "to.txt",
          kind: "rename",
          fromPath: "from.txt",
          toPath: "to.txt",
          policy: {},
          automaticEligibility: "text_edit",
          autoApplied: true,
          command: null,
          editId: "e-ren",
          recovery: { kind: "guarded_revert", available: true, status: "available" },
        },
      },
      3,
    ),
  );
  assert.equal(a.runsById.r1.activities["a-ren"].kind, "rename");
  assert.equal(a.runsById.r1.activities["a-ren"].fromPath, "from.txt");
  assert.equal(a.runsById.r1.activities["a-ren"].toPath, "to.txt");
  a = reduceRunEvent(
    a,
    event(
      {
        kind: "activity_update",
        activity: {
          activityId: "a-name-only",
          invocationId: "i-name",
          name: "delete_file",
          lifecycle: "terminal",
          execution: "executed",
          status: "succeeded",
          input: {},
          output: null,
          error: null,
          diff: null,
          path: "maybe.txt",
          policy: {},
          automaticEligibility: "text_edit",
          autoApplied: true,
          command: null,
          editId: "e-name",
          recovery: null,
        },
      },
      4,
    ),
  );
  assert.equal(a.runsById.r1.activities["a-name-only"].kind ?? null, null);
  assert.equal(a.runsById.r1.activities["a-name-only"].fromPath ?? null, null);
  assert.equal(a.runsById.r1.activities["a-name-only"].toPath ?? null, null);
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
test("run_started carries executionPhase; plan_record folds into run projection", () => {
  const s = snap();
  s.executionPhase = "plan";
  let a = reduceRunEvent(initialRunProjection(), started(s));
  assert.equal(a.runsById.r1.executionPhase, "plan");
  assert.equal(a.runsById.r1.plan ?? null, null);
  a = reduceRunEvent(a, event({
    kind: "plan_record",
    plan: {
      runId: "r1",
      sessionId: "s1",
      connectionGeneration: 1,
      status: "ready",
      body: "Update `src/a.ts` and `apps/shell/src/b.tsx`.",
      proposedMembers: [
        { path: "src/a.ts", summary: "Update helper" },
        { path: "apps/shell/src/b.tsx", summary: "Create UI" },
      ],
      policy: { effectiveMode: "review" },
      executionPhase: "plan",
    },
  }, 2));
  assert.equal(a.runsById.r1.plan?.status, "ready");
  assert.equal(a.runsById.r1.plan?.proposedMembers.length, 2);
  assert.equal(a.runsById.r1.plan?.proposedMembers[0]?.path, "src/a.ts");
  a = reduceRunEvent(a, event({
    kind: "decision_request",
    request: {
      requestId: "plan-1",
      invocationId: "inv-plan",
      kind: "plan",
      status: "pending",
      title: "Review plan",
      detail: "",
      expiresAt: null,
      policy: { effectiveMode: "review" },
    },
  }, 3));
  assert.equal(a.runsById.r1.decisions["plan-1"]?.kind, "plan");
  assert.equal(a.runsById.r1.decisions["plan-1"]?.status, "pending");
  assert.equal(a.runsById.r1.decisions["plan-1"]?.expiresAt, null);
});

test("later decision_request keeps original title/detail when settle/cancel blanks them", () => {
  let a = reduceRunEvent(initialRunProjection(), started());
  a = reduceRunEvent(a, event({
    kind: "decision_request",
    request: {
      requestId: "all-permission",
      invocationId: "all-permission",
      kind: "permission",
      status: "pending",
      title: "Run shell",
      detail: "Allow the inspected command?",
      expiresAt: null,
      policy: {},
    },
  }, 2));
  a = reduceRunEvent(a, event({
    kind: "decision_request",
    request: {
      requestId: "all-permission",
      invocationId: "all-permission",
      kind: "permission",
      status: "cancelled",
      title: "Permission",
      detail: "",
      expiresAt: null,
      policy: {},
    },
  }, 3));
  const decision = a.runsById.r1.decisions["all-permission"];
  assert.equal(decision?.status, "cancelled");
  assert.equal(decision?.title, "Run shell");
  assert.equal(decision?.detail, "Allow the inspected command?");
});

test("missing executionPhase on old journals is not plan", () => {
  let a = reduceRunEvent(initialRunProjection(), started());
  assert.equal(a.runsById.r1.executionPhase, undefined);
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

test("project_instructions included folds onto run projection", () => {
  let a = reduceRunEvent(initialRunProjection(), started());
  a = reduceRunEvent(
    a,
    event(
      {
        kind: "project_instructions",
        projectInstructions: {
          runId: "r1",
          sessionId: "s1",
          connectionGeneration: 1,
          inclusion: "included",
          path: "AGENTS.md",
        },
      },
      2,
    ),
  );
  assert.equal(a.runsById.r1.projectInstructions?.inclusion, "included");
  assert.equal(a.runsById.r1.projectInstructions?.path, "AGENTS.md");
});

test("project_instructions failed is kept — not collapsed to not_included", () => {
  let a = reduceRunEvent(initialRunProjection(), started());
  a = reduceRunEvent(
    a,
    event(
      {
        kind: "project_instructions",
        projectInstructions: {
          runId: "r1",
          sessionId: "s1",
          connectionGeneration: 1,
          inclusion: "failed",
          path: "AGENTS.md",
        },
      },
      2,
    ),
  );
  assert.equal(a.runsById.r1.projectInstructions?.inclusion, "failed");
  assert.notEqual(a.runsById.r1.projectInstructions?.inclusion, "not_included");
});

test("type/kind mismatch ignored", () => {
  let a = reduceRunEvent(initialRunProjection(), started());
  const mismatched = event(
    {
      kind: "project_instructions",
      projectInstructions: {
        runId: "r1",
        sessionId: "s1",
        connectionGeneration: 1,
        inclusion: "included",
        path: "AGENTS.md",
      },
    },
    2,
  );
  mismatched.type = "run_state";
  const next = reduceRunEvent(a, mismatched);
  assert.strictEqual(next, a);
  assert.equal(next.runsById.r1.projectInstructions ?? null, null);
});

test("chat_pack included folds onto run projection", () => {
  let a = reduceRunEvent(initialRunProjection(), started());
  a = reduceRunEvent(
    a,
    event(
      {
        kind: "chat_pack",
        chatPack: {
          runId: "r1",
          sessionId: "s1",
          conversationId: "home-a",
          connectionGeneration: 1,
          inclusion: "included",
          fault: null,
          files: [{ path: "a.md" }],
          noteIncluded: true,
        },
      },
      2,
    ),
  );
  assert.equal(a.runsById.r1.chatPack?.inclusion, "included");
  assert.equal(a.runsById.r1.chatPack?.noteIncluded, true);
});

test("chat_pack materialization_fault and confirm_failed are kept — not collapsed to not_included", () => {
  let a = reduceRunEvent(initialRunProjection(), started());
  a = reduceRunEvent(
    a,
    event(
      {
        kind: "chat_pack",
        chatPack: {
          runId: "r1",
          sessionId: "s1",
          conversationId: "home-a",
          connectionGeneration: 1,
          inclusion: "materialization_fault",
          fault: "path",
          files: [{ path: "stale.md" }],
          noteIncluded: false,
        },
      },
      2,
    ),
  );
  assert.equal(a.runsById.r1.chatPack?.inclusion, "materialization_fault");
  assert.equal(a.runsById.r1.chatPack?.fault, "path");
  assert.notEqual(a.runsById.r1.chatPack?.inclusion, "not_included");
  a = reduceRunEvent(
    a,
    event(
      {
        kind: "chat_pack",
        chatPack: {
          runId: "r1",
          sessionId: "s1",
          conversationId: "home-a",
          connectionGeneration: 1,
          inclusion: "confirm_failed",
          fault: null,
          files: [],
          noteIncluded: false,
        },
      },
      3,
    ),
  );
  assert.equal(a.runsById.r1.chatPack?.inclusion, "confirm_failed");
});

test("chat_pack type/kind mismatch ignored", () => {
  let a = reduceRunEvent(initialRunProjection(), started());
  const mismatched = event(
    {
      kind: "chat_pack",
      chatPack: {
        runId: "r1",
        sessionId: "s1",
        conversationId: "home-a",
        connectionGeneration: 1,
        inclusion: "included",
        fault: null,
        files: [],
        noteIncluded: false,
      },
    },
    2,
  );
  mismatched.type = "run_state";
  const next = reduceRunEvent(a, mismatched);
  assert.strictEqual(next, a);
  assert.equal(next.runsById.r1.chatPack ?? null, null);
});

test("last chat_pack event wins; persist/restore keeps materialization_fault", () => {
  let a = reduceRunEvent(initialRunProjection(), started());
  a = reduceRunEvent(
    a,
    event(
      {
        kind: "chat_pack",
        chatPack: {
          runId: "r1",
          sessionId: "s1",
          conversationId: "home-a",
          connectionGeneration: 1,
          inclusion: "included",
          fault: null,
          files: [{ path: "a.md" }],
          noteIncluded: true,
        },
      },
      2,
    ),
  );
  a = reduceRunEvent(
    a,
    event(
      {
        kind: "chat_pack",
        chatPack: {
          runId: "r1",
          sessionId: "s1",
          conversationId: "home-a",
          connectionGeneration: 1,
          inclusion: "materialization_fault",
          fault: "over_cap",
          files: [],
          noteIncluded: false,
        },
      },
      3,
    ),
  );
  assert.equal(a.runsById.r1.chatPack?.inclusion, "materialization_fault");
  const restored = restoreRunProjection(persistableRunProjection(a));
  assert.equal(restored.runsById.r1.chatPack?.inclusion, "materialization_fault");
  assert.equal(restored.runsById.r1.chatPack?.fault, "over_cap");
  assert.notEqual(restored.runsById.r1.chatPack?.inclusion, "not_included");
});

test("last project_instructions event wins; persist/restore keeps failed", () => {
  let a = reduceRunEvent(initialRunProjection(), started());
  a = reduceRunEvent(
    a,
    event(
      {
        kind: "project_instructions",
        projectInstructions: {
          runId: "r1",
          sessionId: "s1",
          connectionGeneration: 1,
          inclusion: "included",
          path: "AGENTS.md",
        },
      },
      2,
    ),
  );
  a = reduceRunEvent(
    a,
    event(
      {
        kind: "project_instructions",
        projectInstructions: {
          runId: "r1",
          sessionId: "s1",
          connectionGeneration: 1,
          inclusion: "failed",
          path: "AGENTS.md",
        },
      },
      3,
    ),
  );
  assert.equal(a.runsById.r1.projectInstructions?.inclusion, "failed");
  const restored = restoreRunProjection(persistableRunProjection(a));
  assert.equal(restored.runsById.r1.projectInstructions?.inclusion, "failed");
  assert.notEqual(restored.runsById.r1.projectInstructions?.inclusion, "not_included");
});

test("message_delta is a coalesced live kind and stays distinct from reasoning and answer", () => {
  assert.equal(isRunStreamDelta("message_delta"), true);
  let a = reduceRunEvent(initialRunProjection(), started());
  a = reduceRunEvent(a, event({ kind: "reasoning_delta", segmentId: "r", delta: "think" }, 2));
  a = reduceRunEvent(a, event({ kind: "message_delta", segmentId: "m", delta: "mid" }, 3));
  a = reduceRunEvent(a, event({
    kind: "run_terminal", terminalKind: "answered", finalAnswer: "mid",
    answerVouched: true, failure: null, terminalAt: "",
  }, 4));
  assert.equal(a.runsById.r1.reasoning.r, "think");
  assert.equal(a.runsById.r1.message.m, "mid");
  assert.equal(a.runsById.r1.finalAnswer, "mid");
  // mid-turn store still present after voucher (not rewritten / not cleared)
  assert.equal(a.runsById.r1.message.m, "mid");
  // answer_delta store unused by this path
  assert.deepEqual(a.runsById.r1.answer, {});
});

test("type/kind mismatch message envelope is ignored by reducer", () => {
  let a = reduceRunEvent(initialRunProjection(), started());
  const bad = event({ kind: "message_delta", segmentId: "m", delta: "x" }, 2);
  (bad as { type: string }).type = "answer_delta";
  a = reduceRunEvent(a, bad);
  assert.equal(a.runsById.r1.message?.m, undefined);
});

test("reducer does not copy message_delta into finalAnswer", () => {
  let a = reduceRunEvent(initialRunProjection(), started());
  a = reduceRunEvent(a, event({ kind: "message_delta", segmentId: "m", delta: "usable mid-turn" }, 2));
  assert.equal(a.runsById.r1.finalAnswer, null);
  assert.equal(a.runsById.r1.answerVouched, false);
  assert.equal(a.runsById.r1.message.m, "usable mid-turn");
});

test("child_agent_update merges by childId; firstEventSeq preserved; status advances", () => {
  let a = reduceRunEvent(initialRunProjection(), started());
  a = reduceRunEvent(a, event({
    kind: "child_agent_update",
    childId: "c1",
    identityLabel: "Researcher",
    status: "running",
  }, 2));
  a = reduceRunEvent(a, event({
    kind: "child_agent_update",
    childId: "c1",
    identityLabel: "Researcher",
    status: "done",
  }, 3));
  const member = a.runsById.r1.childAgents?.c1;
  assert.equal(member?.childId, "c1");
  assert.equal(member?.identityLabel, "Researcher");
  assert.equal(member?.status, "done");
  assert.equal(member?.firstEventSeq, 2);
  assert.equal(Object.keys(a.runsById.r1.childAgents ?? {}).length, 1);
});

test("child_agent_update first-frame done or failed is not overwritten to running", () => {
  let a = reduceRunEvent(initialRunProjection(), started());
  a = reduceRunEvent(a, event({
    kind: "child_agent_update",
    childId: "c2",
    identityLabel: "Fast",
    status: "done",
  }, 2));
  assert.equal(a.runsById.r1.childAgents?.c2?.status, "done");
  a = reduceRunEvent(a, event({
    kind: "child_agent_update",
    childId: "c3",
    identityLabel: "Boom",
    status: "failed",
  }, 3));
  assert.equal(a.runsById.r1.childAgents?.c3?.status, "failed");
});

test("post-terminal child_agent_update done applies after run_terminal", () => {
  let a = reduceRunEvent(initialRunProjection(), started());
  a = reduceRunEvent(a, event({
    kind: "child_agent_update",
    childId: "c1",
    identityLabel: "Researcher",
    status: "running",
  }, 2));
  a = reduceRunEvent(a, event({
    kind: "run_terminal",
    terminalKind: "cancelled",
    finalAnswer: null,
    answerVouched: false,
    failure: null,
    terminalAt: "",
  }, 3));
  a = reduceRunEvent(a, event({
    kind: "child_agent_update",
    childId: "c1",
    identityLabel: "Researcher",
    status: "done",
  }, 4));
  assert.equal(a.runsById.r1.state, "terminal");
  assert.equal(a.runsById.r1.childAgents?.c1?.status, "done");
  assert.equal(a.runsById.r1.childAgents?.c1?.firstEventSeq, 2);
});

test("post-terminal answer_delta and activity_update are still dropped", () => {
  let a = reduceRunEvent(initialRunProjection(), started());
  a = reduceRunEvent(a, event({
    kind: "run_terminal",
    terminalKind: "cancelled",
    finalAnswer: null,
    answerVouched: false,
    failure: null,
    terminalAt: "",
  }, 2));
  assert.strictEqual(reduceRunEvent(a, event({ kind: "answer_delta", segmentId: "x", delta: "late" }, 3)), a);
  assert.strictEqual(reduceRunEvent(a, event({
    kind: "activity_update",
    activity: {
      activityId: "a1", invocationId: "i1", name: "read_file", lifecycle: "pending",
      execution: null, status: "running", input: {}, output: null, error: null, diff: null,
      path: null, policy: {}, automaticEligibility: "read", autoApplied: false,
      command: null, editId: null, recovery: null,
    },
  }, 4)), a);
});

test("foreign generation child_agent_update is dropped", () => {
  const a = reduceRunEvent(initialRunProjection(), started());
  const e = event({
    kind: "child_agent_update",
    childId: "c1",
    identityLabel: "Researcher",
    status: "running",
  }, 2);
  e.connectionGeneration = 2;
  assert.strictEqual(reduceRunEvent(a, e), a);
  assert.equal(a.runsById.r1.childAgents?.c1, undefined);
});

test("activity_update does not mint childAgents entries", () => {
  let a = reduceRunEvent(initialRunProjection(), started());
  a = reduceRunEvent(a, event({
    kind: "activity_update",
    activity: {
      activityId: "a1", invocationId: "i1", name: "read_file", lifecycle: "pending",
      execution: null, status: "running", input: {}, output: null, error: null, diff: null,
      path: "notes.md", policy: {}, automaticEligibility: "read", autoApplied: false,
      command: null, editId: null, recovery: null, summary: "Read notes.md", title: "Reading notes.md",
    },
  }, 2));
  assert.equal(Object.keys(a.runsById.r1.childAgents ?? {}).length, 0);
  assert.equal(a.runsById.r1.activities.a1.name, "read_file");
});

test("incomplete child_agent_update is withheld", () => {
  let a = reduceRunEvent(initialRunProjection(), started());
  a = reduceRunEvent(a, event({
    kind: "child_agent_update",
    childId: "",
    identityLabel: "Ghost",
    status: "running",
  }, 2));
  a = reduceRunEvent(a, event({
    kind: "child_agent_update",
    childId: "c1",
    identityLabel: "",
    status: "running",
  }, 3));
  a = reduceRunEvent(a, event({
    kind: "child_agent_update",
    childId: "c1",
    identityLabel: "X",
    status: "pending" as "running",
  }, 4));
  assert.equal(Object.keys(a.runsById.r1.childAgents ?? {}).length, 0);
});

test("childAgents persist and restore", () => {
  let a = reduceRunEvent(initialRunProjection(), started());
  a = reduceRunEvent(a, event({
    kind: "child_agent_update",
    childId: "c1",
    identityLabel: "Researcher",
    status: "failed",
  }, 2));
  const restored = restoreRunProjection(persistableRunProjection(a));
  assert.equal(restored.runsById.r1.childAgents?.c1?.status, "failed");
  assert.equal(restored.runsById.r1.childAgents?.c1?.identityLabel, "Researcher");
  assert.equal(restored.runsById.r1.childAgents?.c1?.firstEventSeq, 2);
});

test("activity_update stores present summary and title without inventing them", () => {
  let a = reduceRunEvent(initialRunProjection(), started());
  a = reduceRunEvent(a, event({
    kind: "activity_update",
    activity: {
      activityId: "a1", invocationId: "i1", name: "read_file", lifecycle: "pending",
      execution: null, status: "running", input: {}, output: null, error: null, diff: null,
      path: "notes.md", policy: {}, automaticEligibility: "read", autoApplied: false,
      command: null, editId: null, recovery: null, summary: "Read notes.md", title: "Reading notes.md",
    },
  }, 2));
  assert.equal(a.runsById.r1.activities.a1.summary, "Read notes.md");
  assert.equal(a.runsById.r1.activities.a1.title, "Reading notes.md");
  a = reduceRunEvent(a, event({
    kind: "activity_update",
    activity: {
      activityId: "a2", invocationId: "i2", name: "read_file", lifecycle: "pending",
      execution: null, status: "running", input: {}, output: null, error: null, diff: null,
      path: null, policy: {}, automaticEligibility: "read", autoApplied: false,
      command: null, editId: null, recovery: null,
    },
  }, 3));
  assert.equal(a.runsById.r1.activities.a2.summary, null);
  assert.equal(a.runsById.r1.activities.a2.title, null);
});

test("activity_update retains acpToolKind fetch, url, snapshotJournaled without minting a Browser roster", () => {
  let a = reduceRunEvent(initialRunProjection(), started());
  a = reduceRunEvent(a, event({
    kind: "activity_update",
    activity: {
      activityId: "f1", invocationId: "f1", name: "web_fetch", lifecycle: "pending",
      execution: null, status: "running", input: {}, output: null, error: null, diff: null,
      path: null, policy: {}, automaticEligibility: "read", autoApplied: false,
      command: null, editId: null, recovery: null, title: "Docs",
      acpToolKind: "fetch", url: "https://docs.x.ai", snapshotJournaled: true,
    },
  }, 2));
  const act = a.runsById.r1.activities.f1;
  assert.equal(act.acpToolKind, "fetch");
  assert.equal(act.url, "https://docs.x.ai");
  assert.equal(act.snapshotJournaled, true);
  assert.equal(act.title, "Docs");
  assert.equal(Object.keys(a.runsById.r1.activities).length, 1);
  assert.equal((a.runsById.r1 as { browserWork?: unknown }).browserWork, undefined);
  assert.equal((a.runsById.r1 as { browserMembers?: unknown }).browserMembers, undefined);
});

test("activity_update without fetch class does not invent url or snapshot; no Browser roster", () => {
  let a = reduceRunEvent(initialRunProjection(), started());
  a = reduceRunEvent(a, event({
    kind: "activity_update",
    activity: {
      activityId: "a1", invocationId: "i1", name: "read_file", lifecycle: "pending",
      execution: null, status: "running", input: {}, output: null, error: null, diff: null,
      path: "notes.md", policy: {}, automaticEligibility: "read", autoApplied: false,
      command: null, editId: null, recovery: null, summary: "Read notes.md", title: "Reading notes.md",
    },
  }, 2));
  const act = a.runsById.r1.activities.a1;
  assert.equal(act.acpToolKind, null);
  assert.equal(act.url, null);
  assert.equal(act.snapshotJournaled, false);
  assert.equal(act.name, "read_file");
  assert.equal((a.runsById.r1 as { browserWork?: unknown }).browserWork, undefined);
  assert.equal((a.runsById.r1 as { browserMembers?: unknown }).browserMembers, undefined);
});

test("activity_update merge keeps a single activity identity (not a second tool row)", () => {
  let a = reduceRunEvent(initialRunProjection(), started());
  a = reduceRunEvent(a, event({
    kind: "activity_update",
    activity: {
      activityId: "f1", invocationId: "f1", name: "web_fetch", lifecycle: "pending",
      execution: null, status: "running", input: {}, output: null, error: null, diff: null,
      path: null, policy: {}, automaticEligibility: "read", autoApplied: false,
      command: null, editId: null, recovery: null, title: "Docs",
      acpToolKind: "fetch", url: "https://docs.x.ai", snapshotJournaled: false,
    },
  }, 2));
  a = reduceRunEvent(a, event({
    kind: "activity_update",
    activity: {
      activityId: "f1", invocationId: "f1", name: "web_fetch", lifecycle: "terminal",
      execution: "executed", status: "succeeded", input: {}, output: "ok", error: null, diff: null,
      path: null, policy: {}, automaticEligibility: "read", autoApplied: false,
      command: null, editId: null, recovery: null, title: "Docs",
      acpToolKind: "fetch", url: "https://docs.x.ai", snapshotJournaled: true,
    },
  }, 3));
  assert.equal(Object.keys(a.runsById.r1.activities).length, 1);
  assert.equal(a.runsById.r1.activities.f1.status, "succeeded");
  assert.equal(a.runsById.r1.activities.f1.acpToolKind, "fetch");
  assert.equal(a.runsById.r1.activities.f1.snapshotJournaled, true);
});

test("fetch-class activity fields persist and restore", () => {
  let a = reduceRunEvent(initialRunProjection(), started());
  a = reduceRunEvent(a, event({
    kind: "activity_update",
    activity: {
      activityId: "f1", invocationId: "f1", name: "web_fetch", lifecycle: "terminal",
      execution: "executed", status: "succeeded", input: {}, output: null, error: null, diff: null,
      path: null, policy: {}, automaticEligibility: "read", autoApplied: false,
      command: null, editId: null, recovery: null, title: "Docs",
      acpToolKind: "fetch", url: "https://docs.x.ai", snapshotJournaled: true,
    },
  }, 2));
  const restored = restoreRunProjection(persistableRunProjection(a));
  assert.equal(restored.runsById.r1.activities.f1.acpToolKind, "fetch");
  assert.equal(restored.runsById.r1.activities.f1.url, "https://docs.x.ai");
  assert.equal(restored.runsById.r1.activities.f1.snapshotJournaled, true);
  assert.equal((restored.runsById.r1 as { browserMembers?: unknown }).browserMembers, undefined);
});

