/**
 * Allowlisted rich UI blocks for chat (NOT raw HTML).
 * Agents emit fenced ```grok-ui JSON; we sanitize and render React components.
 */

export type RichTone = "info" | "success" | "warn" | "danger" | "neutral";

export type RichBlock =
  | {
      type: "callout";
      tone?: RichTone;
      title?: string;
      body: string;
    }
  | {
      type: "carousel";
      title?: string;
      items: Array<{
        title: string;
        body?: string;
        badge?: string;
        footer?: string;
      }>;
    }
  | {
      type: "choices";
      prompt?: string;
      options: Array<{
        id?: string;
        label: string;
        description?: string;
        recommended?: boolean;
      }>;
    }
  | {
      type: "steps";
      title?: string;
      items: string[];
    }
  | {
      type: "kv";
      title?: string;
      pairs: Array<{ k: string; v: string }>;
    }
  | {
      type: "compare";
      title?: string;
      headers: string[];
      rows: string[][];
    }
  | {
      type: "metrics";
      title?: string;
      items: Array<{ label: string; value: string; hint?: string }>;
    }
  | {
      type: "tabs";
      tabs: Array<{ label: string; body: string }>;
    }
  | {
      type: "progress";
      title?: string;
      value: number; // 0-100
      label?: string;
    }
  | {
      type: "timeline";
      title?: string;
      items: Array<{ title: string; body?: string; time?: string }>;
    }
  | {
      type: "quote";
      text: string;
      cite?: string;
    }
  | {
      type: "checklist";
      title?: string;
      items: Array<{ text: string; done?: boolean }>;
    }
  | {
      type: "file";
      name: string;
      path?: string;
      note?: string;
      /** 1-based page reference for a citation (e.g. "lease-2025.pdf · p.7").
       *  Rendered only when the agent actually sends one — never invented. */
      page?: number;
    }
  | {
      type: "download";
      name: string;
      mime?: string;
      content?: string;
      href?: string;
      note?: string;
    }
  | {
      type: "map";
      query: string;
      label?: string;
      lat?: number;
      lng?: number;
      zoom?: number;
    }
  | {
      type: "image";
      src: string;
      alt?: string;
      caption?: string;
    }
  | {
      type: "actions";
      title?: string;
      items: Array<{ label: string; href?: string; value?: string }>;
    }
  | {
      type: "embed";
      provider: "youtube" | "vimeo";
      id: string;
      title?: string;
    };

export type RichDocument = {
  version: 1;
  blocks: RichBlock[];
};

const TONES = new Set(["info", "success", "warn", "danger", "neutral"]);

function str(v: unknown, max = 4000): string {
  if (v == null) return "";
  return String(v).slice(0, max);
}

function toneOf(v: unknown): RichTone {
  const t = str(v, 20);
  return TONES.has(t) ? (t as RichTone) : "info";
}

function httpsUrl(v: unknown, max = 2000): string | undefined {
  const s = str(v, max).trim();
  try {
    const u = new URL(s);
    if (u.protocol !== "https:") return undefined;
    if (!u.hostname.includes(".")) return undefined;
    return u.toString();
  } catch {
    return undefined;
  }
}

function finiteNum(v: unknown, min: number, max: number): number | undefined {
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(min, Math.min(max, n));
}

