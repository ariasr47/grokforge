const KEY = "grokforge.prefs.v1";

export type Density = "comfortable" | "compact";
/** Voidglass is the locked dark default; Aeon remains an explicit optional theme. */
export type ThemeMode = "aeon" | "light" | "voidglass";
export type MotionMode = "full" | "calm";
/** Background field: a still aurora wash by default, or the animated starfield opt-in. */
export type FieldMode = "aurora" | "stars";
export type ProductModePref = "chat" | "code";
export type EffortPref = "auto" | "fast" | "expert" | "heavy";

export interface Prefs {
  density: Density;
  theme: ThemeMode;
  motion: MotionMode;
  field: FieldMode;
  lastMode: ProductModePref;
  effort: EffortPref;
  /** True after user has used Code mode at least once */
  usedCode: boolean;
}

const defaults: Prefs = {
  density: "comfortable",
  theme: "voidglass",
  motion: "full",
  field: "aurora",
  lastMode: "chat",
  effort: "auto",
  usedCode: false,
};

function normalize(p: Prefs): Prefs {
  if ((p.theme as string) === "dark") {
    p = { ...p, theme: "voidglass" };
  }
  if (p.motion !== "calm" && p.motion !== "full") {
    p = { ...p, motion: "full" };
  }
  if (p.field !== "aurora" && p.field !== "stars") {
    p = { ...p, field: "aurora" };
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
  const theme = p.theme;
  root.dataset.theme = theme;
  root.dataset.density = p.density;
  root.dataset.motion = p.motion;
  root.dataset.field = p.field;
  root.style.colorScheme = theme === "light" ? "light" : "dark";
}

export function themeLabel(theme: ThemeMode): string {
  if (theme === "light") return "Light";
  return theme === "aeon" ? "Aeon" : "Voidglass";
}
