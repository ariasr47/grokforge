// Test seam for the Tauri IPC boundary (INTERFACE_CONTRACT.md "Launcher →
// shell boundary"). The conformance runner cannot reach this boundary, so
// the shell's rows drive it through a fake — the network boundary (fetch/WS)
// and this IPC boundary are the only two things the shell test harness mocks.
import { invoke } from "@tauri-apps/api/core";

export type DesktopCommand = "ensure_host" | "restart_host" | "host_status";
type Bridge = <T>(cmd: DesktopCommand) => Promise<T>;

let bridge: Bridge | null = null;

/** Test-only: install a fake bridge in place of the real Tauri `invoke`. */
export function setDesktopBridge(b: Bridge | null): void {
  bridge = b;
}

export function callDesktop<T>(cmd: DesktopCommand): Promise<T> {
  return bridge ? bridge<T>(cmd) : invoke<T>(cmd);
}
