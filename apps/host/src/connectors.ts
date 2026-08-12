/**
 * First-party connector registry for Forge (brother dogfood + Phase 2 scaffold).
 * OAuth providers (Gmail, etc.) are catalogued with honest status until OAuth apps ship.
 * Token-based connectors (Notion) can be configured and smoke-tested today.
 */
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./channel.js";

export type ConnectorStatus =
  | "live" // token configured and last test ok
  | "configured" // credentials present, not recently tested
  | "paste_workflow" // use paste / export today — no live API
  | "planned"; // roadmap only

export interface ConnectorDef {
  id: string;
  name: string;
  description: string;
  category: "mail" | "docs" | "notes" | "calendar" | "files" | "chat";
  status: ConnectorStatus;
  /** How brother uses it without full OAuth */
  howToday: string;
  /** Sample prompt to put in Chat */
  samplePrompt: string;
  /** Supports API token / key storage */
  tokenConfigurable?: boolean;
  tokenLabel?: string;
  lastTestOk?: boolean | null;
  lastTestAt?: string | null;
  lastTestMessage?: string | null;
  hasToken?: boolean;
}

interface ConnectorStore {
  tokens: Record<string, string>;
  tests: Record<
    string,
    { ok: boolean; at: string; message: string }
  >;
}

const CATALOG: Omit<
  ConnectorDef,
  "lastTestOk" | "lastTestAt" | "lastTestMessage" | "hasToken" | "status"
>[] = [
  {
    id: "gmail",
    name: "Gmail",
    description: "Draft and polish email; full inbox sync needs Google OAuth (next).",
    category: "mail",
    howToday:
      "Paste the email thread or bullets into Chat → ask for a reply draft. Copy result back into Gmail. Or use Export chat for a longer thread.",
    samplePrompt:
      "Turn these bullets into a short professional Gmail reply. Warm but not casual:\n- [paste]",
  },
  {
    id: "notion",
    name: "Notion",
    description: "Read pages/databases via integration token (optional).",
    category: "notes",
    howToday:
      "Option A: paste page text into Chat. Option B: create a Notion internal integration, share pages with it, paste the secret below and Test.",
    samplePrompt:
      "Summarize this Notion page export into action items and owners:\n[paste]",
    tokenConfigurable: true,
    tokenLabel: "Notion integration secret (secret_…)",
  },
  {
    id: "google-drive",
    name: "Google Drive",
    description: "Docs/sheets as context (OAuth planned).",
    category: "files",
    howToday:
      "Download as .txt/.md or copy text → Attach or paste into Chat. Open a local folder of exports with Open folder.",
    samplePrompt:
      "I exported these Drive notes as text. Extract decisions and open questions:\n[paste]",
  },
  {
    id: "calendar",
    name: "Calendar",
    description: "Schedule drafting only (no OS/Google calendar write yet).",
    category: "calendar",
    howToday:
      "Describe events; ask for a day plan or ICS-style bullets you can copy into Google Calendar.",
    samplePrompt:
      "Build a one-week calendar plan for [goal]. List each day with 2–4 blocks I can copy into Google Calendar.",
  },
  {
    id: "slack",
    name: "Slack / Teams",
    description: "Message polish (live connector planned).",
    category: "chat",
    howToday: "Paste the draft message → ask for shorter / clearer / more formal variants.",
    samplePrompt:
      "Rewrite this Slack message to be concise and friendly. Offer 2 tones:\n[paste]",
  },
  {
    id: "local-files",
    name: "Local files",
    description: "Folder tools + Attach (available now).",
    category: "files",
    howToday:
      "Chat → Open folder (optional) for project docs, or Attach .txt/.md/.csv. PDF: export to text first.",
    samplePrompt:
      "List the text files you can see in my folder and summarize the three most relevant to [topic].",
  },
];

function storePath(): string {
  return path.join(dataDir(), "connectors.json");
}

