import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { RunCoordinator } from "./run-coordinator.js";
import { RunJournal } from "./run-journal.js";
import { startHost } from "./test-support/host-process.js";

const policy = { workspace: process.cwd(), storedMode: null, effectiveMode: "review" as const, source: "default" as const, revision: "r1", fallbackReason: null, snapshottedAt: new Date().toISOString() };
const model = { requestedModel: "grok-4.6", appliedModel: "grok-4.6", selectionProvenance: "inherited" as const };
async function freePort() { const server=net.createServer(); await new Promise<void>((resolve,reject)=>server.listen(0,"127.0.0.1",resolve).on("error",reject)); const port=(server.address() as net.AddressInfo).port; await new Promise<void>(resolve=>server.close(()=>resolve())); return port; }
const here=path.dirname(fileURLToPath(import.meta.url));

/** Real xAI-compatible HTTP/SSE fixture. It intentionally stalls turn two so the
 * production Grok ACP child must hit its idle abort/recovery path. */
async function startProviderFixture() {
  const requests: any[] = [];
  const server = http.createServer(async (req, res) => {
    if (req.url !== "/v1/chat/completions" || req.method !== "POST") { res.writeHead(404); res.end(); return; }
    let body = ""; for await (const chunk of req) body += String(chunk);
    const parsed = JSON.parse(body); requests.push(parsed);
    const turn = requests.length;
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    const frame = (delta: any, finish_reason?: string) => `data: ${JSON.stringify({ choices: [{ delta, ...(finish_reason ? { finish_reason } : {}) }] })}\n\n`;
    if (turn === 1) {
      res.write(frame({ tool_calls: [{ index: 0, id: "fixture-read-1", type: "function", function: { name: "read_file", arguments: '{"path":"fixture.txt"}' } }] }, "tool_calls"));
      res.write("data: [DONE]\n\n"); res.end(); return;
    }
    if (turn === 2) { res.write(frame({ content: "partial " })); return; }
    res.write(frame({ content: "partial recovered answer" }, "stop")); res.write("data: [DONE]\n\n"); res.end();
  });
  await new Promise<void>((resolve, reject) => server.listen(0, "127.0.0.1", () => resolve()).on("error", reject));
  const port = (server.address() as net.AddressInfo).port;
  return { base: `http://127.0.0.1:${port}/v1`, requests, close: () => new Promise<void>(resolve => server.close(() => resolve())) };
}

test("run lifecycle owns answer deltas, exactly one terminal, and replay survives a fresh coordinator", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rar-run-"));
  const journal = new RunJournal(root); const events: any[] = [];
  const c = new RunCoordinator(journal, e => events.push(e));
  const run = await c.admit({ sessionId: "client-session-a", prompt: "hello", connectionGeneration: 2, policy, model });
  await c.appendOwnedEvent(run.runId, { kind: "answer_delta", segmentId: "a", delta: "answer" }, "answer_delta", 2);
  await assert.rejects(() => c.appendOwnedEvent(run.runId, { kind: "answer_delta", segmentId: "a", delta: "stale" }, "answer_delta", 1), /stale generation/);
  const first = await c.finalize(run.runId, "answered");
  const second = await c.finalize(run.runId, "answered", "late");
  assert.equal(first.won, true); assert.equal(second.won, false); assert.equal(first.run?.finalAnswer, "answer");
  assert.equal(events.filter(e => e.type === "run_terminal").length, 1);
  const replay = await new RunCoordinator(new RunJournal(root)).replay("client-session-a", run.runId, 0);
  assert.equal(replay.run.terminalKind, "answered"); assert.equal(replay.events[0].type, "run_started");
});

test("concurrent terminal finalizers use one durable compare-and-set winner", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rar-terminal-cas-"));
  const events: any[] = [];
  const c = new RunCoordinator(new RunJournal(root), e => events.push(e));
  const run = await c.admit({ sessionId: "terminal-race", prompt: "hello", connectionGeneration: 1, policy, model });
  await c.appendOwnedEvent(run.runId, { kind: "answer_delta", segmentId: "a", delta: "vouched answer" }, "answer_delta");
  const results = await Promise.all([
    c.finalize(run.runId, "answered"),
    c.finalize(run.runId, "failed", null, { code: "provider_unavailable", message: "late failure", retryable: true, recoveryAction: "retry_prompt" }),
    c.finalize(run.runId, "cancelled"),
  ]);
  assert.equal(results.filter(result => result.won).length, 1);
  assert.equal(results.filter(result => !result.won).length, 2);
  const durable = (await new RunJournal(root).replay("terminal-race", run.runId)).filter(event => event.type === "run_terminal");
  assert.equal(durable.length, 1);
  const winner = results.find(result => result.won)!;
  assert.equal(winner.run?.terminalKind, "answered");
  assert.equal(winner.run?.finalAnswer, "vouched answer");
  assert.equal(events.filter(event => event.type === "run_terminal").length, 1);
  const fresh = new RunCoordinator(new RunJournal(root));
  const replay = await fresh.replay("terminal-race", run.runId);
  assert.equal(replay.run.terminalKind, "answered");
  assert.equal(replay.run.finalAnswer, "vouched answer");
  assert.equal(replay.events.filter(event => event.type === "run_terminal").length, 1);
});

