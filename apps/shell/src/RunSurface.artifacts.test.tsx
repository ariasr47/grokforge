import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createElement } from "react";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import {
  RunSurface,
  nextPromptOverflow,
  nextThoughtOpen,
  promptBodyMeasuresOverflow,
  runPromptStickBelowPx,
  runFileStickBelowPx,
  collapsedThoughtHeightPx,
} from "./RunSurface.js";
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

describe("RunSurface You prompt card", () => {
  it("labels the accepted prompt as a You card", () => {
    render(
      createElement(RunSurface, {
        run: answeredRun("ok"),
        productMode: "code",
      }),
    );
    const card = document.querySelector(".run-prompt");
    assert.ok(card);
    assert.equal(card!.querySelector(".run-prompt-role")?.textContent, "You");
    assert.equal(card!.querySelector(".run-prompt-body")?.textContent, "sides");
  });

  it("clicking You expands the 2-line clamp", () => {
    const proto = HTMLElement.prototype;
    const prevScroll = Object.getOwnPropertyDescriptor(proto, "scrollHeight");
    const prevClient = Object.getOwnPropertyDescriptor(proto, "clientHeight");
    Object.defineProperty(proto, "scrollHeight", {
      configurable: true,
      get() {
        return (this as HTMLElement).classList?.contains("run-prompt-body") ? 80 : 0;
      },
    });
    Object.defineProperty(proto, "clientHeight", {
      configurable: true,
      get() {
        return (this as HTMLElement).classList?.contains("run-prompt-body") ? 36 : 0;
      },
    });
    try {
      const run = answeredRun("ok");
      run.acceptedPrompt = "Line one of a long prompt.\nLine two continues.\nLine three should show after expand.";
      render(
        createElement(RunSurface, {
          run,
          productMode: "code",
        }),
      );
      const toggle = screen.getByRole("button", { name: /you/i });
      assert.equal(toggle.getAttribute("aria-expanded"), "false");
      assert.equal(document.querySelector(".run-prompt")?.classList.contains("is-expanded"), false);
      assert.equal(screen.getByText("Show more").textContent, "Show more");
      assert.equal(document.querySelector(".run-prompt-chevron"), null);
      fireEvent.click(toggle);
      assert.equal(toggle.getAttribute("aria-expanded"), "true");
      assert.equal(document.querySelector(".run-prompt")?.classList.contains("is-expanded"), true);
      assert.equal(screen.getByText("Show less").textContent, "Show less");
      fireEvent.click(toggle);
      assert.equal(toggle.getAttribute("aria-expanded"), "false");
      assert.equal(screen.getByText("Show more").textContent, "Show more");
    } finally {
      if (prevScroll) Object.defineProperty(proto, "scrollHeight", prevScroll);
      else delete (proto as unknown as Record<string, unknown>).scrollHeight;
      if (prevClient) Object.defineProperty(proto, "clientHeight", prevClient);
      else delete (proto as unknown as Record<string, unknown>).clientHeight;
    }
  });

  it("short You prompts do not offer Show more", () => {
    render(
      createElement(RunSurface, {
        run: answeredRun("ok"),
        productMode: "code",
      }),
    );
    assert.equal(screen.queryByText("Show more"), null);
    assert.equal(screen.queryByText("Show less"), null);
  });

  it("You card hides attached @file dump", () => {
    const run = answeredRun("ok");
    run.acceptedPrompt =
      "@AGENTS.md Quote the first heading.\n\n[Attached file contents for @mentions]\n\n--- File: AGENTS.md ---\n# Spire OS\n--- End: AGENTS.md ---";
    render(
      createElement(RunSurface, {
        run,
        productMode: "code",
      }),
    );
    const body = document.querySelector(".run-prompt-body")?.textContent ?? "";
    assert.equal(body, "@AGENTS.md Quote the first heading.");
    assert.equal(body.includes("Attached file contents"), false);
    assert.equal(body.includes("Spire OS"), false);
    const mention = document.querySelector(".run-prompt-mention");
    assert.equal(mention?.textContent, "@AGENTS.md");
  });

  it("keeps Grok Code and model/policy inside the You card", () => {
    const run = answeredRun("ok");
    (run as { codeAgentProvenance: { identity: string; fallbackReason: null } }).codeAgentProvenance =
      { identity: "vendor", fallbackReason: null };
    run.model = { appliedModel: "grok-4.6" };
    run.policy = { effectiveMode: "review" };
    render(
      createElement(RunSurface, {
        run,
        productMode: "code",
      }),
    );
    const card = document.querySelector(".run-prompt");
    assert.ok(card);
    const chip = card!.querySelector("[data-code-run-provenance='vendor']");
    assert.ok(chip);
    assert.ok(chip!.classList.contains("is-quiet"));
    assert.match(card!.textContent ?? "", /Model: grok-4\.6/);
    assert.match(card!.textContent ?? "", /Policy: review/);
    assert.equal(card!.querySelector(".run-provenance")?.parentElement, card);
    assert.match(
      card!.querySelector(".run-provenance")?.getAttribute("aria-label") ?? "",
      /Grok Code · Model: grok-4\.6 · Policy: review/,
    );
  });

  it("Show more overflow latches so a later tighter measure cannot drop it", () => {
    assert.equal(promptBodyMeasuresOverflow({ scrollHeight: 40, clientHeight: 20, text: "short" }), true);
    assert.equal(promptBodyMeasuresOverflow({ scrollHeight: 20, clientHeight: 20, text: "short" }), false);
    // Live desktop-atfile: 2-line @file You (~134 chars) still offered Show more.
    assert.equal(
      promptBodyMeasuresOverflow({
        scrollHeight: 36,
        clientHeight: 36,
        text: "@docs/dogfood/ACP-A3.md Quote the only line in that file and stop. Do not edit files. Do not dump the attached contents in your reply.",
      }),
      false,
    );
    assert.equal(nextPromptOverflow(false, true, false), true);
    assert.equal(nextPromptOverflow(true, false, false), true);
    assert.equal(nextPromptOverflow(true, false, true), false);
    assert.equal(nextPromptOverflow(false, false, true), false);
    // WebView2: Show more appearing tightens scrollHeight so the raw measure
    // flips false. Unlatched `measured` oscillates and hits max-update-depth
    // (desktop-run1-J4.json). The latch must converge inside 50 nested updates.
    let overflows = false;
    for (let i = 0; i < 60; i++) {
      const measured = overflows ? false : true;
      overflows = nextPromptOverflow(overflows, measured, false);
    }
    assert.equal(overflows, true);
  });

  it("Show more overflow latch stops a measure/setState loop when Show more changes height", () => {
    // WebView2 ResizeObserver fires again when Show more appears and the
    // clamp's scrollHeight drops. Without the latch, that true/false
    // oscillation nested-updates until "Maximum update depth exceeded".
    const PrevRO = window.ResizeObserver;
    type Obs = { cb: ResizeObserverCallback; el: Element | null };
    const observers: Obs[] = [];
    window.ResizeObserver = class {
      cb: ResizeObserverCallback;
      el: Element | null = null;
      constructor(cb: ResizeObserverCallback) {
        this.cb = cb;
        observers.push(this);
      }
      observe(el: Element) {
        this.el = el;
        this.cb([{ target: el } as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      unobserve() {}
      disconnect() {
        this.el = null;
      }
    } as unknown as typeof ResizeObserver;
    const proto = window.HTMLElement.prototype;
    const prevScroll = Object.getOwnPropertyDescriptor(proto, "scrollHeight");
    const prevClient = Object.getOwnPropertyDescriptor(proto, "clientHeight");
    Object.defineProperty(proto, "scrollHeight", {
      configurable: true,
      get() {
        if ((this as HTMLElement).classList?.contains("run-prompt-body")) {
          const more = (this as HTMLElement).closest(".run-prompt")?.querySelector(".run-prompt-more");
          return more ? 36 : 80;
        }
        return 0;
      },
    });
    Object.defineProperty(proto, "clientHeight", {
      configurable: true,
      get() {
        return (this as HTMLElement).classList?.contains("run-prompt-body") ? 36 : 0;
      },
    });
    const mo = new MutationObserver(() => {
      for (const o of observers) {
        if (o.el) o.cb([{ target: o.el } as ResizeObserverEntry], o as unknown as ResizeObserver);
      }
    });
    mo.observe(document.body, { subtree: true, childList: true, attributes: true });
    const errors: string[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
      origError.apply(console, args);
    };
    try {
      const run = answeredRun("ok");
      run.acceptedPrompt = "Short line that still overflows via mock heights.";
      assert.doesNotThrow(() => {
        render(
          createElement(RunSurface, {
            run,
            productMode: "code",
          }),
        );
      });
      assert.equal(
        errors.some((line) => line.includes("Maximum update depth exceeded")),
        false,
        errors.filter((line) => line.includes("Maximum update depth")).join("\n"),
      );
      assert.ok(document.querySelector(".run-prompt-more"));
    } finally {
      console.error = origError;
      mo.disconnect();
      window.ResizeObserver = PrevRO;
      if (prevScroll) Object.defineProperty(proto, "scrollHeight", prevScroll);
      else delete (proto as unknown as Record<string, unknown>).scrollHeight;
      if (prevClient) Object.defineProperty(proto, "clientHeight", prevClient);
      else delete (proto as unknown as Record<string, unknown>).clientHeight;
    }
  });

  it("Thought does not force-open on live reasoning identity changes", () => {
    assert.equal(nextThoughtOpen(false, { runState: "running", toggleTo: true }), true);
    assert.equal(nextThoughtOpen(true, { runState: "running" }), true);
    assert.equal(nextThoughtOpen(false, { runState: "running" }), false);
    assert.equal(nextThoughtOpen(true, { runState: "terminal" }), false);
    assert.equal(nextThoughtOpen(false, { runState: "terminal", toggleTo: true }), true);
    const live = answeredRun("later");
    (live as { state: string }).state = "running";
    (live as { terminalKind: string | null }).terminalKind = null;
    (live as { answerVouched: boolean }).answerVouched = false;
    (live as { finalAnswer?: string }).finalAnswer = undefined;
    live.reasoning = { r: "planning how to typecheck apps/shell" };
    live.acceptedPrompt =
      "Stay in plan mode. Propose how you would typecheck apps/shell with tsc --noEmit as three numbered steps (1. 2. 3.).";
    const view = render(
      createElement(RunSurface, {
        run: live,
        productMode: "code",
      }),
    );
    const thought = () => document.querySelector(".run-thought") as HTMLDetailsElement | null;
    assert.equal(thought()!.open, true);
    fireEvent.click(screen.getByText("Thought…"));
    assert.equal(thought()!.open, false);
    view.rerender(
      createElement(RunSurface, {
        run: { ...live, reasoning: { r: "planning more steps" } },
        productMode: "code",
      }),
    );
    assert.equal(thought()!.open, false);
    view.rerender(
      createElement(RunSurface, {
        run: {
          ...live,
          state: "terminal",
          terminalKind: "answered",
          answerVouched: true,
          finalAnswer: "apps/shell typechecks cleanly.",
          reasoning: { r: "planning more steps" },
        },
        productMode: "code",
      }),
    );
    assert.equal(thought()!.open, false);
    fireEvent.click(screen.getByText("Thought"));
    assert.equal(thought()!.open, true);
  });

  it("stick-below tracks You height instead of a 2-line-only 88px gap", () => {
    assert.equal(runPromptStickBelowPx(58), 70);
    assert.equal(runPromptStickBelowPx(76), 88);
    assert.equal(runPromptStickBelowPx(0), 88);
    assert.equal(runFileStickBelowPx(81, 0), 93);
    assert.equal(runFileStickBelowPx(81, 26), 131);
    const closed = document.createElement("details");
    closed.className = "run-thought";
    closed.open = false;
    closed.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 225,
        width: 82,
        height: 26,
        top: 225,
        right: 82,
        bottom: 251,
        left: 0,
        toJSON() {
          return this;
        },
      }) as DOMRect;
    const opened = document.createElement("details");
    opened.open = true;
    opened.getBoundingClientRect = closed.getBoundingClientRect;
    assert.equal(collapsedThoughtHeightPx(null), 0);
    assert.equal(collapsedThoughtHeightPx(opened), 0);
    assert.equal(collapsedThoughtHeightPx(closed), 26);
    render(
      createElement(RunSurface, {
        run: answeredRun("ok"),
        productMode: "code",
      }),
    );
    const root = document.querySelector(".run-content") as HTMLElement | null;
    assert.ok(root);
    assert.match(root!.style.getPropertyValue("--run-prompt-stick-below"), /^\d+px$/);
  });
});

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
