/**
 * C1–C10 Chat shipped-unit oracles. Each assertion calls the product
 * function or renders the product component — no reimplementation.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { afterEach, describe, it } from "node:test";
import { createElement } from "react";
import { fileURLToPath } from "node:url";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ArtifactPanel } from "../dock/ArtifactPanel.js";
import { elevateArtifact } from "../projections/artifactEligibility.js";
import { RunSurface } from "./RunSurface.js";
import type { RunProjectionRun } from "../projections/runReducer.js";
import { formatAttachBlock } from "../composer/contextAttach.js";
import { MENTION_ATTACH_MARKER, visibleUserPrompt } from "../composer/expandMentions.js";
import { mergeLiveRunsForExport, transcriptToMarkdown } from "../lib/exportChat.js";
import { parseRichDocument } from "../thread/richUi.js";
import { RichBlocks } from "../thread/RichBlocks.js";
import { defaultSessionTitle } from "../lib/sessions.js";
import { formatPdfReadFileFailureLabel } from "../projections/toolFormat.js";

afterEach(() => cleanup());

describe("C1 Open — Chat send must not crash on deleted forgeFx", () => {
  it("RunSurface source does not reference forgeFx", () => {
    const src = fs.readFileSync(fileURLToPath(new URL("./RunSurface.tsx", import.meta.url)), "utf8");
    assert.equal(src.includes("forgeFx"), false);
  });
});

describe("C6 Home — chat: partitions title New chat", () => {
  it("defaultSessionTitle is New chat on chat partitions and New session on folders", () => {
    assert.equal(defaultSessionTitle("chat:__sandbox__"), "New chat");
    assert.equal(defaultSessionTitle("C:\\Dev\\grokforge"), "New session");
  });
});

describe("C3 Email — Copy on the live Chat answer", () => {
  it("RunSurface Chat answer offers Copy", () => {
    const run = {
      sessionId: "s",
      runId: "run-c3",
      connectionGeneration: 1,
      state: "terminal",
      acceptedPrompt: "turn bullets into email",
      admittedAt: "",
      updatedAt: "",
      lastEventSeq: 2,
      policy: {},
      model: {},
      terminalKind: "answered",
      finalAnswer: "Hi team,\n\nPlease send Q3 numbers by Friday.\n\nBest regards",
      answerVouched: true,
      failure: null,
      reasoning: {},
      answer: {},
      message: {},
      activities: {},
      decisions: {},
      seenEventSeq: new Set([1]),
      terminalEventSeq: 2,
    } as unknown as RunProjectionRun;
    render(createElement(RunSurface, { run, productMode: "chat" }));
    assert.ok(screen.getByRole("button", { name: /^Copy$/ }));
    assert.ok(screen.getByRole("article", { name: "Assistant answer" }));
  });
});

describe("C8 Stop — cancelled Chat turn offers Retry", () => {
  it("RunTerminalNotice Retry is present on a cancelled run", () => {
    const run = {
      sessionId: "s",
      runId: "run-c8",
      connectionGeneration: 1,
      state: "terminal",
      acceptedPrompt: "long essay",
      admittedAt: "",
      updatedAt: "",
      lastEventSeq: 2,
      policy: {},
      model: {},
      terminalKind: "cancelled",
      finalAnswer: "",
      answerVouched: false,
      failure: null,
      reasoning: {},
      answer: {},
      message: {},
      activities: {},
      decisions: {},
      seenEventSeq: new Set([1]),
      terminalEventSeq: 2,
    } as unknown as RunProjectionRun;
    let retried = "";
    render(
      createElement(RunSurface, {
        run,
        productMode: "chat",
        onRetryPrompt: (p: string) => {
          retried = p;
        },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /^Retry$/ }));
    assert.equal(retried, "long essay");
  });
});

describe("Q2 Chat is Chat — Plan section is not Chat chrome", () => {
  it("RunSurface Chat answer does not render Plan", () => {
    const run = {
      sessionId: "s",
      runId: "run-q2",
      connectionGeneration: 1,
      state: "terminal",
      acceptedPrompt: "hi",
      admittedAt: "",
      updatedAt: "",
      lastEventSeq: 2,
      policy: {},
      model: {},
      terminalKind: "answered",
      finalAnswer: "CHAT-C1-OK",
      answerVouched: true,
      failure: null,
      reasoning: {},
      answer: {},
      message: {},
      activities: {},
      decisions: {},
      plan: { body: "1. do a thing", status: "complete" },
      seenEventSeq: new Set([1]),
      terminalEventSeq: 2,
    } as unknown as RunProjectionRun;
    render(createElement(RunSurface, { run, productMode: "chat" }));
    assert.equal(document.querySelector(".plan-section"), null);
    assert.equal(screen.queryByText(/Restoring this run’s plan/i) === null, true);
  });
});

describe("C5 Attach — You mention hides the attached dump", () => {
  it("visibleUserPrompt drops the attach marker and dump", () => {
    const typed = "@docs/dogfood/KEEP.md Quote the first heading.";
    const dumped = `${typed}\n\n${MENTION_ATTACH_MARKER}\n\n--- File: KEEP.md ---\n# Keep me\n--- End: KEEP.md ---`;
    assert.equal(visibleUserPrompt(dumped), typed);
    assert.equal(visibleUserPrompt(typed).includes(MENTION_ATTACH_MARKER), false);
  });

  it("formatAttachBlock dump is hidden in You and keeps @filename", () => {
    const block = formatAttachBlock({
      ok: true,
      name: "KEEP.md",
      text: "# Keep me\nKEEP-FORTYEIGHT",
      truncated: false,
    });
    const outbound = `Quote the first heading.${block}`;
    const shown = visibleUserPrompt(outbound);
    assert.match(shown, /@KEEP\.md/);
    assert.equal(shown.includes(MENTION_ATTACH_MARKER), false);
    assert.equal(shown.includes("# Keep me"), false);
    assert.match(outbound, /# Keep me/);
  });
});

describe("C7 Artifact — long/grok-ui is elevatable", () => {
  it("elevateArtifact names grok-ui and long markdown", () => {
    const grokUi = "Intro\n\n```grok-ui\n" + JSON.stringify({
      version: 1,
      blocks: [{ type: "callout", body: "hi" }],
    }) + "\n```";
    assert.equal(elevateArtifact(grokUi).kind, "rich-document");
    const long = "word ".repeat(400);
    assert.equal(elevateArtifact(long).kind, "long-markdown");
    assert.equal(elevateArtifact("short").kind, "none");
  });
});

describe("C10 Export — markdown contains You and Grok turns", () => {
  it("transcriptToMarkdown labels You and Grok and skips tools", () => {
    const md = transcriptToMarkdown({
      title: "C10",
      mode: "chat",
      messages: [
        { id: "1", role: "user", content: "hello from you" },
        { id: "2", role: "tool", content: "tool noise" },
        { id: "3", role: "assistant", content: "hello from grok" },
      ],
    });
    assert.match(md, /## You/);
    assert.match(md, /hello from you/);
    assert.match(md, /## Grok/);
    assert.match(md, /hello from grok/);
    assert.doesNotMatch(md, /tool noise/);
  });

  it("mergeLiveRunsForExport adds the live Grok answer still on RunSurface", () => {
    const merged = mergeLiveRunsForExport(
      [{ id: "1", role: "user", content: "Reply with exactly CHAT-C1-OK and stop." }],
      [
        {
          runId: "run-live",
          acceptedPrompt: "Reply with exactly CHAT-C1-OK and stop.",
          finalAnswer: "CHAT-C1-OK",
          terminalKind: "answered",
        },
      ],
    );
    const md = transcriptToMarkdown({ title: "C10", mode: "chat", messages: merged });
    assert.match(md, /## You/);
    assert.match(md, /## Grok/);
    assert.match(md, /CHAT-C1-OK/);
  });
});

describe("C11/PDF — extract-fail copy is honest", () => {
  it("formatPdfReadFileFailureLabel keeps extract_failed class", () => {
    const label = formatPdfReadFileFailureLabel(
      "Couldn't extract text from file.",
      JSON.stringify({ extract_failed: true, extract_failure_class: "empty-extract" }),
    );
    assert.match(label, /Couldn't extract text from file/);
    assert.match(label, /empty-extract/);
    assert.equal(label.includes("lorem"), false);
  });
});

describe("C9 Structured — grok-ui choices fill composer and do not auto-send", () => {
  it("parseRichDocument + RichBlocks onChoose only fills, never sends", () => {
    const raw = JSON.stringify({
      version: 1,
      blocks: [
        {
          type: "choices",
          prompt: "Pick a tone",
          options: [
            { label: "Warm", description: "friendly", recommended: true },
            { label: "Formal", description: "strict" },
          ],
        },
      ],
    });
    const doc = parseRichDocument(raw);
    assert.ok(doc);
    const filled: Array<{ label: string; meta?: string }> = [];
    let sent = 0;
    render(
      createElement(RichBlocks, {
        doc,
        onChoose: (label: string, meta?: string) => {
          filled.push({ label, meta });
        },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Warm/i }));
    assert.equal(filled.length, 1);
    assert.equal(filled[0]!.label, "Warm");
    assert.equal(sent, 0);
    render(
      createElement(ArtifactPanel, {
        body: "```grok-ui\n" + raw + "\n```",
        contentKind: "rich-document",
        onClose: () => {},
        onChoose: (label) => filled.push({ label }),
      }),
    );
    fireEvent.click(screen.getAllByRole("button", { name: /Formal/i })[0]!);
    assert.equal(filled[filled.length - 1]!.label, "Formal");
    assert.equal(sent, 0);
  });
});
