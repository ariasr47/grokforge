const KEY = "grokforge.promptHistory";
const MAX = 50;

export function loadPromptHistory(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as string[];
    return Array.isArray(arr) ? arr.filter((s) => typeof s === "string") : [];
  } catch {
    return [];
  }
}

export function pushPromptHistory(text: string): string[] {
  const t = text.trim();
  if (!t) return loadPromptHistory();
  const next = [t, ...loadPromptHistory().filter((x) => x !== t)].slice(0, MAX);
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}
