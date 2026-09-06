/**
 * Read local files for Chat/Code composer attach (browser File API).
 * PDFs extract via the shared `@grokforge/pdf-extract` core (no host round-trip).
 * Other office binaries keep today's refuse.
 */

import {
  extractPdfText,
  PDF_SOURCE_MAX_BYTES,
  type PdfExtractFailureClass,
} from "@grokforge/pdf-extract";
import { MENTION_ATTACH_MARKER } from "./expandMentions";

const MAX_CHARS = 80_000;
const MAX_FILES = 8;

export type AttachResult =
  | { ok: true; name: string; text: string; truncated: boolean }
  | {
      ok: false;
      name: string;
      error: string;
      extractFailureClass: PdfExtractFailureClass;
    }
  | { ok: false; name: string; error: string };

const TEXT_EXT = new Set([
  "txt",
  "md",
  "markdown",
  "csv",
  "tsv",
  "json",
  "jsonl",
  "xml",
  "html",
  "htm",
  "css",
  "js",
  "ts",
  "tsx",
  "jsx",
  "py",
  "rs",
  "go",
  "java",
  "c",
  "cpp",
  "h",
  "hpp",
  "yml",
  "yaml",
  "toml",
  "ini",
  "log",
  "sql",
  "sh",
  "ps1",
  "bat",
  "cmd",
  "env",
  "gitignore",
  "docx", // often zip — may fail
]);

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

export function capAttachEmittedText(
  text: string,
  maxChars = MAX_CHARS,
): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars), truncated: true };
}

export function formatAttachBlock(r: Extract<AttachResult, { ok: true }>): string {
  const note = r.truncated ? "\n…[truncated for message size]" : "";
  return `\n@${r.name}\n\n${MENTION_ATTACH_MARKER}\n\n--- File: ${r.name} ---\n${r.text}${note}\n--- End: ${r.name} ---\n`;
}

export function formatAttachFailureToast(
  r: Extract<AttachResult, { ok: false }>,
): string {
  if ("extractFailureClass" in r && r.extractFailureClass) {
    return `${r.error} (${r.extractFailureClass}) Export to .txt/.md or paste the text.`;
  }
  return `${r.name}: ${r.error}`;
}

export async function readFileForAttach(file: File): Promise<AttachResult> {
  const name = file.name || "file";
  const ext = extOf(name);

  if (ext === "pdf") {
    const buf = new Uint8Array(await file.arrayBuffer());
    if (buf.length > PDF_SOURCE_MAX_BYTES) {
      return {
        ok: false,
        name,
        error: `Couldn't extract text from ${name}.`,
        extractFailureClass: "unreadable",
      };
    }
    const outcome = await extractPdfText(buf);
    if (outcome.kind === "extract_failed") {
      return {
        ok: false,
        name,
        error: `Couldn't extract text from ${name}.`,
        extractFailureClass: outcome.class,
      };
    }
    const capped = capAttachEmittedText(outcome.text);
    return { ok: true, name, text: capped.text, truncated: capped.truncated };
  }

  if (ext === "docx" || ext === "pptx" || ext === "xlsx") {
    return {
      ok: false,
      name,
      error: `Cannot read .${ext} here yet. Paste text or save as .txt/.md.`,
    };
  }

  // Prefer text/* and known text extensions; try utf-8 for unknown small files
  const looksText =
    file.type.startsWith("text/") ||
    file.type === "application/json" ||
    file.type === "" ||
    TEXT_EXT.has(ext);

  if (!looksText && file.size > 2_000_000) {
    return { ok: false, name, error: "File too large or not plain text." };
  }

  try {
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    // Binary sniff
    for (let i = 0; i < Math.min(bytes.length, 8000); i++) {
      if (bytes[i] === 0) {
        return {
          ok: false,
          name,
          error: "Looks like a binary file. Use a text export or paste content.",
        };
      }
    }
    let text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    // High ratio of replacement chars → not text
    const bad = (text.match(/\uFFFD/g) || []).length;
    if (bad > 50 && bad / Math.max(text.length, 1) > 0.02) {
      return {
        ok: false,
        name,
        error: "Could not decode as text. Paste content or convert to .txt.",
      };
    }
    const capped = capAttachEmittedText(text);
    return { ok: true, name, text: capped.text, truncated: capped.truncated };
  } catch (e) {
    return {
      ok: false,
      name,
      error: e instanceof Error ? e.message : "Failed to read file",
    };
  }
}

export async function readFilesForAttach(
  files: FileList | File[],
): Promise<{ blocks: string[]; toasts: string[] }> {
  const list = Array.from(files).slice(0, MAX_FILES);
  const blocks: string[] = [];
  const toasts: string[] = [];
  for (const f of list) {
    const r = await readFileForAttach(f);
    if (r.ok) blocks.push(formatAttachBlock(r));
    else toasts.push(formatAttachFailureToast(r));
  }
  return { blocks, toasts };
}
