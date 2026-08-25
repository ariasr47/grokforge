import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  CHAT_PACK_FILE_CAP,
  CHAT_PACK_NOTE_CAP,
  CHAT_PACK_FILE_CONTENTS_CAP,
  codeChatPackView,
  emptyChatPackView,
  validatePinnedTextFile,
  noteLengthOk,
  buildChatPackPromptSection,
  sumFileContentsLength,
} from "./chat-pack.js";

test("caps are product-named", () => {
  assert.equal(CHAT_PACK_FILE_CAP, 5);
  assert.equal(CHAT_PACK_NOTE_CAP, 4000);
  assert.equal(CHAT_PACK_FILE_CONTENTS_CAP, 80_000);
});

test("codeChatPackView is empty vouched null conversation", () => {
  assert.deepEqual(codeChatPackView(), {
    conversationId: null,
    vouched: true,
    confirmFailed: false,
    members: { files: [], note: null },
    lastAttempt: "ok",
  });
});

test("emptyChatPackView is unconfirmed empty members", () => {
  assert.deepEqual(emptyChatPackView("home-a"), {
    conversationId: "home-a",
    vouched: false,
    confirmFailed: false,
    members: { files: [], note: null },
    lastAttempt: "ok",
  });
});

test("noteLengthOk refuses >4000 UTF-16 units", () => {
  assert.equal(noteLengthOk("a".repeat(4000)), true);
  assert.equal(noteLengthOk("a".repeat(4001)), false);
  assert.equal(noteLengthOk(""), true); // empty clears; length ok
});

test("validatePinnedTextFile still refuses PDF-shaped binary (pack-pin not extract success)", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cp-pdf-"));
  try {
    const bytes = Buffer.concat([
      Buffer.from("%PDF-1.4\n"),
      Buffer.from([0]),
      Buffer.from("\n%%EOF\n"),
    ]);
    await fs.writeFile(path.join(root, "doc.pdf"), bytes);
    const result = await validatePinnedTextFile(root, "doc.pdf");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "binary");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("validatePinnedTextFile accepts in-root UTF-8 text and refuses binary/dir/outside", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cp-pin-"));
  try {
    await fs.writeFile(path.join(root, "ok.txt"), "hello", "utf8");
    await fs.mkdir(path.join(root, "dir"));
    await fs.writeFile(path.join(root, "bin.bin"), Buffer.from([0, 1, 2]));
    const ok = await validatePinnedTextFile(root, "ok.txt");
    assert.equal(ok.ok, true);
    if (ok.ok) assert.equal(ok.relativePath, "ok.txt");
    assert.equal((await validatePinnedTextFile(root, "dir")).ok, false);
    assert.equal((await validatePinnedTextFile(root, "bin.bin")).ok, false);
    assert.equal((await validatePinnedTextFile(root, "../escape.txt")).ok, false);
    assert.equal((await validatePinnedTextFile(root, "..\\escape.txt")).ok, false);
    assert.equal((await validatePinnedTextFile(root, "missing.txt")).ok, false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("buildChatPackPromptSection order note then files; escapes backticks", () => {
  const section = buildChatPackPromptSection({
    note: "n1",
    files: [{ path: "a`b.md", body: "BODY" }],
  });
  assert.equal(section.startsWith("\n\n## Chat pack\n\n"), true);
  assert.match(section, /### Note\n\nn1\n\n/);
  assert.match(section, /### File: `a\\`b\.md`\n\nBODY\n\n/);
  assert.ok(section.indexOf("### Note") < section.indexOf("### File:"));
});

test("sumFileContentsLength uses UTF-16 length", () => {
  assert.equal(sumFileContentsLength(["a".repeat(3), "b".repeat(2)]), 5);
});
