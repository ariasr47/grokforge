import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractPdfText, PDF_SOURCE_MAX_BYTES } from "./extract.js";
import {
  fixtureTextLayerPdf,
  fixtureEmptyExtractPdf,
  fixtureEncryptedPdf,
  fixtureCorruptPdf,
  fixtureOversizedBytes,
} from "./fixtures.js";

describe("extractPdfText", () => {
  it("extracts non-empty text-layer glyphs", async () => {
    const out = await extractPdfText(await fixtureTextLayerPdf());
    assert.equal(out.kind, "extracted");
    if (out.kind === "extracted") {
      assert.match(out.text, /Hello PDF/);
      assert.notEqual(out.text.trim(), "");
    }
  });

  it("password-required → encrypted (not empty-extract)", async () => {
    const out = await extractPdfText(await fixtureEncryptedPdf());
    assert.deepEqual(out, { kind: "extract_failed", class: "encrypted" });
  });

  it("empty-user-password that decrypts without prompt is not encrypted", async () => {
    const out = await extractPdfText(await fixtureTextLayerPdf());
    assert.equal(
      out.kind === "extract_failed" && out.class === "encrypted",
      false,
    );
  });

  it("whitespace-only / zero glyphs → empty-extract (scanned product name)", async () => {
    const out = await extractPdfText(await fixtureEmptyExtractPdf());
    assert.deepEqual(out, { kind: "extract_failed", class: "empty-extract" });
  });

  it("a single non-whitespace glyph is success", async () => {
    const out = await extractPdfText(await fixtureTextLayerPdf("."));
    assert.equal(out.kind, "extracted");
  });

  it("corrupt / missing header → unreadable", async () => {
    const out = await extractPdfText(fixtureCorruptPdf());
    assert.deepEqual(out, { kind: "extract_failed", class: "unreadable" });
  });

  it("source > 20 MiB → unreadable before parse", async () => {
    const bytes = fixtureOversizedBytes();
    const out = await extractPdfText(bytes);
    assert.deepEqual(out, { kind: "extract_failed", class: "unreadable" });
    assert.ok(bytes.length > PDF_SOURCE_MAX_BYTES);
  });
});
