const KEY = "grokforge.prefs.v1";

export type Density = "comfortable" | "compact";
/** Dark product theme is Aeon Continuum; legacy "voidglass" migrates to "aeon". */
export type ThemeMode = "aeon" | "light" | "voidglass";
export type MotionMode = "full" | "calm";
export type ProductModePref = "chat" | "code";
export type EffortPref = "auto" | "fast" | "expert" | "heavy";

export interface Prefs {
  density: Density;
  theme: ThemeMode;
  motion: MotionMode;
  lastMode: ProductModePref;
  effort: EffortPref;
  /** True after user has used Code mode at least once */
  usedCode: boolean;
  /** Chat sidebar: show optional local-files strip */
  showChatFiles: boolean;
  /** Code sidebar: show nested subagent rows when present */
  showSubagents: boolean;
}

const defaults: Prefs = {
  density: "comfortable",
  theme: "aeon",
  motion: "full",
  lastMode: "chat",
  effort: "auto",
  usedCode: false,
  showChatFiles: true,
  showSubagents: true,
};

function normalize(p: Prefs): Prefs {
  // Migrate pre-Aeon dark theme id
  if (p.theme === "voidglass" || (p.theme as string) === "dark") {
    p = { ...p, theme: "aeon" };
  }
  if (p.motion !== "calm" && p.motion !== "full") {
    p = { ...p, motion: "full" };
  }
  return p;
}

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...defaults };
    return normalize({ ...defaults, ...JSON.parse(raw) });
  } catch {
    return { ...defaults };
  }
}

export function savePrefs(p: Prefs): void {
  localStorage.setItem(KEY, JSON.stringify(normalize(p)));
}

export function patchPrefs(patch: Partial<Prefs>): Prefs {
  const next = normalize({ ...loadPrefs(), ...patch });
  savePrefs(next);
  applyPrefsToDom(next);
  return next;
}

export function applyPrefsToDom(p: Prefs = loadPrefs()): void {
  const root = document.documentElement;
  const theme = p.theme === "voidglass" ? "aeon" : p.theme;
  root.dataset.theme = theme;
  root.dataset.density = p.density;
  root.dataset.motion = p.motion;
  root.style.colorScheme = theme === "light" ? "light" : "dark";
}

export function themeLabel(theme: ThemeMode): string {
  if (theme === "light") return "Light";
  return "Aeon";
}