test("terminal CAS stress: twenty independent concurrent finalizer races", async () => {
  for (let iteration = 0; iteration < 20; iteration++) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "rar-terminal-cas-stress-"));
    try {
      const c = new RunCoordinator(new RunJournal(root));
      const run = await c.admit({ sessionId: `stress-${iteration}`, prompt: "hello", connectionGeneration: 1, policy, model });
      await c.appendOwnedEvent(run.runId, { kind: "answer_delta", segmentId: "a", delta: "answer" }, "answer_delta");
      const results = await Promise.all([c.finalize(run.runId, "answered"), c.finalize(run.runId, "failed", null, { code: "provider_unavailable", message: "late", retryable: true, recoveryAction: "retry_prompt" }), c.finalize(run.runId, "cancelled")]);
      assert.equal(results.filter(result => result.won).length, 1);
      assert.equal((await new RunJournal(root).replay(run.sessionId, run.runId)).filter(event => event.type === "run_terminal").length, 1);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  }
});

test("terminal mutation lock orders a racing late payload before terminal or rejects it", async () => {
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rar-terminal-late-race-"));
  const base = new RunJournal(root);
  const gated = {
    append: async (event: any) => { if (event.type === "answer_delta") await barrier; return base.append(event); },
    appendTerminal: (event: any) => base.appendTerminal(event), admit: (run: any) => base.admit(run), update: (run: any) => base.update(run),
    replay: (session: string, runId: string, after?: number) => base.replay(session, runId, after), snapshot: (session: string, runId: string) => base.snapshot(session, runId), listSnapshots: () => base.listSnapshots(),
  } as unknown as RunJournal;
  try {
    const events: any[] = []; const c = new RunCoordinator(gated, event => events.push(event));
    const run = await c.admit({ sessionId: "late-race", prompt: "hello", connectionGeneration: 1, policy, model });
    const late = c.appendOwnedEvent(run.runId, { kind: "answer_delta", segmentId: "late", delta: "late" }, "answer_delta");
    const terminal = c.finalize(run.runId, "answered", "answer");
    release();
    await Promise.allSettled([late, terminal]);
    const durable = await base.replay("late-race", run.runId);
    const terminalIndex = durable.findIndex(event => event.type === "run_terminal");
    assert.equal(durable.filter(event => event.type === "run_terminal").length, 1);
    assert.ok(terminalIndex > durable.findIndex(event => event.type === "answer_delta"));
    assert.equal(events.filter(event => event.type === "run_terminal").length, 1);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("two coordinators share durable terminal CAS and reject stale normal append", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rar-two-coordinator-cas-"));
  try {
    const c1 = new RunCoordinator(new RunJournal(root));
    const run = await c1.admit({ sessionId: "cross-process", prompt: "hello", connectionGeneration: 1, policy, model });
    await c1.appendOwnedEvent(run.runId, { kind: "answer_delta", segmentId: "a", delta: "answer" }, "answer_delta");
    const terminalEvent = (kind: any) => ({ schemaVersion: 1 as const, type: "run_terminal" as const, sessionId: run.sessionId, runId: run.runId, connectionGeneration: 1, payload: { kind: "run_terminal" as const, terminalKind: kind, finalAnswer: kind === "answered" ? "answer" : null, answerVouched: kind === "answered", failure: null, terminalAt: new Date().toISOString() } });
    const [first, second] = await Promise.all([new RunJournal(root).appendTerminal(terminalEvent("answered")), new RunJournal(root).appendTerminal(terminalEvent("failed"))]);
    assert.equal([first, second].filter(Boolean).length, 1);
    const journal = new RunJournal(root); const events = await journal.replay(run.sessionId, run.runId);
    assert.equal(events.filter(event => event.type === "run_terminal").length, 1);
    await assert.rejects(() => journal.append({ schemaVersion: 1, type: "answer_delta", sessionId: run.sessionId, runId: run.runId, connectionGeneration: 1, payload: { kind: "answer_delta", segmentId: "late", delta: "late" } }), /run terminal/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("losing coordinator reconciles its admitted snapshot to durable interrupted terminal", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rar-reconcile-terminal-"));
  try {
    const c1 = new RunCoordinator(new RunJournal(root));
    const run = await c1.admit({ sessionId: "reconcile", prompt: "hello", connectionGeneration: 1, policy, model });
    const c2 = new RunCoordinator(new RunJournal(root)); await c2.hydrate();
    const result = await c1.finalize(run.runId, "answered", "should lose");
    assert.equal(result.won, false); assert.equal(result.run?.state, "terminal"); assert.equal(result.run?.terminalKind, "failed"); assert.equal(result.run?.failure?.code, "interrupted");
    const replay = await c1.replay(run.sessionId, run.runId); assert.equal(replay.run.state, "terminal"); assert.equal(c1.get(run.runId)?.state, "terminal");
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("replay cursor cannot hide a durable terminal from stale metadata", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rar-replay-cursor-terminal-"));
  try {
    const c = new RunCoordinator(new RunJournal(root)); const run = await c.admit({ sessionId: "cursor-terminal", prompt: "x", connectionGeneration: 1, policy, model });
    await c.appendOwnedEvent(run.runId, { kind: "answer_delta", segmentId: "a", delta: "answer" }, "answer_delta"); await c.finalize(run.runId, "answered");
    const terminalSeq = (await new RunJournal(root).replay(run.sessionId, run.runId)).at(-1)!.eventSeq;
    const stale = new RunCoordinator(new RunJournal(root)); (stale as any).active.set(run.runId, { ...run, state: "admitted" });
    const replay = await stale.replay(run.sessionId, run.runId, terminalSeq); assert.equal(replay.run.state, "terminal"); assert.equal(replay.run.terminalKind, "answered"); assert.deepEqual(replay.events, []);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("empty or dead-owner events.cas.lock is stolen so the next host can hydrate", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rar-lock-stale-"));
  try {
    const j = new RunJournal(root);
    const c = new RunCoordinator(j);
    const run = await c.admit({ sessionId: "lock-stale", prompt: "x", connectionGeneration: 1, policy, model });
    const lock = path.join(root, "runs", run.sessionId, run.runId, "events.cas.lock");
    await fs.writeFile(lock, "", "utf8");
    const t0 = Date.now();
    const first = await (j as any).fileLock(run.sessionId, run.runId, async () => "ok");
    assert.equal(first, "ok");
    assert.ok(Date.now() - t0 < 400, "empty lock must be stolen immediately, not waited out");
    await fs.writeFile(lock, "99999999\n", "utf8");
    const second = await (j as any).fileLock(run.sessionId, run.runId, async () => "ok2");
    assert.equal(second, "ok2");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("cross-process journal lock is not stolen while owner is alive", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rar-lock-owner-"));
  try {
    const j1 = new RunJournal(root); const j2 = new RunJournal(root); const c = new RunCoordinator(j1);
    const run = await c.admit({ sessionId: "lock-owner", prompt: "x", connectionGeneration: 1, policy, model });
    const held = (j1 as any).fileLock("lock-owner", run.runId, async () => { await new Promise(resolve => setTimeout(resolve, 300)); });
    await new Promise(resolve => setTimeout(resolve, 20));
    const append = j2.append({ schemaVersion: 1, type: "answer_delta", sessionId: run.sessionId, runId: run.runId, connectionGeneration: 1, payload: { kind: "answer_delta", segmentId: "held", delta: "held" } });
    await Promise.all([held, append]);
    const events = await j1.replay(run.sessionId, run.runId); assert.equal(events.filter(event => event.type === "answer_delta").length, 1); assert.equal(events.at(-1)?.eventSeq, 2);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("reasoning-only completion is an explicit missing-final failure", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rar-run-")); const c = new RunCoordinator(new RunJournal(root));
  const run = await c.admit({ sessionId: "client-session-b", prompt: "think", connectionGeneration: 1, policy, model });
  await c.appendOwnedEvent(run.runId, { kind: "reasoning_delta", segmentId: "r", delta: "thinking" }, "reasoning_delta");
  const result = await c.finalize(run.runId, "answered");
  assert.equal(result.run?.terminalKind, "failed"); assert.equal(result.run?.failure?.code, "missing_final_answer");
});

test("journal ignores only an incomplete final tail and rejects corrupt non-final records", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rar-tail-")); const j = new RunJournal(root); const c = new RunCoordinator(j);
  const run = await c.admit({sessionId:"tail",prompt:"x",connectionGeneration:1,policy,model}); await c.appendOwnedEvent(run.runId,{kind:"answer_delta",segmentId:"a",delta:"ok"},"answer_delta");
  const file = path.join(root,"runs","tail",run.runId,"events.jsonl"); await fs.appendFile(file,"{\"schemaVersion\":1"); assert.equal((await j.replay("tail",run.runId)).length,2);
  await fs.writeFile(file,"{bad}\n","utf8"); await assert.rejects(()=>j.replay("tail",run.runId),/journal_corrupt/);
});

test("fresh coordinator hydrates answer ownership and interrupts orphan once", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rar-hydrate-")); const j = new RunJournal(root); const c = new RunCoordinator(j);
  const run = await c.admit({sessionId:"orphan",prompt:"x",connectionGeneration:1,policy,model}); await c.appendOwnedEvent(run.runId,{kind:"answer_delta",segmentId:"a",delta:"partial"},"answer_delta");
  const fresh = new RunCoordinator(new RunJournal(root)); await fresh.hydrate(); const replay=await fresh.replay("orphan",run.runId); assert.equal(replay.run.terminalKind,"failed"); assert.equal(replay.run.failure?.code,"interrupted"); assert.equal((await fresh.finalize(run.runId,"failed")).won,false);
});

test("incomplete tail is truncated before hydrate finalization and terminal replay stays valid", async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"rar-tail-hydrate-"));const j=new RunJournal(root);const c=new RunCoordinator(j);const run=await c.admit({sessionId:"s",prompt:"x",connectionGeneration:1,policy,model});await c.appendOwnedEvent(run.runId,{kind:"answer_delta",segmentId:"a",delta:"ok"},"answer_delta");await fs.appendFile(path.join(root,"runs","s",run.runId,"events.jsonl"),"{\"schemaVersion\":1");const fresh=new RunCoordinator(new RunJournal(root));await fresh.hydrate();const replay=await fresh.replay("s",run.runId);assert.equal(replay.run.failure?.code,"interrupted");assert.equal(replay.events.at(-1)?.type,"run_terminal");
});

test("corrupt event journal rejects hydration", async () => {const root=await fs.mkdtemp(path.join(os.tmpdir(),"rar-corrupt-"));const j=new RunJournal(root);const c=new RunCoordinator(j);const run=await c.admit({sessionId:"s",prompt:"x",connectionGeneration:1,policy,model});await fs.appendFile(path.join(root,"runs","s",run.runId,"events.jsonl"),"{bad}\n");await assert.rejects(()=>new RunCoordinator(new RunJournal(root)).hydrate(),/journal_corrupt/);});

test("concurrent appends serialize event sequence", async()=>{const root=await fs.mkdtemp(path.join(os.tmpdir(),"rar-concurrent-"));const j=new RunJournal(root);const c=new RunCoordinator(j);const run=await c.admit({sessionId:"s",prompt:"x",connectionGeneration:1,policy,model});await Promise.all(Array.from({length:20},(_,i)=>c.appendOwnedEvent(run.runId,{kind:"answer_delta",segmentId:String(i),delta:String(i)},"answer_delta")));const events=await j.replay("s",run.runId);assert.deepEqual(events.map(e=>e.eventSeq),Array.from({length:21},(_,i)=>i+1));});

test("same-session concurrent admission is atomic while different sessions proceed", async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"rar-admit-race-"));
  try {
    const c=new RunCoordinator(new RunJournal(root));
    const results=await Promise.allSettled([
      c.admit({sessionId:"same",prompt:"one",connectionGeneration:1,policy,model}),
      c.admit({sessionId:"same",prompt:"two",connectionGeneration:1,policy,model}),
      c.admit({sessionId:"other",prompt:"independent",connectionGeneration:1,policy,model}),
    ]);
    assert.equal(results.filter(r=>r.status==="fulfilled").length,2);
    const rejected=results.find(r=>r.status==="rejected") as PromiseRejectedResult;
    assert.equal((rejected.reason as any).code,"run_active");
    const sameRun=results.filter((r):r is PromiseFulfilledResult<any>=>r.status==="fulfilled").find(r=>r.value.sessionId==="same");
    assert.ok(sameRun); assert.equal(c.get(sameRun.value.runId)?.sessionId,"same");
  } finally { await fs.rm(root,{recursive:true,force:true}); }
});

test("concurrent metadata updates serialize and preserve a complete snapshot", async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"rar-meta-race-"));
  try { const j=new RunJournal(root); const c=new RunCoordinator(j); const run=await c.admit({sessionId:"meta",prompt:"x",connectionGeneration:1,policy,model}); await Promise.all(Array.from({length:20},(_,i)=>j.update({...run,lastEventSeq:i+1,updatedAt:new Date().toISOString()}))); const snapshot=await j.snapshot("meta",run.runId); assert.equal(snapshot.runId,run.runId); assert.ok(Number.isInteger(snapshot.lastEventSeq)); }
  finally { await fs.rm(root,{recursive:true,force:true}); }
});

test("hydrate trusts ordered events over stale metadata", async()=>{const root=await fs.mkdtemp(path.join(os.tmpdir(),"rar-stale-"));const j=new RunJournal(root);const c=new RunCoordinator(j);const run=await c.admit({sessionId:"s",prompt:"x",connectionGeneration:1,policy,model});await c.appendOwnedEvent(run.runId,{kind:"run_state",state:"running",liveness:"provider"},"run_state");await c.appendOwnedEvent(run.runId,{kind:"run_state",state:"recovering",liveness:"provider"},"run_state");const meta=await j.snapshot("s",run.runId);meta.state="terminal";meta.lastEventSeq=0;await j.update(meta);const fresh=new RunCoordinator(new RunJournal(root));await fresh.hydrate();const out=await fresh.replay("s",run.runId);assert.equal(out.run.failure?.code,"interrupted");assert.equal(out.run.lastEventSeq,4);});

test("terminal activity is published before run_terminal with no late activity", async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"rar-order-"));
  const j=new RunJournal(root); const published:any[]=[]; const c=new RunCoordinator(j,e=>published.push(e));
  const run=await c.admit({sessionId:"ordered",prompt:"x",connectionGeneration:1,policy,model});
  await c.appendOwnedEvent(run.runId,{kind:"activity_update",activity:{activityId:"a",invocationId:"i",name:"tool",lifecycle:"terminal",execution:"executed",status:"succeeded",input:null,output:"ok",error:null,diff:null,path:null,kind:null,fromPath:null,toPath:null,policy,automaticEligibility:"not_eligible",autoApplied:false,command:null,editId:null,recovery:null,summary:null,title:null}},"activity_update");
  await c.finalize(run.runId,"failed",null,{code:"provider_unavailable",message:"done",retryable:true,recoveryAction:"retry_prompt"});
  const terminalIndex=published.findIndex(e=>e.type==="run_terminal");
  assert.ok(terminalIndex>0);
  assert.ok(published.slice(0,terminalIndex).some(e=>e.type==="activity_update"));
  assert.equal(published.slice(terminalIndex+1).filter(e=>e.type==="activity_update").length,0);
});

