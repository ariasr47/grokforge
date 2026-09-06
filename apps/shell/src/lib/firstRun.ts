const KEY = "grokforge.firstRun";

export interface FirstRunState {
  /** User dismissed the full onboarding card */
  dismissed: boolean;
  /** Completed steps for checklist */
  openedFolder: boolean;
  signedIn: boolean;
  sentMessage: boolean;
  /** User chose Chat or Code on first run */
  pickedMode: boolean;
  seenAt: string;
}

const defaultState = (): FirstRunState => ({
  dismissed: false,
  openedFolder: false,
  signedIn: false,
  sentMessage: false,
  pickedMode: false,
  seenAt: new Date().toISOString(),
});

export function loadFirstRun(): FirstRunState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    return { ...defaultState(), ...JSON.parse(raw) };
  } catch {
    return defaultState();
  }
}

export function saveFirstRun(state: FirstRunState): void {
  localStorage.setItem(KEY, JSON.stringify(state));
}

export function patchFirstRun(patch: Partial<FirstRunState>): FirstRunState {
  const next = { ...loadFirstRun(), ...patch };
  saveFirstRun(next);
  return next;
}

/** Chat can finish without a folder; Code still wants a workspace. */
export function isOnboardingDone(
  s: FirstRunState,
  mode: "chat" | "code" = "chat",
): boolean {
  if (s.dismissed) return true;
  if (!s.signedIn || !s.sentMessage) return false;
  if (mode === "chat") return true;
  return s.openedFolder;
}
