import test from "node:test";
import assert from "node:assert/strict";
import { mergeState, type PublicState } from "./api";
import { projectProjectInstructionsComposer } from "./projectInstructionsComposer";

test("missing projectInstructions → loading when connected (never invent path)", () => {
  assert.equal(
    projectProjectInstructionsComposer({
      mode: "code",
      workspace: "C:/w",
      connected: true,
      projectInstructions: undefined,
    }).state,
    "loading",
  );
});

test("no workspace → disabled_no_workspace — not empty copy", () => {
  assert.equal(
    projectProjectInstructionsComposer({
      mode: "code",
      workspace: null,
      connected: true,
      projectInstructions: { status: "absent", path: null, vouched: true },
    }).state,
    "disabled_no_workspace",
  );
});

test("closed precedence: offline unvouched before empty", () => {
  assert.equal(
    projectProjectInstructionsComposer({
      mode: "code",
      workspace: "C:/w",
      connected: false,
      projectInstructions: { status: "absent", path: null, vouched: false },
    }).state,
    "offline",
  );
});

test("vouched present → loaded path; failed → error; absent → empty", () => {
  assert.equal(
    projectProjectInstructionsComposer({
      mode: "code", workspace: "C:/w", connected: true,
      projectInstructions: { status: "present", path: "AGENTS.md", vouched: true },
    }).state,
    "loaded",
  );
  assert.equal(
    projectProjectInstructionsComposer({
      mode: "code", workspace: "C:/w", connected: true,
      projectInstructions: { status: "failed", path: "AGENTS.md", vouched: true },
    }).state,
    "error",
  );
  assert.equal(
    projectProjectInstructionsComposer({
      mode: "code", workspace: "C:/w", connected: true,
      projectInstructions: { status: "absent", path: null, vouched: true },
    }).state,
    "empty",
  );
});

test("Chat → absent_chat", () => {
  assert.equal(
    projectProjectInstructionsComposer({
      mode: "chat", workspace: "C:/w", connected: true,
      projectInstructions: { status: "absent", path: null, vouched: true },
    }).state,
    "absent_chat",
  );
});

test("mergeState does not invent projectInstructions when omitted", () => {
  const held = {
    projectInstructions: { status: "present", path: "AGENTS.md", vouched: true },
  } as PublicState;
  const incoming = { connected: true } as PublicState;
  assert.deepEqual(mergeState(held, incoming).projectInstructions, held.projectInstructions);
});

test("loaded path is the vouched probe name; Agents.md is never the painted path", () => {
  const loaded = projectProjectInstructionsComposer({
    mode: "code",
    workspace: "C:/w",
    connected: true,
    projectInstructions: { status: "present", path: "AGENTS.md", vouched: true },
  });
  assert.equal(loaded.state, "loaded");
  if (loaded.state === "loaded") assert.equal(loaded.path, "AGENTS.md");

  const alias = projectProjectInstructionsComposer({
    mode: "code",
    workspace: "C:/w",
    connected: true,
    projectInstructions: { status: "present", path: "Agents.md", vouched: true },
  });
  assert.notEqual(alias.state, "loaded");
  assert.equal("path" in alias && (alias as { path?: string }).path, false);
});

test("no-workspace wins over vouched empty — never No project instructions", () => {
  assert.equal(
    projectProjectInstructionsComposer({
      mode: "code",
      workspace: "",
      connected: false,
      projectInstructions: { status: "absent", path: null, vouched: true },
    }).state,
    "disabled_no_workspace",
  );
});

test("unvouched connected is loading even when status is present (do not invent path)", () => {
  const projection = projectProjectInstructionsComposer({
    mode: "code",
    workspace: "C:/w",
    connected: true,
    projectInstructions: { status: "present", path: "AGENTS.md", vouched: false },
  });
  assert.equal(projection.state, "loading");
  assert.equal("path" in projection, false);
});