function loadStore(): ConnectorStore {
  try {
    const p = storePath();
    if (!fs.existsSync(p)) return { tokens: {}, tests: {} };
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Partial<ConnectorStore>;
    return {
      tokens: raw.tokens && typeof raw.tokens === "object" ? raw.tokens : {},
      tests: raw.tests && typeof raw.tests === "object" ? raw.tests : {},
    };
  } catch {
    return { tokens: {}, tests: {} };
  }
}

function saveStore(s: ConnectorStore): void {
  const dir = path.dirname(storePath());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(storePath(), JSON.stringify(s, null, 2), "utf8");
}

function resolveStatus(
  id: string,
  store: ConnectorStore,
): ConnectorStatus {
  if (id === "local-files") return "live";
  if (id === "notion") {
    if (store.tokens.notion?.trim()) {
      const t = store.tests.notion;
      if (t?.ok) return "live";
      return "configured";
    }
    return "paste_workflow";
  }
  if (
    id === "gmail" ||
    id === "google-drive" ||
    id === "slack" ||
    id === "calendar"
  ) {
    return "paste_workflow";
  }
  return "planned";
}

export function listConnectors(): ConnectorDef[] {
  const store = loadStore();
  return CATALOG.map((c) => {
    const test = store.tests[c.id];
    const hasToken = Boolean(store.tokens[c.id]?.trim());
    return {
      ...c,
      status: resolveStatus(c.id, store),
      hasToken,
      lastTestOk: test ? test.ok : null,
      lastTestAt: test?.at ?? null,
      lastTestMessage: test?.message ?? null,
    };
  });
}

export function setConnectorToken(
  id: string,
  token: string | null,
): ConnectorDef[] {
  const store = loadStore();
  if (!token || !token.trim()) {
    delete store.tokens[id];
  } else {
    store.tokens[id] = token.trim();
  }
  saveStore(store);
  // Expose Notion token to agent process via env for future tools
  if (id === "notion") {
    if (token?.trim()) process.env.NOTION_API_KEY = token.trim();
    else delete process.env.NOTION_API_KEY;
  }
  return listConnectors();
}

export function getNotionToken(): string | null {
  const t = loadStore().tokens.notion?.trim();
  return t || process.env.NOTION_API_KEY?.trim() || null;
}

/** Smoke-test a connector without writing to third-party data. */
export async function testConnector(
  id: string,
): Promise<{ ok: boolean; message: string }> {
  const store = loadStore();
  let result: { ok: boolean; message: string };

  if (id === "local-files") {
    result = {
      ok: true,
      message: "Local files available via Open folder + Attach in Chat.",
    };
  } else if (id === "notion") {
    const token = getNotionToken();
    if (!token) {
      result = {
        ok: false,
        message: "No Notion token. Paste an integration secret, then Test.",
      };
    } else {
      try {
        const res = await fetch("https://api.notion.com/v1/users/me", {
          headers: {
            Authorization: `Bearer ${token}`,
            "Notion-Version": "2022-06-28",
          },
        });
        if (!res.ok) {
          const body = await res.text();
          result = {
            ok: false,
            message: `Notion API ${res.status}: ${body.slice(0, 200)}`,
          };
        } else {
          const data = (await res.json()) as { name?: string; type?: string };
          result = {
            ok: true,
            message: `Connected as ${data.name || data.type || "bot"}. Share pages with the integration to read them.`,
          };
        }
      } catch (e) {
        result = {
          ok: false,
          message: e instanceof Error ? e.message : String(e),
        };
      }
    }
  } else if (
    id === "gmail" ||
    id === "google-drive" ||
    id === "calendar" ||
    id === "slack"
  ) {
    result = {
      ok: true,
      message:
        "Paste-workflow ready (no OAuth app yet). Use sample prompt in Chat — no account link required.",
    };
  } else {
    result = { ok: false, message: "Unknown connector" };
  }

  store.tests[id] = {
    ok: result.ok,
    at: new Date().toISOString(),
    message: result.message,
  };
  saveStore(store);
  return result;
}

/** Load Notion token into process env at host boot */
export function hydrateConnectorEnv(): void {
  const t = getNotionToken();
  if (t) process.env.NOTION_API_KEY = t;
}
