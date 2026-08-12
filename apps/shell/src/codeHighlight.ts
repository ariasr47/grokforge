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

export function shouldHighlight(lang?: string): boolean {
  if (!lang) return true;
  const l = lang.toLowerCase();
  if (l === "text" || l === "plain" || l === "txt" || l === "output") return false;
  return true;
}