test("terminal runs reject every late payload without publication or mutation", async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"rar-late-all-"));
  try {
    const published:any[]=[]; const c=new RunCoordinator(new RunJournal(root),e=>published.push(e));
    const run=await c.admit({sessionId:"late",prompt:"x",connectionGeneration:1,policy,model});
    await c.appendOwnedEvent(run.runId,{kind:"answer_delta",segmentId:"a",delta:"answer"},"answer_delta");
    await c.finalize(run.runId,"answered"); const before=published.length;
    const activity:any={activityId:"a",invocationId:"i",name:"write",lifecycle:"terminal",execution:"executed",status:"succeeded",input:null,output:"late",error:null,diff:null,path:null,kind:null,fromPath:null,toPath:null,policy,automaticEligibility:"not_eligible",autoApplied:false,command:null,editId:null,recovery:null,summary:null,title:null};
    const payloads:any[]=[
      {kind:"run_state",state:"running",liveness:"provider"},
      {kind:"reasoning_delta",segmentId:"r",delta:"late"},
      {kind:"answer_delta",segmentId:"a",delta:"late"},
      {kind:"activity_update",activity},
      {kind:"decision_request",request:{requestId:"d",invocationId:"d",kind:"permission",status:"pending",title:"late",detail:"",expiresAt:new Date(Date.now()+1000).toISOString(),policy}},
    ];
    for(const payload of payloads) await assert.rejects(()=>c.appendOwnedEvent(run.runId,payload,payload.kind),/not active/);
    assert.equal((await c.replay("late",run.runId)).run.finalAnswer,"answer"); assert.equal(published.length,before);
  } finally { await fs.rm(root,{recursive:true,force:true}); }
});

