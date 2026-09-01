import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatAttachBlock,
  formatAttachFailureToast,
  readFileForAttach,
  readFilesForAttach,
  capAttachEmittedText,
} from "./contextAttach.js";
import {
  fixtureTextLayerPdf,
  fixtureEncryptedPdf,
  fixtureEmptyExtractPdf,
  fixtureCorruptPdf,
} from "@grokforge/pdf-extract/fixtures";

function pdfFile(name: string, bytes: Uint8Array): File {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new File([copy.buffer], name, { type: "application/pdf" });
}

describe("formatAttachBlock", () => {
  it("wraps name and text", () => {
    const s = formatAttachBlock({
      ok: true,
      name: "notes.txt",
      text: "hello",
      truncated: false,
    });
    assert.match(s, /@notes\.txt/);
    assert.match(s, /File: notes\.txt/);
    assert.match(s, /hello/);
    assert.match(s, /End: notes\.txt/);
    assert.match(s, /Attached file contents/);
  });
});

describe("PDF attach", () => {
  it("text PDF → ok text + no legacy refuse string", async () => {
    const r = await readFileForAttach(pdfFile("a.pdf", await fixtureTextLayerPdf()));
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.match(r.text, /Hello PDF/);
      assert.equal(typeof r.truncated, "boolean");
      assert.doesNotMatch(r.text, /PDF binary not extracted/);
    }
  });

  it("encrypted → umbrella + required extractFailureClass", async () => {
    const r = await readFileForAttach(
      pdfFile("secret.pdf", await fixtureEncryptedPdf()),
    );
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.error, "Couldn't extract text from secret.pdf.");
      assert.ok("extractFailureClass" in r);
      if ("extractFailureClass" in r) {
        assert.equal(r.extractFailureClass, "encrypted");
      }
      assert.equal(
        formatAttachFailureToast(r),
        "Couldn't extract text from secret.pdf. (encrypted) Export to .txt/.md or paste the text.",
      );
    }
  });

  it("empty-extract class including scanned product path", async () => {
    const r = await readFileForAttach(
      pdfFile("scan.pdf", await fixtureEmptyExtractPdf()),
    );
    assert.equal(r.ok, false);
    if (!r.ok && "extractFailureClass" in r) {
      assert.equal(r.extractFailureClass, "empty-extract");
    }
  });

  it("corrupt → unreadable", async () => {
    const r = await readFileForAttach(pdfFile("bad.pdf", fixtureCorruptPdf()));
    assert.equal(r.ok, false);
    if (!r.ok && "extractFailureClass" in r) {
      assert.equal(r.extractFailureClass, "unreadable");
    }
  });

  it("source > 20 MiB → unreadable", async () => {
    const big = new Uint8Array(20_000_001);
    const r = await readFileForAttach(pdfFile("big.pdf", big));
    assert.equal(r.ok, false);
    if (!r.ok && "extractFailureClass" in r) {
      assert.equal(r.extractFailureClass, "unreadable");
    }
  });

  it("multi-file isolation: success sibling retained when one PDF fails", async () => {
    const ok = pdfFile("ok.pdf", await fixtureTextLayerPdf());
    const bad = pdfFile("bad.pdf", await fixtureEncryptedPdf());
    const { blocks, toasts } = await readFilesForAttach([ok, bad]);
    assert.equal(blocks.length, 1);
    assert.match(blocks[0]!, /@ok\.pdf/);
    assert.match(blocks[0]!, /File: ok\.pdf/);
    assert.equal(toasts.length, 1);
    assert.match(toasts[0]!, /^Couldn't extract text from bad\.pdf\./);
    assert.doesNotMatch(toasts[0]!, /^bad\.pdf:/);
  });

  it("capAttachEmittedText: >80_000 UTF-16 → truncated + draft note", () => {
    const long = "a".repeat(80_010);
    const capped = capAttachEmittedText(long);
    assert.equal(capped.truncated, true);
    assert.equal(capped.text.length, 80_000);
    const block = formatAttachBlock({
      ok: true,
      name: "long.pdf",
      text: capped.text,
      truncated: capped.truncated,
    });
    assert.match(block, /…\[truncated for message size\]/);
  });

  it("non-PDF refuse keeps name: error list formatting", async () => {
    const r = await readFileForAttach(
      new File(["x"], "slides.docx", {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    );
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal("extractFailureClass" in r, false);
      assert.equal(formatAttachFailureToast(r), `slides.docx: ${r.error}`);
    }
  });
});
