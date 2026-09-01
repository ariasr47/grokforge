/** Vendor ACP `completed` means the tool call finished, not exit 0. */
export function outputImpliesNonZeroExit(output: string | null | undefined): boolean {
  if (typeof output !== "string") return false;
  const text = output.trim();
  if (!text) return false;
  try {
    const parsed = JSON.parse(text) as { exit_code?: unknown; exitCode?: unknown };
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      if (typeof parsed.exit_code === "number") return parsed.exit_code !== 0;
      if (typeof parsed.exitCode === "number") return parsed.exitCode !== 0;
    }
  } catch {
    /* not a JSON blob */
  }
  if (/^exit:\s*(?!0\b)\d+\b/im.test(text)) return true;
  if (/\bcompleted \(exit code:\s*(?!0\b)\d+\)/i.test(text)) return true;
  if (/\bexit(?:ed)?(?:\s+with)?(?:\s+code|\s+status):?\s*(?!0\b)\d+\b/i.test(text)) return true;
  return false;
}

function numericExit(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Walk vendor tool_call / tool_call_update payloads for a non-zero process exit. */
export function vendorUpdateImpliesNonZeroExit(update: Record<string, unknown>): boolean {
  const blobs: unknown[] = [update.content, update.rawOutput, update.output];
  for (const blob of blobs) {
    if (blob == null) continue;
    if (typeof blob === "string") {
      if (outputImpliesNonZeroExit(blob)) return true;
      continue;
    }
    if (Array.isArray(blob)) {
      for (const item of blob) {
        if (typeof item === "string" && outputImpliesNonZeroExit(item)) return true;
        if (item && typeof item === "object") {
          const rec = item as { text?: unknown };
          if (typeof rec.text === "string" && outputImpliesNonZeroExit(rec.text)) return true;
        }
      }
      continue;
    }
    if (typeof blob === "object") {
      const rec = blob as {
        exit_code?: unknown;
        exitCode?: unknown;
        text?: unknown;
        content?: unknown;
      };
      const code = numericExit(rec.exit_code) ?? numericExit(rec.exitCode);
      if (code != null) return code !== 0;
      if (typeof rec.text === "string" && outputImpliesNonZeroExit(rec.text)) return true;
      if (typeof rec.content === "string" && outputImpliesNonZeroExit(rec.content)) return true;
    }
  }
  return false;
}
