import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { executeReadTool, capReadFileEmittedText } from "./tools.js";
import {
  fixtureTextLayerPdf,
  fixtureEncryptedPdf,
  fixtureEmptyExtractPdf,
  fixtureCorruptPdf,
} from "@grokforge/pdf-extract/fixtures";

async function withRoot(pdfName: string, bytes: Uint8Array) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pdf-read-"));
  await fs.writeFile(path.join(root, pdfName), bytes);
  return root;
}

describe("executeReadTool PDF", () => {
  it("text-layer PDF → success JSON, not binary:true", async () => {
    const root = await withRoot("doc.pdf", await fixtureTextLayerPdf());
    try {
      const raw = await executeReadTool(root, "read_file", { path: "doc.pdf" });
      const j = JSON.parse(raw);
      assert.equal(j.binary, undefined);
      assert.equal(typeof j.truncated, "boolean");
      assert.equal(typeof j.bytes, "number");
      assert.ok(j.content.includes("Hello PDF"));
      assert.equal(j.bytes, Buffer.byteLength(j.content, "utf8"));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("encrypted → extract_failed class encrypted", async () => {
    const root = await withRoot("enc.pdf", await fixtureEncryptedPdf());
    try {
      const j = JSON.parse(await executeReadTool(root, "read_file", { path: "enc.pdf" }));
      assert.equal(j.extract_failed, true);
      assert.equal(j.extract_failure_class, "encrypted");
      assert.equal(j.content, "");
      assert.equal(j.error, "Couldn't extract text from enc.pdf.");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("empty-extract class", async () => {
    const root = await withRoot("empty.pdf", await fixtureEmptyExtractPdf());
    try {
      const j = JSON.parse(await executeReadTool(root, "read_file", { path: "empty.pdf" }));
      assert.equal(j.extract_failure_class, "empty-extract");
      assert.equal(j.extract_failed, true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("corrupt → unreadable", async () => {
    const root = await withRoot("bad.pdf", fixtureCorruptPdf());
    try {
      const j = JSON.parse(await executeReadTool(root, "read_file", { path: "bad.pdf" }));
      assert.equal(j.extract_failure_class, "unreadable");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("source > 20 MiB → unreadable without hang", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pdf-big-"));
    const big = path.join(root, "big.pdf");
    const fh = await fs.open(big, "w");
    await fh.truncate(20_000_001);
    await fh.close();
    try {
      const j = JSON.parse(await executeReadTool(root, "read_file", { path: "big.pdf" }));
      assert.equal(j.extract_failure_class, "unreadable");
      assert.equal(j.extract_failed, true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("capReadFileEmittedText: >100_000 UTF-8 → truncated + bytes=emitted", () => {
    const long = "é".repeat(60_000); // 2 bytes each in UTF-8 → 120_000 bytes
    const capped = capReadFileEmittedText(long);
    assert.equal(capped.truncated, true);
    assert.ok(capped.bytes <= 100_000);
    assert.equal(capped.bytes, Buffer.byteLength(capped.content, "utf8"));
    assert.ok(capped.content.length < long.length);
  });

  it("non-PDF null-byte binary sniff unchanged", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pdf-bin-"));
    await fs.writeFile(path.join(root, "x.bin"), Buffer.from([0, 1, 2, 3]));
    try {
      const j = JSON.parse(await executeReadTool(root, "read_file", { path: "x.bin" }));
      assert.equal(j.binary, true);
      assert.equal(j.extract_failed, undefined);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
