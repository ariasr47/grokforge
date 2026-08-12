import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dataDir } from "./channel.js";

export function defaultChatSandbox(): string {
  return path.join(dataDir(), "chat-sandbox");
}

/** Resolve and ensure Chat bound root (never bare home). */
export function ensureChatRoot(chatRoot: string | null | undefined): string {
  let target = chatRoot?.trim() || defaultChatSandbox();
  target = path.resolve(target);
  const home = path.resolve(os.homedir());
  // Disallow binding exactly to home directory as workspace root
  if (target === home) {
    target = defaultChatSandbox();
  }
  fs.mkdirSync(target, { recursive: true });
  return target;
}
