import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./channel.js";

function logsRoot(): string {
  return path.join(dataDir(), "logs");
}
function hostLogFile(): string {
  return path.join(logsRoot(), "host.log");
}
function clientLogFilePath(): string {
  return path.join(logsRoot(), "client.log");
}

function stamp(): string {
  return new Date().toISOString();
}

function ensureDir(): void {
  fs.mkdirSync(logsRoot(), { recursive: true });
}

export function log(
  level: "info" | "warn" | "error" | "debug",
  msg: string,
  meta?: Record<string, unknown>,
): void {
  const line =
    `${stamp()} [${level.toUpperCase()}] ${msg}` +
    (meta ? ` ${JSON.stringify(meta)}` : "") +
    "\n";
  try {
    ensureDir();
    fs.appendFileSync(hostLogFile(), line, "utf8");
  } catch {
    /* ignore disk errors */
  }
  const fn =
    level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  fn(line.trimEnd());
}

export function logPath(): string {
  return hostLogFile();
}

export function logsDir(): string {
  return logsRoot();
}

/** Append a UI/client event into client.log and mirror errors into host.log. */
export function clientLog(
  level: "info" | "warn" | "error" | "debug",
  msg: string,
  meta?: Record<string, unknown>,
): void {
  const line =
    `${stamp()} [${level.toUpperCase()}] ${msg}` +
    (meta ? ` ${JSON.stringify(meta)}` : "") +
    "\n";
  try {
    ensureDir();
    fs.appendFileSync(clientLogFilePath(), line, "utf8");
  } catch {
    /* ignore */
  }
  if (level === "error" || level === "warn") {
    log(level, `client: ${msg}`, meta);
  }
}

export function readLogTail(maxBytes = 256_000): {
  host: string;
  client: string;
  hostPath: string;
  clientPath: string;
} {
  const readTail = (file: string): string => {
    try {
      if (!fs.existsSync(file)) return "";
      const st = fs.statSync(file);
      if (st.size <= maxBytes) return fs.readFileSync(file, "utf8");
      const fd = fs.openSync(file, "r");
      try {
        const buf = Buffer.alloc(maxBytes);
        fs.readSync(fd, buf, 0, maxBytes, Math.max(0, st.size - maxBytes));
        return buf.toString("utf8");
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      return "";
    }
  };
  return {
    host: readTail(hostLogFile()),
    client: readTail(clientLogFilePath()),
    hostPath: hostLogFile(),
    clientPath: clientLogFilePath(),
  };
}

export function writeDiagnosticsBundle(markdown: string): {
  path: string;
  dir: string;
} {
  ensureDir();
  const name = `diagnostics-${new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 19)}.md`;
  const out = path.join(logsRoot(), name);
  fs.writeFileSync(out, markdown, "utf8");
  return { path: out, dir: logsRoot() };
}
