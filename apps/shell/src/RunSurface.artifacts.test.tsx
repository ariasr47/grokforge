import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createElement } from "react";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { RunSurface } from "./RunSurface.js";
import type { RunProjectionRun } from "./runReducer.js";

afterEach(() => cleanup());

const carousel = {
  version: 1,
  blocks: [
    {
      type: "carousel",
      title: "Best sides",
      items: [{ title: "Steamed rice", body: "Short-grain.", badge: "Essential" }],
    },
  ],
};

function answeredRun(finalAnswer: string): RunProjectionRun {
  return {
    sessionId: "s",
    runId: "run-live-1",
    connectionGeneration: 1,
    state: "terminal",
    acceptedPrompt: "sides",
    admittedAt: "",
    updatedAt: "",
    lastEventSeq: 2,
    policy: {},
    model: {},
    terminalKind: "answered",
    finalAnswer,
    answerVouched: true,
    failure: null,
    reasoning: {},
    answer: {},
    message: {},
    activities: {},
    decisions: {},
    seenEventSeq: new Set([1]),
    terminalEventSeq: 2,
  } as RunProjectionRun;
}

describe("RunSurface artifact Open + compact", () => {
  it("settled elevatable grok-ui offers Open on the live answer chrome", () => {
    const text = "Intro\n\n```grok-ui\n" + JSON.stringify(carousel) + "\n```";
    render(
      createElement(RunSurface, {
        run: answeredRun(text),
        productMode: "chat",
        artifactOpen: false,
        onOpenArtifact: () => {},
      }),
    );
    assert.ok(screen.getByRole("button", { name: /^Open$/i }));
    assert.ok(document.querySelector(".assistant-answer"));
  });

  it("Thought-only / mid-turn / unsettled do not offer Open", () => {
    const running = answeredRun("");
    (running as { state: string }).state = "running";
    (running as { terminalKind: string | null }).terminalKind = null;
    (running as { answerVouched: boolean }).answerVouched = false;
    (running as { finalAnswer?: string }).finalAnswer = undefined;
    (running as { reasoning: Record<string, string> }).reasoning = { r: "secret thought" };
    render(
      createElement(RunSurface, {
        run: running,
        productMode: "chat",
        artifactOpen: false,
        onOpenArtifact: () => {},
      }),
    );
    assert.equal(screen.queryByRole("button", { name: /^Open$/i }), null);
  });

  it("when artifactOpen, .assistant-answer is compact: full dump not presented; no overflow scroll", () => {
    const text = "Intro\n\n```grok-ui\n" + JSON.stringify(carousel) + "\n```";
    render(
      createElement(RunSurface, {
        run: answeredRun(text),
        productMode: "chat",
        artifactOpen: true,
        onOpenArtifact: () => {},
      }),
    );
    const answer = document.querySelector(".assistant-answer") as HTMLElement | null;
    assert.ok(answer);
    assert.ok(answer!.classList.contains("assistant-answer--compact"));
    const cs = getComputedStyle(answer!);
    // Legal: display:none or equivalent not-presented. Illegal: scrollable full tree.
    assert.ok(cs.display === "none" || answer!.getAttribute("hidden") != null || cs.visibility === "hidden");
    assert.ok(cs.overflow !== "auto" && cs.overflow !== "scroll");
    assert.ok(cs.overflowY !== "auto" && cs.overflowY !== "scroll");
  });

  it("Open click invokes onOpenArtifact with runId", () => {
    const text = "```grok-ui\n" + JSON.stringify(carousel) + "\n```";
    let opened: string | null = null;
    render(
      createElement(RunSurface, {
        run: answeredRun(text),
        productMode: "chat",
        artifactOpen: false,
        onOpenArtifact: (id) => {
          opened = id;
        },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /^Open$/i }));
    assert.equal(opened, "run-live-1");
  });
});
