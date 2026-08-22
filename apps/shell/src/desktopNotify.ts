import { isTauri } from "./api";

export async function notifyDesktop(
  title: string,
  body: string,
): Promise<void> {
  if (!isTauri()) return;
  try {
    const { isPermissionGranted, requestPermission, sendNotification } =
      await import("@tauri-apps/plugin-notification");
    let granted = await isPermissionGranted();
    if (!granted) {
      const perm = await requestPermission();
      granted = perm === "granted";
    }
    if (!granted) return;
    sendNotification({ title, body });
  } catch {
    /* notifications are best-effort */
  }
}

export async function registerSummonShortcut(): Promise<void> {
  if (!isTauri()) return;
  try {
    const { register, isRegistered } = await import(
      "@tauri-apps/plugin-global-shortcut"
    );
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const accel = "CommandOrControl+Alt+F";
    if (await isRegistered(accel)) return;
    await register(accel, async () => {
      const win = getCurrentWindow();
      await win.unminimize();
      await win.setFocus();
    });
  } catch {
    /* shortcut is best-effort */
  }
}
