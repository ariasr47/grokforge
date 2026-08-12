/**
 * Read local files for Chat/Code composer attach (browser File API).
 * Text + common office-adjacent formats; PDF gets an honest fallback message.
 */

const MAX_CHARS = 80_000;
const MAX_FILES = 8;

export type AttachResult =
  | { ok: true; name: string; text: string; truncated: boolean }
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

export function formatAttachBlock(r: Extract<AttachResult, { ok: true }>): string {
  const note = r.truncated ? "\n…[truncated for message size]" : "";
  return `\n\n--- Attached: ${r.name} ---\n${r.text}${note}\n--- End: ${r.name} ---\n`;
}

export async function readFileForAttach(file: File): Promise<AttachResult> {
  const name = file.name || "file";
  const ext = extOf(name);

  if (ext === "pdf") {
    return {
      ok: false,
      name,
      error:
        "PDF binary not extracted in the UI yet. Export to .txt/.md or copy-paste text from the PDF.",
    };
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
    let truncated = false;
    if (text.length > MAX_CHARS) {
      text = text.slice(0, MAX_CHARS);
      truncated = true;
    }
    return { ok: true, name, text, truncated };
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
): Promise<{ blocks: string[]; errors: string[] }> {
  const list = Array.from(files).slice(0, MAX_FILES);
  const blocks: string[] = [];
  const errors: string[] = [];
  for (const f of list) {
    const r = await readFileForAttach(f);
    if (r.ok) blocks.push(formatAttachBlock(r));
    else errors.push(`${r.name}: ${r.error}`);
  }
  return { blocks, errors };
}