test("reclaimed generation cannot write into a later run and replay cursor remains", async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"rar-generation-")); const j=new RunJournal(root); const c=new RunCoordinator(j);
  const first=await c.admit({sessionId:"session",prompt:"one",connectionGeneration:1,policy,model}); await c.finalize(first.runId,"failed",null,{code:"provider_unavailable",message:"done",retryable:true,recoveryAction:"retry_prompt"});
  const second=await c.admit({sessionId:"session",prompt:"two",connectionGeneration:2,policy,model});
  await assert.rejects(()=>c.appendOwnedEvent(second.runId,{kind:"run_state",state:"running",liveness:"provider"},"run_state",1),/stale generation/);
  await c.appendOwnedEvent(second.runId,{kind:"answer_delta",segmentId:"a",delta:"ok"},"answer_delta",2); await c.finalize(second.runId,"answered");
  const replay=await c.replay("session",second.runId,0); assert.equal(replay.events.at(-1)?.type,"run_terminal"); assert.equal(replay.run.finalAnswer,"ok");
});

test("public state reports the aggregate active-run count across independent sessions", async () => {
  const host = await startHost({ port: await freePort(), env: { GROKFORGE_AGENT_ENTRY: path.resolve(here,"./test-support/fake-acp-agent.mjs"), GROKFORGE_FIXTURE: "long-run", XAI_API_KEY: "fixture" } });
  try {
    const admit = async (sessionId: string) => {
      const response = await fetch(`${host.baseUrl}/api/prompt`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId, text: "keep working", effort: "auto", history: [] }) });
      assert.equal(response.status, 202);
      return (await response.json() as { run: { runId: string } }).run.runId;
    };
    const runA = await admit("session-aa");
    const runB = await admit("session-bb");
    const state = await (await fetch(`${host.baseUrl}/api/state?sessionId=session-aa`)).json() as { activeRunCount: number; busy: boolean };
    assert.equal(state.activeRunCount, 2);
    assert.equal(state.busy, true);
    for (const [sessionId, runId] of [["session-aa", runA], ["session-bb", runB]]) await fetch(`${host.baseUrl}/api/cancel`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId, runId }) });
  } finally { await host.stop(); }
});

