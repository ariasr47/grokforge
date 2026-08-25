/// <reference path="./pdfjs-worker.d.ts" />
import { getDocument, GlobalWorkerOptions, PasswordResponses } from "pdfjs-dist/legacy/build/pdf.mjs";
import * as pdfjsWorker from "pdfjs-dist/legacy/build/pdf.worker.min.mjs";

const g = globalThis as typeof globalThis & { pdfjsWorker?: unknown };
g.pdfjsWorker ??= pdfjsWorker;
GlobalWorkerOptions.workerSrc ||= "pdfjs-dist/legacy/build/pdf.worker.min.mjs";

export const PDF_SOURCE_MAX_BYTES = 20_000_000;

export type PdfExtractFailureClass = "encrypted" | "empty-extract" | "unreadable";

export type PdfExtractOutcome =
  | { kind: "extracted"; text: string }
  | { kind: "extract_failed"; class: PdfExtractFailureClass };

const PAGE_SEP = "\n\n";

function isPasswordError(err: unknown): boolean {
  const e = err as { name?: string; code?: number; message?: string };
  if (e?.name === "PasswordException") return true;
  if (e?.code === PasswordResponses.NEED_PASSWORD) return true;
  if (e?.code === PasswordResponses.INCORRECT_PASSWORD) return true;
  const msg = String(e?.message ?? err);
  return /password/i.test(msg);
}

/** Pure: bytes → outcome. No fs, UI, ACP, or HTTP. */
export async function extractPdfText(bytes: Uint8Array): Promise<PdfExtractOutcome> {
  if (bytes.length > PDF_SOURCE_MAX_BYTES) {
    return { kind: "extract_failed", class: "unreadable" };
  }
  try {
    const loadingTask = getDocument({
      data: bytes.slice(),
      password: "",
      useSystemFonts: true,
      isEvalSupported: false,
      useWorkerFetch: false,
      disableFontFace: true,
    });
    const pdf = await loadingTask.promise;
    try {
      const parts: string[] = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items
          .map((item) => ("str" in item ? String(item.str) : ""))
          .join("");
        parts.push(pageText);
      }
      const text = parts.join(PAGE_SEP);
      if (text.replace(/\s+/g, "").length === 0) {
        return { kind: "extract_failed", class: "empty-extract" };
      }
      return { kind: "extracted", text };
    } finally {
      await pdf.destroy();
    }
  } catch (err) {
    if (isPasswordError(err)) {
      return { kind: "extract_failed", class: "encrypted" };
    }
    return { kind: "extract_failed", class: "unreadable" };
  }
}
