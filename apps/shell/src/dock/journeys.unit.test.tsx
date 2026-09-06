/**
 * J1–J6 shipped-unit oracles. Each assertion calls the product function
 * (or renders the product component) — no reimplementation, no hardcoded theater.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render, screen, within } from "@testing-library/react";
import { VENDOR_ACP_SHELL_CWD_RULE } from "@grokforge/acp-client";
import { ActionDock, PLAN_ACCEPT, PLAN_KEEP } from "./ActionDock";
import { activityLooksLikeWrite } from "../projections/activityWriteLike";
import { atFileSuggestions } from "../composer/atFileQuery";
import { draftIsSendReady } from "../composer/ComposerPane";
import { MENTION_ATTACH_MARKER, splitUserPromptMentions, visibleUserPrompt } from "../composer/expandMentions";
import { CHANGES_DOCK_LABEL, ChangesDock } from "./ChangesDock";
import type { RunChangeMember } from "../projections/runChangeList";
import { planReadyIsEmpty, projectRunPlanSection } from "../projections/runPlanSection";
import type { PlanRecord, RunProjectionRun } from "../projections/runReducer";
import { Receipts } from "../thread/Receipts";
import type { ChatMessage } from "../thread/messageBlocks";

afterEach(() => cleanup());

const chrome = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "styles", "chrome.css"),
  "utf8",
);

describe("J1 Write — Review write membership lists in File changes", () => {
  it("vendor write tools are write-like; reads are not", () => {
    assert.equal(activityLooksLikeWrite({ name: "write", title: "Write file" }), true);
    assert.equal(activityLooksLikeWrite({ name: "write_file" }), true);
    assert.equal(activityLooksLikeWrite({ name: "read file", editId: "e1" }), false);
    assert.equal(activityLooksLikeWrite({ name: "grep" }), false);
  });

  it("File changes ready state lists the landed workspace path", () => {
    const member: RunChangeMember = {
      editId: "e1",
      path: "docs/dogfood/J1-WEB.md",
      kind: "content",
      fromPath: null,
      toPath: null,
      activityId: "a1",
      invocationId: "i1",
      requestId: null,
      diff: "--- /dev/null\n+++ b/docs/dogfood/J1-WEB.md\n@@ -0,0 +1 @@\n+J1-WEB-OK",
      settlement: "applied",
      recoveryAvailable: true,
      diffUnavailable: false,
    };
    render(
      <ChangesDock
        files={{ state: "ready", members: [{ ...member, runId: "r1" }] }}
        verify={{ state: "ready", runLive: false, members: [] }}
        git={{ state: "ready", members: [] }}
        diffQueue={[]}
        onAccept={() => undefined}
        onReject={() => undefined}
        onCollapse={() => undefined}
        onOpenReview={() => undefined}
      />,
    );
    const dock = screen.getByRole("region", { name: CHANGES_DOCK_LABEL });
    assert.ok(within(dock).getByText("docs/dogfood/"));
    assert.ok(within(dock).getByText("J1-WEB.md"));
  });
});

describe("J2 Test — first-subdir Set-Location + Failed is Failed", () => {
  it("vendor cwd rule requires Set-Location DIR; then the command in the same invocation", () => {
    assert.match(VENDOR_ACP_SHELL_CWD_RULE, /Set-Location DIR/);
    assert.match(VENDOR_ACP_SHELL_CWD_RULE, /SAME invocation/);
    assert.match(VENDOR_ACP_SHELL_CWD_RULE, /Set-Location apps\/shell;/);
    assert.doesNotMatch(VENDOR_ACP_SHELL_CWD_RULE, /cd /);
  });

  it("non-zero shell exit paints as failed, not as a clean run whose body is just the word completed", () => {
    const tools: ChatMessage[] = [
      {
        id: "t-fail",
        role: "tool",
        content: "completed",
        toolMeta: {
          name: "run_terminal_command",
          title: 'Execute `node -e "process.exit(2)"`',
          command: 'Set-Location apps/shell; node -e "process.exit(2)"',
          done: true,
          ok: false,
          execution: "executed",
          status: "failed",
        },
      },
    ];
    render(<Receipts tools={tools} groupKey="activity-run:j2" />);
    assert.ok(screen.getByText("Non-zero exit"));
    assert.equal(screen.queryByText("completed") === null, true);
  });
});

describe("J3 Check — tsc through the same first-subdir rule", () => {
  it("cwd rule example is a subdirectory tsc-class command, not a root-first retry", () => {
    assert.match(VENDOR_ACP_SHELL_CWD_RULE, /Set-Location apps\/shell; node --test/);
    assert.match(VENDOR_ACP_SHELL_CWD_RULE, /Never run the relative path at workspace root first/);
  });
});

describe("J4 Plan — Accept plan + three-step body is a real plan", () => {
  it("dock exposes Accept plan for a non-empty proposal", () => {
    render(
      <ActionDock
        permissions={[]}
        oauth={null}
        onPermission={() => undefined}
        planDecision={{ empty: false }}
        onPlanAccept={() => undefined}
        onPlanKeepPlanning={() => undefined}
      />,
    );
    const dock = screen.getByRole("region", { name: "Pending agent actions" });
    assert.ok(within(dock).getByRole("button", { name: PLAN_ACCEPT }));
    assert.ok(within(dock).getByRole("button", { name: PLAN_KEEP }));
  });

  it("three-step plan body is ready and not empty", () => {
    const body =
      "Three-step plan for apps/shell typecheck.\n\n1. Set-Location apps/shell\n2. npx tsc --noEmit\n3. Read the result.";
    assert.equal(planReadyIsEmpty(body, 0), false);
    const projected = projectRunPlanSection(
      {
        sessionId: "s1",
        runId: "r1",
        connectionGeneration: 1,
        state: "running",
        acceptedPrompt: "plan this",
        admittedAt: "",
        updatedAt: "",
        lastEventSeq: 2,
        policy: { effectiveMode: "review" },
        model: { id: "grok-4.6" },
        terminalKind: null,
        finalAnswer: null,
        answerVouched: false,
        failure: null,
        executionPhase: "plan",
        reasoning: {},
        message: {},
        answer: {},
        activities: {},
        decisions: {},
        seenEventSeq: new Set([1]),
        terminalEventSeq: null,
        plan: {
          runId: "r1",
          sessionId: "s1",
          connectionGeneration: 1,
          status: "ready",
          body,
          proposedMembers: [],
          policy: { effectiveMode: "review" },
          executionPhase: "plan",
        } satisfies PlanRecord,
      } as RunProjectionRun,
      { phase: "closed" },
    );
    assert.equal(projected.state, "ready");
    if (projected.state === "ready") {
      assert.equal(projected.empty, false);
      assert.match(projected.body ?? "", /1\.\s*Set-Location/);
      assert.match(projected.body ?? "", /2\.\s*npx tsc/);
      assert.match(projected.body ?? "", /3\.\s*Read/);
    }
  });
});

describe("J5 Skill — last-row-scrollable catalog + /session-info sendable", () => {
  it("skills list is the inner scroller (overflow auto, flex 1)", () => {
    const listBody = chrome.match(/\.skills-palette-list\s*\{([^}]+)\}/);
    assert.ok(listBody?.[1], "missing .skills-palette-list");
    assert.match(listBody[1]!, /overflow:\s*auto/);
    assert.match(listBody[1]!, /flex:\s*1 1 auto/);
    const pal = chrome.match(/\.skills-palette\s*\{([^}]+)\}/);
    assert.ok(pal?.[1]);
    assert.match(pal[1]!, /height:\s*min\(360px/);
  });

  it("/session-info is sendable only as an exact catalog hit", () => {
    const catalog = ["/session-info", "/compact"];
    assert.equal(draftIsSendReady("/session-info", catalog), true);
    assert.equal(draftIsSendReady("/session-info"), false);
    assert.equal(draftIsSendReady("/", catalog), false);
    assert.equal(draftIsSendReady("/sess", catalog), false);
  });
});

describe("J6 @file — @KEEP ranks first; You shows mention not dump", () => {
  it("KEEP.md ranks ahead of forge-keep screenshots", () => {
    const files = [
      "docs/dogfood/forge-keep-ten.png",
      "docs/dogfood/forge-keep-thirty.png",
      "docs/brand/source/.gitkeep",
      "docs/dogfood/KEEP.md",
    ];
    assert.equal(atFileSuggestions(files, "KEEP")[0], "docs/dogfood/KEEP.md");
  });

  it("You prompt is the mention, not the attached dump", () => {
    const typed = "@docs/dogfood/KEEP.md Quote the first heading.";
    const dumped = `${typed}\n\n${MENTION_ATTACH_MARKER}\n# KEEP\nTEN through FORTYEIGHT`;
    assert.equal(visibleUserPrompt(dumped), typed);
    const parts = splitUserPromptMentions(typed);
    assert.equal(parts[0]?.kind, "mention");
    assert.equal(parts[0]?.value, "@docs/dogfood/KEEP.md");
    assert.equal(visibleUserPrompt(typed).includes(MENTION_ATTACH_MARKER), false);
  });
});
