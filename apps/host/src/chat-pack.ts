import fs from "node:fs/promises";
import path from "node:path";
import { resolveConfinedTarget } from "./workspace-confinement.js";

export const CHAT_PACK_FILE_CAP = 5;
export const CHAT_PACK_NOTE_CAP = 4000;
export const CHAT_PACK_FILE_CONTENTS_CAP = 80_000;

export type ChatPackLastAttempt = "ok" | "pin_failed" | "note_failed" | "hydrate_failed";

export type ChatPackView = {
  conversationId: string | null;
  vouched: boolean;
  confirmFailed: boolean;
  members: { files: Array<{ path: string }>; note: string | null };
  lastAttempt: ChatPackLastAttempt;
};

export function emptyChatPackView(conversationId: string | null = null): ChatPackView {
  return {
    conversationId,
    vouched: false,
    confirmFailed: false,
    members: { files: [], note: null },
    lastAttempt: "ok",
  };
}

export function codeChatPackView(): ChatPackView {
  return {
    conversationId: null,
    vouched: true,
    confirmFailed: false,
    members: { files: [], note: null },
    lastAttempt: "ok",
  };
}

export function noteLengthOk(note: string): boolean {
  return note.length <= CHAT_PACK_NOTE_CAP;
}

export type PinValidateResult =
  | { ok: true; relativePath: string; body: string }
  | { ok: false; reason: "outside" | "missing" | "unreadable" | "directory" | "binary" | "non_text" };

export async function validatePinnedTextFile(
  workspaceRoot: string,
  target: string,
): Promise<PinValidateResult> {
  if (typeof target !== "string" || target.includes("\0")) {
    return { ok: false, reason: "outside" };
  }
  let confined;
  try {
    confined = await resolveConfinedTarget({ workspace: workspaceRoot, target, kind: "read" });
  } catch {
    return { ok: false, reason: "outside" };
  }
  let st;
  try {
    st = await fs.stat(confined.canonicalPath);
  } catch {
    return { ok: false, reason: "missing" };
  }
  if (st.isDirectory()) return { ok: false, reason: "directory" };
  if (!st.isFile()) return { ok: false, reason: "non_text" };
  let buf: Buffer;
  try {
    buf = await fs.readFile(confined.canonicalPath);
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  const sample = buf.subarray(0, Math.min(buf.length, 8192));
  if (sample.includes(0)) return { ok: false, reason: "binary" };
  let text = buf.toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const relativePath = path.relative(path.resolve(workspaceRoot), confined.path).split(path.sep).join("/");
  return { ok: true, relativePath, body: text };
}

export function sumFileContentsLength(bodies: string[]): number {
  return bodies.reduce((n, b) => n + b.length, 0);
}

export function buildChatPackPromptSection(input: {
  note: string | null;
  files: Array<{ path: string; body: string }>;
}): string {
  let out = "\n\n## Chat pack\n\n";
  if (input.note != null) out += `### Note\n\n${input.note}\n\n`;
  for (const f of input.files) {
    const escaped = f.path.replaceAll("`", "\\`");
    out += `### File: \`${escaped}\`\n\n${f.body}\n\n`;
  }
  return out;
}

export function membersAreEmpty(members: { files: Array<{ path: string }>; note: string | null }): boolean {
  return members.files.length === 0 && members.note == null;
}

export type ChatPackMutation = {
  sessionId: string;
  conversationId: string;
} & (
  | { action: "pin_file"; path: string }
  | { action: "unpin_file"; path: string }
  | { action: "set_note"; note: string }
  | { action: "clear_note" }
  | { action: "clear_pack" }
  | {
      action: "hydrate";
      members: { files: Array<{ path: string }>; note: string | null };
    }
);

export function posixRelative(p: string): string {
  return p.split("\\").join("/");
}
