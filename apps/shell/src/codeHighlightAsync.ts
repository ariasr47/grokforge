import { classifyFence, LOADED_LANGS } from "./codeHighlight";
import type { ThemeMode } from "./prefs";

type Highlighter = {
  codeToHtml: (
    code: string,
    opts: { lang: string; theme: string },
  ) => string | Promise<string>;
  getLoadedLanguages: () => string[];
};

type Loader = () => Promise<Highlighter | null>;

let highlighterPromise: Promise<Highlighter | null> | null = null;
let loaderOverride: Loader | null = null;

const LANGS = [...LOADED_LANGS, "plaintext"] as string[];

export function appearanceToShikiTheme(
  appearanceKey: ThemeMode | string,
): "github-light" | "github-dark" {
  return appearanceKey === "light" ? "github-light" : "github-dark";
}

function defaultLoader(): Promise<Highlighter | null> {
  return import("shiki")
    .then((shiki) =>
      shiki.createHighlighter({
        themes: ["github-dark", "github-light"],
        langs: LANGS,
      }),
    )
    .catch(() => null);
}

function loadHighlighter(): Promise<Highlighter | null> {
  if (!highlighterPromise) {
    highlighterPromise = (loaderOverride ?? defaultLoader)();
  }
  return highlighterPromise;
}

/** Test seam: inject delayed/failed loader; pass null to clear. */
export function __setHighlighterLoaderForTests(loader: Loader | null): void {
  loaderOverride = loader;
}

export function __resetHighlighterForTests(): void {
  highlighterPromise = null;
}

export async function highlightToHtml(
  code: string,
  langInfo: string | undefined,
  appearanceKey: ThemeMode | string,
): Promise<string | null> {
  const gate = classifyFence(code, langInfo);
  if (!gate.gatePassed || !gate.resolvedLang) return null;

  try {
    const highlighter = await loadHighlighter();
    if (!highlighter) return null;

    const theme = appearanceToShikiTheme(appearanceKey);
    const useLang = gate.resolvedLang;
    return await highlighter.codeToHtml(code, { lang: useLang, theme });
  } catch {
    return null;
  }
}
