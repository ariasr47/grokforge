import test from "node:test";
import assert from "node:assert/strict";
import {
  initialRunProjection,
  mergeRunSnapshot,
  reduceRunEvent,
  type RunEventEnvelope,
  type RunSnapshot,
} from "./runReducer";
import {
  CODE_RUN_CONFIRM_ERROR,
  CODE_RUN_FALLBACK,
  CODE_RUN_HYDRATING,
  CODE_RUN_VENDOR,
  codeRunProvenanceCopy,
  projectCodeRunProvenance,
} from "./codeRunProvenance";

function snap(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    sessionId: "s1",
    runId: "r1",
    connectionGeneration: 1,
    state: "running",
    acceptedPrompt: "prompt",
    admittedAt: "",
    updatedAt: "",
    lastEventSeq: 0,
    policy: {},
    model: {},
    terminalKind: null,
    finalAnswer: null,
    answerVouched: false,
    failure: null,
    ...overrides,
  };
}

function started(s: RunSnapshot, seq = 1): RunEventEnvelope {
  return {
    schemaVersion: 1,
    type: "run_started",
    sessionId: s.sessionId,
    runId: s.runId,
    eventSeq: seq,
    connectionGeneration: s.connectionGeneration,
    occurredAt: "",
    payload: { kind: "run_started", run: s },
  };
}

test("Chat / no Code run → absent", () => {
  assert.equal(
    projectCodeRunProvenance({
      mode: "chat",
      run: { state: "running", codeAgentProvenance: { identity: "vendor", fallbackReason: null } },
      catchUp: { phase: "closed" },
    }).state,
    "absent",
  );
  assert.equal(
    projectCodeRunProvenance({
      mode: "code",
      run: null,
      catchUp: { phase: "closed" },
    }).state,
    "absent",
  );
});

test("hydrating while catch-up open or missing stamp on live Code run", () => {
  assert.equal(
    projectCodeRunProvenance({
      mode: "code",
      run: { state: "running", codeAgentProvenance: { identity: "vendor", fallbackReason: null } },
      catchUp: { phase: "open" },
    }).state,
    "hydrating",
  );
  const missing = projectCodeRunProvenance({
    mode: "code",
    run: { state: "running", codeAgentProvenance: null },
    catchUp: { phase: "closed" },
  });
  assert.equal(missing.state, "hydrating");
  assert.equal(codeRunProvenanceCopy(missing), CODE_RUN_HYDRATING);
});

test("vouched vendor / fallback (+ reason) never invent vendor from null", () => {
  const vendor = projectCodeRunProvenance({
    mode: "code",
    run: { state: "terminal", codeAgentProvenance: { identity: "vendor", fallbackReason: null } },
    catchUp: { phase: "closed" },
  });
  assert.equal(vendor.state, "vendor");
  assert.equal(codeRunProvenanceCopy(vendor), CODE_RUN_VENDOR);

  const fallback = projectCodeRunProvenance({
    mode: "code",
    run: {
      state: "terminal",
      codeAgentProvenance: { identity: "fallback", fallbackReason: "cli_missing" },
    },
    catchUp: { phase: "closed" },
  });
  assert.equal(fallback.state, "fallback");
  assert.match(codeRunProvenanceCopy(fallback), /Mini-Grok · fallback/);
  assert.match(codeRunProvenanceCopy(fallback), /Grok CLI not found/);
  assert.notEqual(codeRunProvenanceCopy(fallback), CODE_RUN_VENDOR);

  const generic = projectCodeRunProvenance({
    mode: "code",
    run: { state: "terminal", codeAgentProvenance: { identity: "fallback", fallbackReason: null } },
    catchUp: { phase: "closed" },
  });
  assert.equal(codeRunProvenanceCopy(generic), CODE_RUN_FALLBACK);
});

test("catch-up failed without stamp → confirm error", () => {
  const projection = projectCodeRunProvenance({
    mode: "code",
    run: { state: "running", codeAgentProvenance: null },
    catchUp: { phase: "failed" },
  });
  assert.equal(projection.state, "confirm_error");
  assert.equal(codeRunProvenanceCopy(projection), CODE_RUN_CONFIRM_ERROR);
});

test("terminal Code run without stamp is absent — old journals do not scream voucher failure", () => {
  const projection = projectCodeRunProvenance({
    mode: "code",
    run: { state: "terminal", codeAgentProvenance: null },
    catchUp: { phase: "closed" },
  });
  assert.equal(projection.state, "absent");
  assert.equal(codeRunProvenanceCopy(projection), "");
});

test("reload fixture keeps stamped provenance; later run id does not rewrite prior", () => {
  const first = snap({
    runId: "r1",
    codeAgentProvenance: { identity: "vendor", fallbackReason: null },
  });
  let state = reduceRunEvent(initialRunProjection(), started(first));
  assert.equal(state.runsById.r1?.codeAgentProvenance?.identity, "vendor");

  const later = snap({
    runId: "r2",
    codeAgentProvenance: { identity: "fallback", fallbackReason: "spawn_failed" },
  });
  state = reduceRunEvent(state, started(later));
  assert.equal(state.runsById.r1?.codeAgentProvenance?.identity, "vendor");
  assert.equal(state.runsById.r2?.codeAgentProvenance?.identity, "fallback");
  assert.equal(state.runsById.r2?.codeAgentProvenance?.fallbackReason, "spawn_failed");

  const replayed = mergeRunSnapshot(initialRunProjection(), first);
  assert.equal(replayed.runsById.r1?.codeAgentProvenance?.identity, "vendor");
  const missing = mergeRunSnapshot(initialRunProjection(), snap({ runId: "r3" }));
  assert.equal(missing.runsById.r3?.codeAgentProvenance ?? null, null);
});

test("missing snapshot field is null — never invented from agentName", () => {
  const admitted = mergeRunSnapshot(initialRunProjection(), snap());
  assert.equal(admitted.runsById.r1?.codeAgentProvenance ?? null, null);
  const named = { ...snap(), model: { agentName: "Grok Code" } };
  const merged = mergeRunSnapshot(initialRunProjection(), named);
  assert.equal(merged.runsById.r1?.codeAgentProvenance ?? null, null);
});

test("agent_exited failed terminal stays failed — not healthy in-flight", () => {
  let state = reduceRunEvent(initialRunProjection(), started(snap()));
  state = reduceRunEvent(state, {
    schemaVersion: 1,
    type: "run_terminal",
    sessionId: "s1",
    runId: "r1",
    eventSeq: 2,
    connectionGeneration: 1,
    occurredAt: "",
    payload: {
      kind: "run_terminal",
      terminalKind: "failed",
      finalAnswer: null,
      answerVouched: false,
      failure: {
        code: "agent_exited",
        message: "Agent exited",
        retryable: true,
        recoveryAction: "retry_prompt",
      },
      terminalAt: "",
    },
  });
  const run = state.runsById.r1;
  assert.equal(run?.state, "terminal");
  assert.equal(run?.terminalKind, "failed");
  assert.equal(run?.failure?.code, "agent_exited");
});