test("production host restart interrupts orphan once and preserves received content", async()=>{
  const port=await freePort();
  const first=await startHost({port,env:{GROKFORGE_AGENT_ENTRY:path.resolve(here,"./test-support/fake-acp-agent.mjs"),GROKFORGE_FIXTURE:"orphan-content",XAI_API_KEY:"fixture"}});
  const sid="restart-session";
  try {
    const admitted=await fetch(`${first.baseUrl}/api/prompt`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({sessionId:sid,text:"survive restart",effort:"auto",history:[]})});
    assert.equal(admitted.status,202); const runId=(await admitted.json() as any).run.runId;
    let seen=false; for(let i=0;i<30&&!seen;i++){await new Promise(r=>setTimeout(r,30)); const replay=await (await fetch(`${first.baseUrl}/api/runs/${runId}?sessionId=${sid}&after=0`)).json() as any; seen=replay.events?.some((e:any)=>e.type==="message_delta");}
    assert.equal(seen,true); const home=first.homeDir; await first.stopProcess();
    // Allow any in-flight child-exit/finalization callbacks to drain before
    // the replacement process opens the same durable journal.
    await new Promise(r=>setTimeout(r,250));
    // Ensure the old listener has released the port before the replacement
    // boot; process exit and socket teardown are separate on Windows.
    for(let i=0;i<30;i++){try{await fetch(`${first.baseUrl}/api/health`);await new Promise(r=>setTimeout(r,25));}catch{break;}}
    const second=await startHost({port,homeDir:home,env:{GROKFORGE_AGENT_ENTRY:path.resolve(here,"./test-support/fake-acp-agent.mjs"),GROKFORGE_FIXTURE:"orphan-content",XAI_API_KEY:"fixture"}});
    try {
      let replay:any; for(let i=0;i<30;i++){ try { replay=await (await fetch(`${second.baseUrl}/api/runs/${runId}?sessionId=${sid}&after=0`)).json(); } catch(error) { throw new Error(`replacement host request failed: ${String(error)} diagnostics=${JSON.stringify(second.diagnostics())}`); } if(replay.run?.state==="terminal") break; await new Promise(r=>setTimeout(r,30)); }
      assert.ok(replay?.run, `replacement replay missing run: ${JSON.stringify(replay)} diagnostics=${JSON.stringify(second.diagnostics())}`); assert.equal(replay.run.state,"terminal", `replacement remained nonterminal: ${JSON.stringify(replay)} diagnostics=${JSON.stringify(second.diagnostics())}`); assert.equal(replay.run.failure.code,"interrupted"); assert.equal(replay.events.filter((e:any)=>e.type==="run_terminal").length,1); assert.ok(replay.events.some((e:any)=>e.type==="message_delta"&&e.payload.delta.includes("received before restart")));
      const next=await fetch(`${second.baseUrl}/api/prompt`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({sessionId:sid,text:"after restart",effort:"auto",history:[]})}); assert.equal(next.status,202);
    } finally { await second.stop(); }
  } catch(error){ await first.stop(); throw error; }
});

