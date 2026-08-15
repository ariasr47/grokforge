import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hasPriorConversations, recordCompletedConversation, shellHistoryPath } from "./shell-history.js";

let home: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "grokforge-shells-"));
  process.env.USERPROFILE = home;
  process.env.HOME = home;
});

describe("shell-history (SPEC §2.8, INTERFACE_CONTRACT priorConversations)", () => {
  it("a fresh host reports false for every origin", () => {
    assert.equal(hasPriorConversations("http://tauri.localhost"), false);
    assert.equal(hasPriorConversations("http://localhost:5173"), false);
  });

  it("records per exact origin, and does NOT leak across shells (AC12e)", () => {
    recordCompletedConversation("http://localhost:5173");
    assert.equal(hasPriorConversations("http://localhost:5173"), true);
    assert.equal(hasPriorConversations("http://tauri.localhost"), false);
  });

  it("an absent or empty Origin is never recorded and always reads false", () => {
    recordCompletedConversation(undefined);
    recordCompletedConversation("");
    assert.equal(hasPriorConversations(undefined), false);
    assert.equal(hasPriorConversations(""), false);
    assert.equal(fs.existsSync(shellHistoryPath()), false);
  });

  it("survives a corrupt store instead of throwing", () => {
    fs.mkdirSync(path.dirname(shellHistoryPath()), { recursive: true });
    fs.writeFileSync(shellHistoryPath(), "{not json", "utf8");
    assert.equal(hasPriorConversations("http://tauri.localhost"), false);
    recordCompletedConversation("http://tauri.localhost");
    assert.equal(hasPriorConversations("http://tauri.localhost"), true);
  });

  it("lives under the host data root, not the WebView partition (AC12d property 1)", () => {
    assert.equal(shellHistoryPath().startsWith(home), true);
    assert.match(shellHistoryPath(), /shells\.json$/);
  });
});
