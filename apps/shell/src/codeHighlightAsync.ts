type Highlighter = {
  codeToHtml: (code: string, opts: { lang: string; theme: string }) => string;
  getLoadedLanguages: () => string[];
};

let highlighterPromise: Promise<Highlighter | null> | null = null;

const LANGS = [
  "typescript",
  "javascript",
  "tsx",
  "jsx",
  "json",
  "rust",
  "python",
  "bash",
  "shell",
  "css",
  "html",
  "markdown",
  "toml",
  "yaml",
];

function loadHighlighter(): Promise<Highlighter | null> {
  if (!highlighterPromise) {
    highlighterPromise = import("shiki")
      .then((shiki) =>
        shiki.createHighlighter({
          themes: ["github-dark"],
          langs: LANGS,
        }),
      )
      .catch(() => null);
  }
  return highlighterPromise;
}

export async function highlightToHtml(
  code: string,
  lang?: string,
): Promise<string | null> {
  const highlighter = await loadHighlighter();
  if (!highlighter) return null;
  const requested = (lang || "text").toLowerCase();
  const loaded = highlighter.getLoadedLanguages();
  const useLang = loaded.includes(requested) ? requested : "text";
  try {
    return highlighter.codeToHtml(code, {
      lang: useLang,
      theme: "github-dark",
    });
  } catch {
    return null;
  }
}