test("concurrent second prompt on the same session is run_active", async () => {
  const host = await startHost({
    port: await freePort(),
    env: {
      GROKFORGE_AGENT_ENTRY: path.resolve(here, "./test-support/fake-acp-agent.mjs"),
      GROKFORGE_FIXTURE: "delayed-final",
      XAI_API_KEY: "fixture",
    },
  });
  const sid = "concurrent-busy";
  try {
    const body = (text: string) =>
      JSON.stringify({ sessionId: sid, text, effort: "auto", history: [] });
    const headers = { "content-type": "application/json" };
    const p1 = fetch(`${host.baseUrl}/api/prompt`, { method: "POST", headers, body: body("first") });
    const p2 = fetch(`${host.baseUrl}/api/prompt`, { method: "POST", headers, body: body("BUSY-SECOND-MUST-NOT-SEND") });
    const [a, b] = await Promise.all([p1, p2]);
    const ja = await a.json() as { code?: string; error?: string };
    const jb = await b.json() as { code?: string; error?: string };
    const statuses = [a.status, b.status].sort((x, y) => x - y);
    assert.equal(statuses[0], 202, JSON.stringify({ a: a.status, b: b.status, ja, jb }));
    assert.equal(statuses[1], 409, JSON.stringify({ a: a.status, b: b.status, ja, jb }));
    const rejected = a.status === 409 ? ja : jb;
    assert.equal(rejected.code, "run_active");
  } finally {
    await host.stop();
  }
});

