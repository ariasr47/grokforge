import { isTauri } from "./api";

const MAX = 40;
let ring: string[] = [];

function stamp(message: string): string {
  return `${new Date().toISOString()} ${message}`;
}

function push(message: string): void {
  ring = [...ring.slice(-(MAX - 1)), stamp(message)];
}

async function fileLog(
  level: "error" | "warn",
  message: string,
): Promise<void> {
  if (!isTauri()) return;
  try {
    const log = await import("@tauri-apps/plugin-log");
    if (level === "error") await log.error(message);
    else await log.warn(message);
  } catch {
    /* best-effort */
  }
}

export function recentCrashes(): string[] {
  return ring;
}

export function installCrashSink(): void {
  if (typeof window === "undefined") return;
  const w = window as Window & { __forgeCrashSink?: boolean };
  if (w.__forgeCrashSink) return;
  w.__forgeCrashSink = true;
  window.addEventListener("error", (event) => {
    const loc = event.filename ? ` @ ${event.filename}:${event.lineno}` : "";
    const message = `error: ${event.message}${loc}`;
    push(message);
    void fileLog("error", message);
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason =
      event.reason instanceof Error
        ? event.reason.stack || event.reason.message
        : String(event.reason);
    const message = `unhandledrejection: ${reason}`;
    push(message);
    void fileLog("error", message);
  });
}
