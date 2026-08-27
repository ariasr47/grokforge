import { randomUUID } from "node:crypto";
import type { RunJournal } from "./run-journal.js";
import type { ActivityRecord, CodeRunAgentProvenance, ExecutionPhase, RunSnapshot, RunEventEnvelope, TerminalKind, FailureView, PolicySnapshot, ModelSnapshot, SkillHandoffProvenance } from "./run-types.js";

const LEGAL:Record<RunSnapshot["state"],Set<RunSnapshot["state"]>>={admitted:new Set(["running","cancelling","terminal"]),running:new Set(["waiting_for_decision","recovering","cancelling","terminal"]),waiting_for_decision:new Set(["running","cancelling","terminal"]),recovering:new Set(["running","cancelling","terminal"]),cancelling:new Set(["terminal"]),terminal:new Set()};
export class RunCoordinator {
  private active = new Map<string,RunSnapshot>();
  private owners = new Map<string,string>();
  private answers = new Map<string,string>();
  /** Admission critical section per client session. This spans the owner check,
   * durable journal admission, and owner publication so concurrent sends cannot
   * both observe a free session. Different sessions retain independent progress. */
  private admissionLocks = new Map<string, Promise<void>>();
  /** Per-run terminal CAS lock. The lock covers the state check, durable
   * terminal append/meta update, and owner release as one critical section. */
  private runMutationLocks = new Map<string, Promise<void>>();
  constructor(private readonly journal:RunJournal, private readonly publish:(e:RunEventEnvelope)=>void=()=>{}){}
  private async withAdmissionLock<T>(sessionId:string, fn:()=>Promise<T>):Promise<T>{
    const prior=this.admissionLocks.get(sessionId) ?? Promise.resolve();
    let release!:()=>void;
    const current=new Promise<void>(resolve=>{release=resolve;});
    this.admissionLocks.set(sessionId,current);
    await prior;
    try{return await fn();}
    finally{release();if(this.admissionLocks.get(sessionId)===current)this.admissionLocks.delete(sessionId);}
  }
  private async withRunMutationLock<T>(runId:string, fn:()=>Promise<T>):Promise<T>{
    const prior=this.runMutationLocks.get(runId) ?? Promise.resolve();
    let release!:()=>void;
    const current=new Promise<void>(resolve=>{release=resolve;});
    this.runMutationLocks.set(runId,current);
    await prior;
    try{return await fn();}
    finally{release();if(this.runMutationLocks.get(runId)===current)this.runMutationLocks.delete(runId);}
  }
  async hydrate(ownedSessionId?:string):Promise<void>{for(const run of await this.journal.listSnapshots()){if(ownedSessionId&&run.sessionId!==ownedSessionId)continue;if(run.codeAgentProvenance===undefined)run.codeAgentProvenance=null;if(run.skillHandoffProvenance===undefined)run.skillHandoffProvenance=null;if(run.executionPhase!=="plan")run.executionPhase="execute";const events=await this.journal.replay(run.sessionId,run.runId,0);let answer="", terminal:any=null;for(const e of events){if(e.sessionId!==run.sessionId||e.runId!==run.runId||e.connectionGeneration!==run.connectionGeneration)throw Object.assign(new Error("journal_unavailable"),{code:"journal_unavailable"});if(e.type!==e.payload.kind&&!(e.type==="run_terminal"&&e.payload.kind==="run_terminal"))throw Object.assign(new Error("journal_unavailable"),{code:"journal_unavailable"});if(e.payload.kind==="answer_delta"||e.payload.kind==="message_delta")answer+=e.payload.delta;if(e.payload.kind==="run_state")run.state=e.payload.state;if(e.payload.kind==="run_terminal"){run.state="terminal";run.terminalKind=e.payload.terminalKind;run.finalAnswer=e.payload.finalAnswer;run.answerVouched=e.payload.answerVouched;run.failure=e.payload.failure;terminal=e.payload;}}run.lastEventSeq=events.at(-1)?.eventSeq??0;if(terminal)continue;this.active.set(run.runId,run);this.owners.set(run.sessionId,run.runId);this.answers.set(run.runId,answer);if(run.executionPhase==="plan"){await this.appendOwnedEvent(run.runId,{kind:"plan_record",plan:{runId:run.runId,sessionId:run.sessionId,connectionGeneration:run.connectionGeneration,status:"failed",body:answer||null,proposedMembers:[],policy:run.policy,executionPhase:"plan"}},"plan_record").catch(()=>undefined);}await this.finalize(run.runId,"failed",null,{code:"interrupted",message:"The host restarted before this run reached a terminal state.",retryable:true,recoveryAction:"retry_prompt"});}}
  async admit(input:{sessionId:string;prompt:string;connectionGeneration:number;policy:PolicySnapshot;model:ModelSnapshot;executionPhase?:ExecutionPhase;dispatch?: (run:RunSnapshot)=>Promise<void>}):Promise<RunSnapshot>{
    const run=await this.withAdmissionLock(input.sessionId,async()=>{
      if(this.owners.has(input.sessionId))throw Object.assign(new Error("run active"),{code:"run_active"});
      const now=new Date().toISOString();
      const next:RunSnapshot={sessionId:input.sessionId,runId:randomUUID(),connectionGeneration:input.connectionGeneration,state:"admitted",acceptedPrompt:input.prompt,admittedAt:now,updatedAt:now,lastEventSeq:0,policy:input.policy,model:input.model,terminalKind:null,finalAnswer:null,answerVouched:false,failure:null,executionPhase:input.executionPhase??"execute",codeAgentProvenance:null,skillHandoffProvenance:null};
      await this.journal.admit(next); this.active.set(next.runId,next); this.owners.set(next.sessionId,next.runId); this.answers.set(next.runId,"");
      await this.appendOwnedEvent(next.runId,{kind:"run_started",run:next},"run_started");
      return next;
    });
    try { if(input.dispatch) await input.dispatch(run); }
    catch (error) { await this.finalize(run.runId,"failed",null,{code:"provider_unavailable",message:"Execution could not be started.",retryable:true,recoveryAction:"retry_prompt"}); throw error; }
    return run;
  }
  get(runId:string){return this.active.get(runId)}
  async stampCodeAgentProvenance(runId:string, provenance:CodeRunAgentProvenance):Promise<void>{
    return this.withRunMutationLock(runId, async () => {
      const run = this.active.get(runId);
      if (!run || run.state === "terminal") return;
      run.codeAgentProvenance = provenance;
      run.updatedAt = new Date().toISOString();
      await this.journal.update(run);
    });
  }
  async stampSkillHandoffProvenance(runId:string, provenance:SkillHandoffProvenance):Promise<void>{
    return this.withRunMutationLock(runId, async () => {
      const run = this.active.get(runId);
      if (!run || run.state === "terminal") return;
      run.skillHandoffProvenance = provenance;
      run.updatedAt = new Date().toISOString();
      await this.journal.update(run);
    });
  }
  getAccumulatedAnswer(runId:string){return this.answers.get(runId)||""}
  async listSnapshots(){return this.journal.listSnapshots()}
  async appendOwnedEvent(runId:string,payload:RunEventEnvelope["payload"],type:RunEventEnvelope["type"],connectionGeneration?:number):Promise<RunEventEnvelope>{
    return this.withRunMutationLock(runId,async()=>{
      const run=this.active.get(runId); if(!run||run.state==="terminal")throw new Error("run not active");
      if(connectionGeneration!==undefined&&connectionGeneration!==run.connectionGeneration)throw Object.assign(new Error("stale generation"),{code:"stale_generation"});
      const nextState=payload.kind==="run_state"?payload.state:run.state; if(nextState!==run.state&&!LEGAL[run.state].has(nextState))throw new Error("illegal transition");
      if(payload.kind==="answer_delta"||payload.kind==="message_delta") this.answers.set(runId,(this.answers.get(runId)||"")+payload.delta);
      run.state=nextState; run.updatedAt=new Date().toISOString(); const event=await this.journal.append({schemaVersion:1,type,sessionId:run.sessionId,runId,connectionGeneration:run.connectionGeneration,payload}); run.lastEventSeq=event.eventSeq; await this.journal.update(run); this.publish(event); return event;
    });
  }
  async finalize(runId:string,terminalKind:TerminalKind,finalAnswer:string|null=null,failure:FailureView=null):Promise<{won:boolean;run?:RunSnapshot}>{
    return this.withRunMutationLock(runId,async()=>{
      const current=this.active.get(runId);if(!current)return {won:false};if(current.state==="terminal")return {won:false,run:current};if(!LEGAL[current.state].has("terminal"))return {won:false,run:current};
      const accumulated=this.answers.get(runId)||"";const candidate=(finalAnswer??accumulated).trim();
      if(terminalKind==="answered"&&!candidate&&current.executionPhase!=="plan"){terminalKind="failed";failure={code:"missing_final_answer",message:"No final answer was produced.",retryable:true,recoveryAction:"retry_prompt"};}
      const terminalRun:RunSnapshot={...current,state:"terminal",terminalKind,finalAnswer:terminalKind==="answered"?candidate:null,answerVouched:terminalKind==="answered",failure:terminalKind==="failed"?failure:null,updatedAt:new Date().toISOString()};
      const event=await this.journal.appendTerminal({schemaVersion:1,type:"run_terminal",sessionId:terminalRun.sessionId,runId,connectionGeneration:terminalRun.connectionGeneration,payload:{kind:"run_terminal",terminalKind,finalAnswer:terminalRun.finalAnswer,answerVouched:terminalRun.answerVouched,failure:terminalRun.failure,terminalAt:terminalRun.updatedAt}});
      if(!event){
        const durable=await this.journal.replay(current.sessionId,runId,0);
        const terminal=durable.find(e=>e.type==="run_terminal");
        if(terminal){const p=terminal.payload as any;const reconciled={...current,state:"terminal" as const,terminalKind:p.terminalKind,finalAnswer:p.finalAnswer,answerVouched:p.answerVouched,failure:p.failure,lastEventSeq:terminal.eventSeq,updatedAt:p.terminalAt};this.active.set(runId,reconciled);this.owners.delete(reconciled.sessionId);this.answers.delete(runId);return {won:false,run:reconciled};}
        return {won:false,run:this.active.get(runId)};
      }
      terminalRun.lastEventSeq=event.eventSeq;await this.journal.update(terminalRun);
      // Admission opens only after terminal durability, and the terminal is
      // published only after admission is open. The UI can therefore submit a
      // follow-up immediately on run_terminal without racing a stale owner.
      this.active.set(runId,terminalRun);this.owners.delete(terminalRun.sessionId);this.answers.delete(runId);this.publish(event);
      return {won:true,run:terminalRun};
    });
  }
  async cancel(runId:string){const run=this.active.get(runId);if(!run)return; if(run.state!=="terminal"){await this.appendOwnedEvent(runId,{kind:"run_state",state:"cancelling",liveness:null},"run_state");}return run}
  async replay(sessionId:string,runId:string,after=0){let run=this.active.get(runId);if(!run){try{run=await this.journal.snapshot(sessionId,runId);}catch{run=undefined;}}if(!run||run.sessionId!==sessionId)throw Object.assign(new Error("run not found"),{code:"run_not_found"});const allEvents=await this.journal.replay(sessionId,runId,0);const events=allEvents.filter(e=>e.eventSeq>after);const terminal=allEvents.find(e=>e.type==="run_terminal");if(terminal){const p=terminal.payload as any;const last=allEvents.at(-1);run={...run,state:"terminal",terminalKind:p.terminalKind,finalAnswer:p.finalAnswer,answerVouched:p.answerVouched,failure:p.failure,lastEventSeq:last?.eventSeq??terminal.eventSeq,updatedAt:p.terminalAt};this.active.set(runId,run);this.owners.delete(sessionId);this.answers.delete(runId);}return {run,events}}
  async appendSettlementActivity(runId:string,activity:ActivityRecord):Promise<RunEventEnvelope>{
    return this.withRunMutationLock(runId,async()=>{
      let run=this.active.get(runId);
      if(!run){
        const owned=[...this.active.values()].find(item=>item.runId===runId);
        run=owned;
      }
      if(!run){
        for(const snapshot of await this.journal.listSnapshots()){
          if(snapshot.runId===runId){run=snapshot;break;}
        }
      }
      if(!run) throw Object.assign(new Error("run not found"),{code:"run_not_found"});
      const event=await this.journal.appendAfterTerminal({schemaVersion:1,type:"activity_update",sessionId:run.sessionId,runId,connectionGeneration:run.connectionGeneration,payload:{kind:"activity_update",activity}});
      run={...run,lastEventSeq:event.eventSeq,updatedAt:event.occurredAt};
      this.active.set(runId,run);
      await this.journal.update(run);
      this.publish(event);
      return event;
    });
  }
  async appendAfterTerminalEvent(runId:string,payload:Extract<RunEventEnvelope["payload"],{kind:"plan_record"}|{kind:"decision_request"}|{kind:"child_agent_update"}>,type:Extract<RunEventEnvelope["type"],"plan_record"|"decision_request"|"child_agent_update">):Promise<RunEventEnvelope>{
    return this.withRunMutationLock(runId,async()=>{
      let run=this.active.get(runId);
      if(!run){
        for(const snapshot of await this.journal.listSnapshots()){
          if(snapshot.runId===runId){run=snapshot;break;}
        }
      }
      if(!run) throw Object.assign(new Error("run not found"),{code:"run_not_found"});
      const event=await this.journal.appendAfterTerminal({schemaVersion:1,type,sessionId:run.sessionId,runId,connectionGeneration:run.connectionGeneration,payload});
      run={...run,lastEventSeq:event.eventSeq,updatedAt:event.occurredAt};
      this.active.set(runId,run);
      await this.journal.update(run);
      this.publish(event);
      return event;
    });
  }
}