test("production cancel stays owned until ACP terminal and then reopens admission", async()=>{
  const host=await startHost({port:await freePort(),env:{GROKFORGE_AGENT_ENTRY:path.resolve(here,"./test-support/fake-acp-agent.mjs"),GROKFORGE_FIXTURE:"cancel-content",XAI_API_KEY:"fixture"}}); const sid="cancel-boundary";
  try {
    const admitted=await fetch(`${host.baseUrl}/api/prompt`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({sessionId:sid,text:"cancel me",effort:"auto",history:[]})}); assert.equal(admitted.status,202); const runId=(await admitted.json() as any).run.runId;
    await new Promise(r=>setTimeout(r,100));
    const cancel=await fetch(`${host.baseUrl}/api/cancel`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({sessionId:sid,runId})}); assert.ok(cancel.status===202||cancel.status===200);
    const during=await fetch(`${host.baseUrl}/api/prompt`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({sessionId:sid,text:"must wait",effort:"auto",history:[]})}); assert.equal(during.status,409);
    let replay:any; for(let i=0;i<40;i++){replay=await (await fetch(`${host.baseUrl}/api/runs/${runId}?sessionId=${sid}&after=0`)).json();if(replay.run?.state==="terminal")break;await new Promise(r=>setTimeout(r,25));}
    assert.equal(replay.run.terminalKind,"cancelled"); assert.ok(replay.events.some((e:any)=>e.type==="message_delta"&&e.payload.delta.includes("answer before cancel"))); assert.ok(replay.events.some((e:any)=>e.type==="reasoning_delta"));
    const next=await fetch(`${host.baseUrl}/api/prompt`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({sessionId:sid,text:"after cancel",effort:"auto",history:[]})}); assert.equal(next.status,202);
  } finally { await host.stop(); }
});

