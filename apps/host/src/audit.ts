/**
 * Local append-only audit log for enterprise-lean trust.
 * Path: ~/.grokforge/logs/audit.jsonl
 */
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./channel.js";
import { loadPolicy } from "./policy.js";

export type AuditEvent = {
  ts: string;
  type: string;
  detail?: Record<string, unknown>;
};

function auditPath(): string {
  return path.join(dataDir(), "logs", "audit.jsonl");
}

export function audit(type: string, detail?: Record<string, unknown>): void {
  try {
    const policy = loadPolicy();
    if (policy.audit === false) return;
    const dir = path.dirname(auditPath());
    fs.mkdirSync(dir, { recursive: true });
    const line =
      JSON.stringify({
        ts: new Date().toISOString(),
        type,
        detail: scrub(detail),
      } satisfies AuditEvent) + "\n";
    fs.appendFileSync(auditPath(), line, "utf8");
  } catch {
    /* never break host on audit */
  }
}

function scrub(
  detail?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!detail) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(detail)) {
    const key = k.toLowerCase();
    if (
      key.includes("key") ||
      key.includes("token") ||
      key.includes("secret") ||
      key.includes("password")
    ) {
      out[k] = "[redacted]";
    } else if (typeof v === "string" && v.length > 500) {
      out[k] = v.slice(0, 500) + "…";
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function auditLogPath(): string {
  return auditPath();
}
