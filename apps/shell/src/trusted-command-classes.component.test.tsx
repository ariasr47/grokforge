import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen } from "@testing-library/react";
import { RunSurface } from "./RunSurface";
import { ToolActivityGroup } from "./ToolActivity";
import { isListAutoExecuted } from "./trustedCommandProvenance";
import { TrustedCommandClassesControl } from "./TrustedCommandClassesControl";
import type { RunProjectionRun, RunSnapshot } from "./runReducer";
import type { ChatMessage } from "./messageBlocks";

afterEach(() => cleanup());

const snapshot: RunSnapshot = {
  sessionId: "session-a",
  runId: "run-a",
  connectionGeneration: 1,
  state: "running",
  acceptedPrompt: "verify",
  admittedAt: "",
  updatedAt: "",
  lastEventSeq: 2,
  policy: { effectiveMode: "trusted_workspace" },
  model: { id: "grok-4.6" },
  terminalKind: null,
  finalAnswer: null,
  answerVouched: false,
  failure: null,
};

const run = (overrides: Partial<RunProjectionRun> = {}): RunProjectionRun => ({
  ...snapshot,
  reasoning: {},
  answer: {},
  activities: {},
  decisions: {},
  seenEventSeq: new Set([1]),
  terminalEventSeq: null,
  ...overrides,
});

function activity(overrides: Record<string, unknown> = {}) {
  return {
    activityId: "a",
    invocationId: "i",
    name: "run_shell",
    lifecycle: "terminal",
    execution: "executed",
    status: "succeeded",
    input: { command: "npm test" },
    output: "ok",
    error: null,
    diff: null,
    policy: { effectiveMode: "trusted_workspace" },
    automaticEligibility: "trusted_command_class",
    autoApplied: true,
    command: "npm test",
    editId: null,
    recovery: null,
    ...overrides,
  } as RunProjectionRun["activities"][string];
}

test("list-auto executed shell shows original command and Trusted command class chip", () => {
  render(<RunSurface run={run({ activities: { a: activity() } })} />);
  assert.ok(screen.getByText("npm test"));
  const chip = screen.getByText("Ran without asking · Trusted command class");
  assert.ok(chip);
  assert.equal(
    chip.getAttribute("title"),
    "Matched a saved class for this workspace. The process is not sandboxed.",
  );
});

test("not_executed never receives the list-auto chip even if eligibility is present", () => {
  render(
    <RunSurface
      run={run({
        activities: {
          a: activity({
            execution: "not_executed",
            status: "rejected",
            automaticEligibility: "trusted_command_class",
            autoApplied: true,
            command: "ls",
          }),
        },
      })}
    />,
  );
  assert.ok(screen.getByText("ls"));
  assert.equal(screen.queryByText("Ran without asking · Trusted command class"), null);
});

test("bypass executed shell keeps existing auto labeling, not Trusted command class", () => {
  render(
    <RunSurface
      run={run({
        activities: {
          a: activity({
            automaticEligibility: "bypass",
            autoApplied: true,
            command: "npm test",
            policy: { effectiveMode: "bypass_permissions" },
          }),
        },
      })}
    />,
  );
  assert.equal(screen.queryByText("Ran without asking · Trusted command class"), null);
  assert.ok(screen.getByText(/Applied automatically · Trusted workspace/));
});

test("fixed inspection is not relabeled as a Trusted command class", () => {
  render(
    <RunSurface
      run={run({
        activities: {
          a: activity({
            automaticEligibility: "fixed_inspection",
            autoApplied: true,
            command: "git status --short",
          }),
        },
      })}
    />,
  );
  assert.equal(screen.queryByText("Ran without asking · Trusted command class"), null);
});

test("draft editor state cannot invent the list-auto chip", () => {
  render(
    <>
      <TrustedCommandClassesControl
        status="confirmed"
        policyMode="trusted_workspace"
        confirmed={{
          classes: ["npm"],
          revision: "r1",
          source: "saved",
          fallbackReason: null,
          savedForWorkspace: true,
          catalog: [{ id: "npm", label: "npm" }],
        }}
        onSave={async () => {}}
      />
      <RunSurface
        run={run({
          activities: {
            a: activity({
              automaticEligibility: "not_eligible",
              autoApplied: false,
              command: "npm test",
            }),
          },
        })}
      />
    </>,
  );
  assert.ok(screen.getByRole("group", { name: "Trusted command classes" }));
  assert.equal(screen.queryByText("Ran without asking · Trusted command class"), null);
});

test("ToolActivity paints list-auto provenance only from host-vouched fields", () => {
  const tools: ChatMessage[] = [
    {
      id: "tool-1",
      role: "tool",
      content: "ok",
      toolMeta: {
        name: "run_shell",
        summary: "npm test",
        done: true,
        ok: true,
        execution: "executed",
        status: "succeeded",
        command: "npm test",
        activityEvent: {
          schemaVersion: 2,
          type: "tool_run",
          activityId: "a",
          toolCallId: "i",
          lifecycle: "terminal",
          execution: "executed",
          status: "succeeded",
          name: "run_shell",
          input: { command: "npm test" },
          summary: "npm test",
          command: "npm test",
          output: "ok",
          error: null,
          reasonCode: null,
          reason: null,
          shellDisplayName: "cmd",
          detailAvailable: true,
          automaticEligibility: "trusted_command_class",
          autoApplied: true,
        },
      },
    },
  ];
  render(<ToolActivityGroup tools={tools} groupKey="activity-run:list-auto" forceOpen />);
  assert.ok(screen.getByText("npm test"));
  assert.ok(screen.getByText("Ran without asking · Trusted command class"));
});

test("isListAutoExecuted requires executed + trusted_command_class + autoApplied", () => {
  assert.equal(
    isListAutoExecuted({
      execution: "executed",
      automaticEligibility: "trusted_command_class",
      autoApplied: true,
    }),
    true,
  );
  assert.equal(
    isListAutoExecuted({
      execution: "not_executed",
      automaticEligibility: "trusted_command_class",
      autoApplied: true,
    }),
    false,
  );
  assert.equal(
    isListAutoExecuted({
      execution: "executed",
      automaticEligibility: "bypass",
      autoApplied: true,
    }),
    false,
  );
  assert.equal(
    isListAutoExecuted({
      execution: "executed",
      automaticEligibility: "trusted_command_class",
      autoApplied: false,
    }),
    false,
  );
});