test("production terminal ownership ignores every late ACP event and decision", async()=>{
  const host=await startHost({port:await freePort(),env:{GROKFORGE_AGENT_ENTRY:path.resolve(here,"./test-support/fake-acp-agent.mjs"),GROKFORGE_FIXTURE:"late-events",XAI_API_KEY:"fixture"}}); const sid="late-host";
  try {
    const admitted=await fetch(`${host.baseUrl}/api/prompt`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({sessionId:sid,text:"settle",effort:"auto",history:[]})}); const runId=(await admitted.json() as any).run.runId;
    let first:any; for(let i=0;i<40;i++){first=await (await fetch(`${host.baseUrl}/api/runs/${runId}?sessionId=${sid}&after=0`)).json();if(first.run?.state==="terminal")break;await new Promise(r=>setTimeout(r,25));}
    assert.equal(first.run.terminalKind,"answered"); const before=first.events.length; await new Promise(r=>setTimeout(r,250)); const after=await (await fetch(`${host.baseUrl}/api/runs/${runId}?sessionId=${sid}&after=0`)).json() as any;
    assert.equal(after.events.length,before); assert.equal(after.run.finalAnswer,"settled answer"); assert.equal(after.events.filter((e:any)=>e.type==="decision_request").length,0); assert.equal(after.events.filter((e:any)=>e.type==="activity_update").length,0);
    for(const route of ["permission","diff"]){const response=await fetch(`${host.baseUrl}/api/${route}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({sessionId:sid,runId,requestId:"late",invocationId:"late",editId:"late",decision:"allow_once",action:"accept"})});assert.ok(response.status===404||response.status===409);}
    assert.equal(await fetch(`${host.baseUrl}/api/workspace/read?path=late.txt`).then(r=>r.status),404);
  } finally { await host.stop(); }
});

test("production provider silence publishes recovery, bounds terminal, and isolates admission", async()=>{
  const releasePath=path.join(await fs.mkdtemp(path.join(os.tmpdir(),"rar-provider-release-")),"release");
  const host=await startHost({port:await freePort(),env:{GROKFORGE_AGENT_ENTRY:path.resolve(here,"./test-support/fake-acp-agent.mjs"),GROKFORGE_FIXTURE:"provider-silence",GROKFORGE_FIXTURE_RELEASE:releasePath,XAI_API_KEY:"fixture"}});
  try {
    const admit=async(sessionId:string)=>{const r=await fetch(`${host.baseUrl}/api/prompt`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({sessionId,text:"silent",effort:"auto",history:[]})});assert.equal(r.status,202);return (await r.json() as any).run.runId;};
    const runA=await admit("silent-a");
    let replay:any; for(let i=0;i<100;i++){replay=await (await fetch(`${host.baseUrl}/api/runs/${runA}?sessionId=silent-a&after=0`)).json();if(replay.events?.some((e:any)=>e.type==="run_state"&&e.payload.state==="recovering"))break;await new Promise(r=>setTimeout(r,10));}
    assert.ok(replay.events?.some((e:any)=>e.type==="run_state"&&e.payload.state==="recovering"));
    const blockedDuring=await fetch(`${host.baseUrl}/api/prompt`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({sessionId:"silent-a",text:"blocked",effort:"auto",history:[]})});
    assert.equal(blockedDuring.status,409); assert.equal((await blockedDuring.json()).code,"run_active");
    const runB=await admit("silent-b");
    await fs.writeFile(releasePath,"release\n");
    for(let i=0;i<100;i++){replay=await (await fetch(`${host.baseUrl}/api/runs/${runA}?sessionId=silent-a&after=0`)).json();if(replay.run?.state==="terminal")break;await new Promise(r=>setTimeout(r,10));}
    assert.equal(replay.run.state,"terminal"); assert.equal(replay.run.terminalKind,"failed"); assert.equal(replay.run.failure.code,"provider_liveness_exhausted");
    const other=await fetch(`${host.baseUrl}/api/prompt`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({sessionId:"silent-b",text:"independent",effort:"auto",history:[]})}); assert.ok(other.status===202||other.status===409);
  } finally { await host.stop(); }
});

// AC26 RED oracle: this is deliberately retained until the production child -> host ->
// provider boundary proves abort/recovery and idempotent completed-tool handling.
test("AC26 RED oracle: real Grok ACP recovers a stalled provider stream after a completed tool", async()=>{
  const provider = await startProviderFixture();
  const host = await startHost({ port: await freePort(), env: {
    GROKFORGE_AGENT_ENTRY: path.resolve(here, "../../../packages/grok-acp/src/index.ts"),
    GROKFORGE_XAI_BASE: provider.base, GROKFORGE_PROVIDER_IDLE_MS: "80", XAI_API_KEY: "fixture",
  }});
  const sid = "ac26-real-provider";
  try {
    const admitted = await fetch(`${host.baseUrl}/api/prompt`, { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({sessionId:sid,text:"inspect then answer",effort:"auto",history:[]}) });
    assert.equal(admitted.status, 202);
    const runId = (await admitted.json() as any).run.runId;
    let replay:any;
    for (let i=0;i<100;i++) { replay = await (await fetch(`${host.baseUrl}/api/runs/${runId}?sessionId=${sid}&after=0`)).json(); if (replay.run?.state === "terminal") break; await new Promise(r=>setTimeout(r,25)); }
    assert.equal(replay.run?.state, "terminal");
    assert.equal(replay.run?.terminalKind, "answered");
    assert.equal(replay.run?.finalAnswer, "partial recovered answer");
    assert.ok(replay.events.some((e:any)=>e.type === "run_state" && e.payload.state === "recovering"));
    assert.equal(replay.events.filter((e:any)=>e.type === "message_delta").map((e:any)=>e.payload.delta).join(""), "partial recovered answer");
    assert.equal(provider.requests.length, 3);
    assert.equal(provider.requests[1].messages.filter((m:any)=>m.role === "tool").length, 1);
    assert.equal(provider.requests[2].messages.filter((m:any)=>m.role === "tool").length, 1);
  } finally { await host.stop(); await provider.close(); }
});

test("AC25 deterministic liveness: virtual elapsed time never terminalizes a live run", async()=>{
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rar-liveness-floor-"));
  const coordinator = new RunCoordinator(new RunJournal(root));
  const originalNow = Date.now;
  let virtualNow = originalNow();
  Date.now = () => virtualNow;
  try {
    const cases: Array<["running"|"waiting_for_decision"|"recovering", "provider"|"tool"|"decision"|"background"|"journal_recovery"]> = [
      ["running", "provider"], ["running", "tool"], ["waiting_for_decision", "decision"], ["running", "background"], ["recovering", "journal_recovery"],
    ];
    for (const [state, liveness] of cases) {
      const sessionId = `liveness-${liveness}`;
      const run = await coordinator.admit({sessionId, prompt:"keep alive", connectionGeneration:1, policy, model});
      await coordinator.appendOwnedEvent(run.runId, {kind:"run_state", state:"running", liveness}, "run_state");
      if (state !== "running") await coordinator.appendOwnedEvent(run.runId, {kind:"run_state", state, liveness}, "run_state");
      virtualNow += 16 * 60 * 1000;
      const stillLive = coordinator.get(run.runId);
      assert.equal(stillLive?.state, state);
      await assert.rejects(() => coordinator.admit({sessionId, prompt:"must wait", connectionGeneration:1, policy, model}), /run active/);
      await coordinator.finalize(run.runId, "failed", null, {code:"provider_unavailable", message:"fixture cleanup", retryable:true, recoveryAction:"retry_prompt"});
    }
  } finally { Date.now = originalNow; await fs.rm(root, {recursive:true, force:true}); }
});
