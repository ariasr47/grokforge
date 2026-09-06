import { isTauri } from "./api";

export type UpdateStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "none" }
  | { kind: "available"; version: string }
  | { kind: "error"; message: string };

export async function checkForAppUpdate(): Promise<UpdateStatus> {
  if (!isTauri()) return { kind: "none" };
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) return { kind: "none" };
    return { kind: "available", version: update.version };
  } catch (e) {
    return {
      kind: "error",
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function installAppUpdate(): Promise<UpdateStatus> {
  if (!isTauri()) return { kind: "none" };
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const { relaunch } = await import("@tauri-apps/plugin-process");
    const update = await check();
    if (!update) return { kind: "none" };
    await update.downloadAndInstall();
    await relaunch();
    return { kind: "available", version: update.version };
  } catch (e) {
    return {
      kind: "error",
      message: e instanceof Error ? e.message : String(e),
    };
  }
}