function sanitizeBlock(raw: unknown): RichBlock | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const type = str(o.type, 32);

  switch (type) {
    case "callout":
      return {
        type: "callout",
        tone: toneOf(o.tone),
        title: str(o.title, 200) || undefined,
        body: str(o.body ?? o.text, 8000),
      };
    case "carousel":
    case "cards": {
      const itemsIn = Array.isArray(o.items) ? o.items : [];
      const items = itemsIn
        .slice(0, 12)
        .map((it) => {
          if (!it || typeof it !== "object") return null;
          const x = it as Record<string, unknown>;
          const title = str(x.title, 200);
          if (!title) return null;
          return {
            title,
            body: str(x.body ?? x.text, 4000) || undefined,
            badge: str(x.badge, 80) || undefined,
            footer: str(x.footer, 200) || undefined,
          };
        })
        .filter(Boolean) as Array<{
        title: string;
        body?: string;
        badge?: string;
        footer?: string;
      }>;
      if (!items.length) return null;
      return {
        type: "carousel",
        title: str(o.title, 200) || undefined,
        items,
      };
    }
    case "choices":
    case "decision": {
      const optsIn = Array.isArray(o.options) ? o.options : [];
      const options = optsIn
        .slice(0, 8)
        .map((it, i) => {
          if (typeof it === "string") {
            return { id: `opt-${i}`, label: str(it, 120) };
          }
          if (!it || typeof it !== "object") return null;
          const x = it as Record<string, unknown>;
          const label = str(x.label ?? x.title ?? x.text, 120);
          if (!label) return null;
          return {
            id: str(x.id, 64) || `opt-${i}`,
            label,
            description: str(x.description ?? x.body, 500) || undefined,
            recommended: x.recommended === true ? true : undefined,
          };
        })
        .filter(Boolean) as Array<{
        id?: string;
        label: string;
        description?: string;
        recommended?: boolean;
      }>;
      if (!options.length) return null;
      return {
        type: "choices",
        prompt: str(o.prompt ?? o.title, 400) || undefined,
        options,
      };
    }
    case "steps": {
      const itemsIn = Array.isArray(o.items) ? o.items : [];
      const items = itemsIn.map((x) => str(x, 1000)).filter(Boolean).slice(0, 20);
      if (!items.length) return null;
      return {
        type: "steps",
        title: str(o.title, 200) || undefined,
        items,
      };
    }
    case "kv":
    case "keyvalue": {
      const pairsIn = Array.isArray(o.pairs)
        ? o.pairs
        : Array.isArray(o.items)
          ? o.items
          : [];
      const pairs = pairsIn
        .slice(0, 30)
        .map((it) => {
          if (!it || typeof it !== "object") return null;
          const x = it as Record<string, unknown>;
          const k = str(x.k ?? x.key ?? x.label, 120);
          const v = str(x.v ?? x.value ?? x.text, 1000);
          if (!k && !v) return null;
          return { k: k || "—", v: v || "—" };
        })
        .filter(Boolean) as Array<{ k: string; v: string }>;
      if (!pairs.length) return null;
      return {
        type: "kv",
        title: str(o.title, 200) || undefined,
        pairs,
      };
    }
    case "compare":
    case "table": {
      const headers = (Array.isArray(o.headers) ? o.headers : [])
        .map((h) => str(h, 80))
        .slice(0, 8);
      const rowsIn = Array.isArray(o.rows) ? o.rows : [];
      const rows = rowsIn.slice(0, 40).map((r) => {
        if (!Array.isArray(r)) return [str(r, 200)];
        return r.map((c) => str(c, 400)).slice(0, 8);
      });
      if (!headers.length && !rows.length) return null;
      return {
        type: "compare",
        title: str(o.title, 200) || undefined,
        headers: headers.length ? headers : rows[0]?.map((_, i) => `Col ${i + 1}`) ?? [],
        rows,
      };
    }
    case "metrics": {
      const itemsIn = Array.isArray(o.items) ? o.items : [];
      const items = itemsIn
        .slice(0, 8)
        .map((it) => {
          if (!it || typeof it !== "object") return null;
          const x = it as Record<string, unknown>;
          const label = str(x.label, 80);
          const value = str(x.value, 80);
          if (!label && !value) return null;
          return {
            label: label || "—",
            value: value || "—",
            hint: str(x.hint, 200) || undefined,
          };
        })
        .filter(Boolean) as Array<{
        label: string;
        value: string;
        hint?: string;
      }>;
      if (!items.length) return null;
      return {
        type: "metrics",
        title: str(o.title, 200) || undefined,
        items,
      };
    }
    case "tabs": {
      const tabsIn = Array.isArray(o.tabs) ? o.tabs : [];
      const tabs = tabsIn
        .slice(0, 6)
        .map((it) => {
          if (!it || typeof it !== "object") return null;
          const x = it as Record<string, unknown>;
          const label = str(x.label ?? x.title, 80);
          const body = str(x.body ?? x.text, 6000);
          if (!label) return null;
          return { label, body };
        })
        .filter(Boolean) as Array<{ label: string; body: string }>;
      if (!tabs.length) return null;
      return { type: "tabs", tabs };
    }
    case "progress": {
      let value = Number(o.value ?? o.percent ?? 0);
      if (!Number.isFinite(value)) value = 0;
      value = Math.max(0, Math.min(100, value));
      return {
        type: "progress",
        title: str(o.title, 200) || undefined,
        value,
        label: str(o.label, 120) || undefined,
      };
    }
    case "timeline": {
      const itemsIn = Array.isArray(o.items) ? o.items : [];
      const items = itemsIn
        .slice(0, 16)
        .map((it) => {
          if (!it || typeof it !== "object") return null;
          const x = it as Record<string, unknown>;
          const title = str(x.title ?? x.label, 200);
          if (!title) return null;
          return {
            title,
            body: str(x.body ?? x.text, 2000) || undefined,
            time: str(x.time ?? x.when, 80) || undefined,
          };
        })
        .filter(Boolean) as Array<{
        title: string;
        body?: string;
        time?: string;
      }>;
      if (!items.length) return null;
      return {
        type: "timeline",
        title: str(o.title, 200) || undefined,
        items,
      };
    }
    case "quote": {
      const text = str(o.text ?? o.body, 4000);
      if (!text) return null;
      return {
        type: "quote",
        text,
        cite: str(o.cite ?? o.author, 200) || undefined,
      };
    }
    case "checklist": {
      const itemsIn = Array.isArray(o.items) ? o.items : [];
      const items = itemsIn
        .slice(0, 24)
        .map((it) => {
          if (typeof it === "string") return { text: str(it, 500), done: false };
          if (!it || typeof it !== "object") return null;
          const x = it as Record<string, unknown>;
          const text = str(x.text ?? x.label, 500);
          if (!text) return null;
          return { text, done: Boolean(x.done ?? x.checked) };
        })
        .filter(Boolean) as Array<{ text: string; done?: boolean }>;
      if (!items.length) return null;
      return {
        type: "checklist",
        title: str(o.title, 200) || undefined,
        items,
      };
    }
    case "file":
    case "filechip": {
      const name = str(o.name ?? o.path, 200);
      if (!name) return null;
      const pageRaw = finiteNum(o.page ?? o.pageNumber, 1, 100_000);
      return {
        type: "file",
        name,
        path: str(o.path, 400) || undefined,
        note: str(o.note ?? o.body, 400) || undefined,
        page: pageRaw != null ? Math.round(pageRaw) : undefined,
      };
    }
    case "download":
    case "attachment": {
      const name = str(o.name ?? o.filename, 200);
      if (!name) return null;
      const href = httpsUrl(o.href ?? o.url);
      const content = str(o.content ?? o.text, 80_000) || undefined;
      if (!href && !content) return null;
      const mime = str(o.mime ?? o.contentType, 80) || undefined;
      return {
        type: "download",
        name,
        mime: mime || undefined,
        content,
        href,
        note: str(o.note ?? o.body, 400) || undefined,
      };
    }
    case "map":
    case "place": {
      const lat = finiteNum(o.lat ?? o.latitude, -90, 90);
      const lng = finiteNum(o.lng ?? o.lon ?? o.longitude, -180, 180);
      const query =
        str(o.query ?? o.q ?? o.address ?? o.label, 400) ||
        (lat != null && lng != null ? `${lat},${lng}` : "");
      if (!query) return null;
      return {
        type: "map",
        query,
        label: str(o.label ?? o.title, 200) || undefined,
        lat,
        lng,
        zoom: finiteNum(o.zoom, 1, 20),
      };
    }
    case "image":
    case "img": {
      const src = httpsUrl(o.src ?? o.url ?? o.href);
      if (!src) return null;
      return {
        type: "image",
        src,
        alt: str(o.alt ?? o.title, 200) || undefined,
        caption: str(o.caption ?? o.body, 400) || undefined,
      };
    }
    case "actions":
    case "buttons": {
      const itemsIn = Array.isArray(o.items) ? o.items : Array.isArray(o.actions) ? o.actions : [];
      const items = itemsIn
        .slice(0, 6)
        .map((it) => {
          if (!it || typeof it !== "object") return null;
          const x = it as Record<string, unknown>;
          const label = str(x.label ?? x.title ?? x.text, 80);
          if (!label) return null;
          return {
            label,
            href: httpsUrl(x.href ?? x.url),
            value: str(x.value ?? x.choice, 400) || undefined,
          };
        })
        .filter(Boolean) as Array<{ label: string; href?: string; value?: string }>;
      if (!items.length) return null;
      return {
        type: "actions",
        title: str(o.title ?? o.prompt, 200) || undefined,
        items,
      };
    }
    case "embed":
    case "video": {
      const providerRaw = str(o.provider ?? o.service, 20).toLowerCase();
      const provider = providerRaw === "vimeo" ? "vimeo" : providerRaw === "youtube" ? "youtube" : "";
      if (!provider) return null;
      const id = str(o.id ?? o.videoId, 32);
      if (provider === "youtube" && !/^[A-Za-z0-9_-]{6,20}$/.test(id)) return null;
      if (provider === "vimeo" && !/^[0-9]{6,12}$/.test(id)) return null;
      return {
        type: "embed",
        provider,
        id,
        title: str(o.title, 200) || undefined,
      };
    }
    default:
      return null;
  }
}

