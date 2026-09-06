/**
 * Lightweight, dependency-free token highlighter for common languages.
 * Not a full highlighter — enough visual structure for chat code blocks.
 */

const KEYWORDS = new Set(
  [
    "const",
    "let",
    "var",
    "function",
    "return",
    "if",
    "else",
    "for",
    "while",
    "class",
    "import",
    "export",
    "from",
    "async",
    "await",
    "try",
    "catch",
    "throw",
    "new",
    "typeof",
    "interface",
    "type",
    "extends",
    "implements",
    "public",
    "private",
    "protected",
    "static",
    "void",
    "null",
    "undefined",
    "true",
    "false",
    "switch",
    "case",
    "break",
    "continue",
    "default",
    "package",
    "fn",
    "mut",
    "struct",
    "enum",
    "impl",
    "use",
    "pub",
    "def",
    "elif",
    "lambda",
    "with",
    "as",
    "pass",
    "yield",
    "match",
    "in",
    "of",
    "go",
    "defer",
  ].map((k) => k),
);

export type Token = { t: string; c: "kw" | "str" | "num" | "cmt" | "pun" | "plain" };

export function tokenizeLine(line: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < line.length) {
    // line comment
    if (line[i] === "/" && line[i + 1] === "/") {
      out.push({ t: line.slice(i), c: "cmt" });
      break;
    }
    if (line[i] === "#") {
      out.push({ t: line.slice(i), c: "cmt" });
      break;
    }
    // string
    if (line[i] === '"' || line[i] === "'" || line[i] === "`") {
      const q = line[i]!;
      let j = i + 1;
      while (j < line.length) {
        if (line[j] === "\\") {
          j += 2;
          continue;
        }
        if (line[j] === q) {
          j += 1;
          break;
        }
        j += 1;
      }
      out.push({ t: line.slice(i, j), c: "str" });
      i = j;
      continue;
    }
    // number
    if (/\d/.test(line[i]!) && (i === 0 || /[^\w$]/.test(line[i - 1]!))) {
      let j = i;
      while (j < line.length && /[\d._xXa-fA-F]/.test(line[j]!)) j += 1;
      out.push({ t: line.slice(i, j), c: "num" });
      i = j;
      continue;
    }
    // word
    if (/[A-Za-z_$]/.test(line[i]!)) {
      let j = i;
      while (j < line.length && /[\w$]/.test(line[j]!)) j += 1;
      const w = line.slice(i, j);
      out.push({ t: w, c: KEYWORDS.has(w) ? "kw" : "plain" });
      i = j;
      continue;
    }
    // punctuation cluster
    if (/[{}()\[\];,.<>:?!=+\-*/%&|^~]/.test(line[i]!)) {
      out.push({ t: line[i]!, c: "pun" });
      i += 1;
      continue;
    }
    out.push({ t: line[i]!, c: "plain" });
    i += 1;
  }
  return out;
}

/** Closed loaded langs — v1 canonical ids (SPEC §2). */
export const LOADED_LANGS = [
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
] as const;

const LOADED = new Set<string>(LOADED_LANGS);

/** Closed alias table → canonical loaded id. */
export const LANG_ALIASES: Record<string, (typeof LOADED_LANGS)[number]> = {
  ts: "typescript",
  js: "javascript",
  py: "python",
  sh: "bash",
  yml: "yaml",
  md: "markdown",
};

const EXPLICIT_PLAIN = new Set(["text", "plain", "txt", "output", "plaintext"]);

export type FenceClass =
  | "unlabeled"
  | "explicit-plain"
  | "loaded"
  | "oversize"
  | "typed-unknown";

export type FenceGate = {
  class: FenceClass;
  token: string;
  resolvedLang: string | null;
  lineCount: number;
  gatePassed: boolean;
};

export function fenceInfoToken(langInfo?: string): string {
  const raw = (langInfo ?? "").trim();
  if (!raw) return "";
  const first = raw.split(/\s+/)[0] ?? "";
  return first.toLowerCase();
}

export function lineCountOf(code: string): number {
  return code.replace(/\r\n/g, "\n").split("\n").length;
}

export function classifyFence(code: string, langInfo?: string): FenceGate {
  const lineCount = lineCountOf(code);
  const token = fenceInfoToken(langInfo);

  if (token && EXPLICIT_PLAIN.has(token)) {
    return {
      class: "explicit-plain",
      token,
      resolvedLang: null,
      lineCount,
      gatePassed: false,
    };
  }

  if (!token) {
    if (lineCount > 400) {
      return {
        class: "oversize",
        token: "",
        resolvedLang: null,
        lineCount,
        gatePassed: false,
      };
    }
    return {
      class: "unlabeled",
      token: "",
      resolvedLang: "plaintext",
      lineCount,
      gatePassed: true,
    };
  }

  const resolved = LOADED.has(token)
    ? token
    : (LANG_ALIASES[token] ?? null);

  if (resolved) {
    if (lineCount > 400) {
      return {
        class: "oversize",
        token,
        resolvedLang: resolved,
        lineCount,
        gatePassed: false,
      };
    }
    return {
      class: "loaded",
      token,
      resolvedLang: resolved,
      lineCount,
      gatePassed: true,
    };
  }

  return {
    class: "typed-unknown",
    token,
    resolvedLang: null,
    lineCount,
    gatePassed: false,
  };
}

/** Back-compat name: true only when the shared gate passes (tokenizer/rich eligible). */
export function shouldHighlight(lang?: string, code = "x"): boolean {
  return classifyFence(code, lang).gatePassed;
}
