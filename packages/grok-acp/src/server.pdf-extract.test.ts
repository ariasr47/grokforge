import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GrokAcpServer, type Session } from "./server.js";
import { bindExecutionCapability } from "./executionCapability.js";
import {
  fixtureTextLayerPdf,
  fixtureEncryptedPdf,
} from "@grokforge/pdf-extract/fixtures";

const profile = {
  status: "available" as const,
  platform: "win32",
  osFamily: "windows" as const,
  executable: process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe",
  argvPrefix: ["/d", "/s", "/c"] as const,
  displayName: "Command Prompt (cmd.exe)",
  dialect: "cmd" as const,
  pathSeparator: "\\" as const,
  syntax: { quoting: "", chaining: "", redirection: "" },
};
function call(name: string, args: Record<string, unknown>, id = name): any {
  return { id, type: "function", function: { name, arguments: JSON.stringify(args) } };
}
function harness(root: string) {
  const server = new GrokAcpServer();
  (server as any).workspaceRoot = root;
  const events: any[] = [];
  (server as any).notify = (type: string, params: any) => events.push({ type, params });
  (server as any).waitPermission = async () => "deny";
  (server as any).waitEdit = async () => "reject";
  const session: Session = {
    id: "s",
    messages: [],
    pendingEdits: new Map(),
    sessionWrite: false,
    sessionShell: false,
    capability: bindExecutionCapability(profile, root, {}),
  };
  return { server, session, events };
}

describe("PDF read_file tool_run envelope", () => {
  it("extract-failed → executed/failed + umbrella error + JSON body", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pdf-env-"));
    await fs.writeFile(path.join(root, "enc.pdf"), await fixtureEncryptedPdf());
    const h = harness(root);
    try {
      const out = await h.server.executeTool(
        h.session,
        call("read_file", { path: "enc.pdf" }, "pdf-enc"),
      );
      const body = JSON.parse(out);
      assert.equal(body.extract_failed, true);
      assert.equal(body.extract_failure_class, "encrypted");
      const terminal = h.events.find(
        (e) =>
          e.type === "tool_run" &&
          e.params.lifecycle === "terminal" &&
          e.params.toolCallId === "pdf-enc",
      );
      assert.equal(terminal.params.execution, "executed");
      assert.equal(terminal.params.status, "failed");
      assert.equal(terminal.params.error, "Couldn't extract text from enc.pdf.");
      assert.equal(terminal.params.output, out);
      assert.equal(terminal.params.reasonCode, null);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("extract success → executed/succeeded", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pdf-ok-"));
    await fs.writeFile(path.join(root, "ok.pdf"), await fixtureTextLayerPdf());
    const h = harness(root);
    try {
      const out = await h.server.executeTool(
        h.session,
        call("read_file", { path: "ok.pdf" }, "pdf-ok"),
      );
      const terminal = h.events.find(
        (e) =>
          e.type === "tool_run" &&
          e.params.lifecycle === "terminal" &&
          e.params.toolCallId === "pdf-ok",
      );
      assert.equal(terminal.params.execution, "executed");
      assert.equal(terminal.params.status, "succeeded");
      assert.equal(terminal.params.error, null);
      assert.match(out, /Hello PDF/);
      assert.doesNotMatch(out, /"binary"\s*:\s*true/);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("missing PDF path ≠ extract_failed", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pdf-miss-"));
    const h = harness(root);
    try {
      const out = await h.server.executeTool(
        h.session,
        call("read_file", { path: "nope.pdf" }, "pdf-miss"),
      );
      assert.equal(JSON.parse(out).extract_failed, undefined);
      const terminal = h.events.find(
        (e) =>
          e.type === "tool_run" &&
          e.params.toolCallId === "pdf-miss" &&
          e.params.lifecycle === "terminal",
      );
      assert.ok(terminal);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("outside-bind PDF refuse before extract", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pdf-out-root-"));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "pdf-out-"));
    await fs.writeFile(path.join(outside, "secret.pdf"), await fixtureTextLayerPdf());
    const h = harness(root);
    try {
      const out = await h.server.executeTool(
        h.session,
        call("read_file", { path: path.join(outside, "secret.pdf") }, "pdf-out"),
      );
      assert.match(out, /outside_workspace/);
      assert.doesNotMatch(out, /extract_failed/);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(outside, { recursive: true, force: true });
    }
  });
});