/** Best-effort parse for incomplete streaming JSON (closes open braces). */
export function parseRichDocumentProgressive(raw: string): RichDocument | null {
  const full = parseRichDocument(raw);
  if (full) return full;
  // Try to salvage complete leading blocks from truncated stream
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  // Attempt closing incomplete JSON
  let candidate = trimmed;
  const opens = (candidate.match(/\{/g) || []).length;
  const closes = (candidate.match(/\}/g) || []).length;
  if (opens > closes) candidate += "}".repeat(opens - closes);
  const opensB = (candidate.match(/\[/g) || []).length;
  const closesB = (candidate.match(/\]/g) || []).length;
  if (opensB > closesB) candidate += "]".repeat(opensB - closesB);
  // Remove trailing commas before } or ]
  candidate = candidate.replace(/,\s*([\]}])/g, "$1");
  return parseRichDocument(candidate);
}

/** Walk a `{` and return the balanced object slice if it is a rich document. */
export function extractJsonObject(
  s: string,
  braceIndex: number,
): { json: string; end: number } | null {
  if (s[braceIndex] !== "{") return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = braceIndex; i < s.length; i++) {
    const c = s[i]!;
    if (inStr) {
      if (esc) {
        esc = false;
        continue;
      }
      if (c === "\\") {
        esc = true;
        continue;
      }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) {
        const json = s.slice(braceIndex, i + 1);
        if (!parseRichDocument(json)) return null;
        return { json, end: i + 1 };
      }
    }
  }
  return null;
}

const UNFENCED_MARKER = /^(grok-ui|grokui|rich-ui)\s*\{/i;
const FENCED_RICH_LANG = /^(grok-ui|grokui|rich-ui|ui)\b/i;

function skipHorizontalWs(src: string, i: number): number {
  while (i < src.length && (src[i] === " " || src[i] === "\t" || src[i] === "\r")) i += 1;
  return i;
}

function consumeClosingFence(src: string, i: number): number {
  let j = skipHorizontalWs(src, i);
  if (src[j] === "\n") j += 1;
  j = skipHorizontalWs(src, j);
  if (src.startsWith("```", j)) return j + 3;
  return i;
}

function emitCanonicalRichFence(json: string): string {
  return `\n\n\`\`\`grok-ui\n${json}\n\`\`\`\n\n`;
}

/**
 * Models often emit `grok-ui { ... }` as prose, or a same-line fence
 * (```grok-ui { ... } ```) instead of a real markdown fence with newlines.
 * Lift complete documents into canonical fences so the markdown parser
 * renders components instead of dumping JSON. JSON inside non-rich fences
 * is left untouched.
 */
export function liftUnfencedRichUi(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    if (src.startsWith("```", i)) {
      const headerAt = skipHorizontalWs(src, i + 3);
      const langMatch = FENCED_RICH_LANG.exec(src.slice(headerAt));
      if (langMatch && langMatch.index === 0) {
        let j = skipHorizontalWs(src, headerAt + langMatch[0].length);
        if (src[j] === "\n") j += 1;
        j = skipHorizontalWs(src, j);
        if (src[j] === "{") {
          const extracted = extractJsonObject(src, j);
          if (extracted) {
            out += emitCanonicalRichFence(extracted.json);
            i = consumeClosingFence(src, extracted.end);
            continue;
          }
        }
      }
      const nl = src.indexOf("\n", i + 3);
      const sameLineClose = src.indexOf("```", i + 3);
      if (sameLineClose !== -1 && (nl === -1 || sameLineClose < nl)) {
        out += src.slice(i, sameLineClose + 3);
        i = sameLineClose + 3;
        continue;
      }
      const close = src.indexOf("\n```", i + 3);
      if (close === -1) {
        out += src.slice(i);
        break;
      }
      const end = close + 4;
      out += src.slice(i, end);
      i = end;
      continue;
    }

    const rest = src.slice(i);
    const marker = UNFENCED_MARKER.exec(rest);
    if (marker && marker.index === 0) {
      const braceAt = i + marker[0].length - 1;
      const extracted = extractJsonObject(src, braceAt);
      if (extracted) {
        out += emitCanonicalRichFence(extracted.json);
        i = extracted.end;
        i = skipHorizontalWs(src, i);
        continue;
      }
    }

    if (src[i] === "{") {
      const peek = src.slice(i, i + 220);
      if (/"version"\s*:\s*1/.test(peek) && /"blocks"\s*:/.test(peek)) {
        const extracted = extractJsonObject(src, i);
        if (extracted) {
          out += emitCanonicalRichFence(extracted.json);
          i = extracted.end;
          i = skipHorizontalWs(src, i);
          continue;
        }
      }
    }

    out += src[i];
    i += 1;
  }
  return out;
}

/** Parse fenced grok-ui / ui JSON into a sanitized document. */
export function parseRichDocument(raw: string): RichDocument | null {
  try {
    const data = JSON.parse(raw) as unknown;
    if (!data || typeof data !== "object") return null;
    const o = data as Record<string, unknown>;
    const blocksIn = Array.isArray(o.blocks)
      ? o.blocks
      : Array.isArray(data)
        ? data
        : [data];
    const blocks = blocksIn
      .map(sanitizeBlock)
      .filter(Boolean)
      .slice(0, 24) as RichBlock[];
    if (!blocks.length) return null;
    return { version: 1, blocks };
  } catch {
    return null;
  }
}

export function isRichUiLang(lang: string): boolean {
  const l = lang.toLowerCase().trim();
  return l === "grok-ui" || l === "grokui" || l === "ui" || l === "rich-ui";
}
