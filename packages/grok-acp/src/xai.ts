import { toolDefinitionsFor } from "./tools.js";
import type { ExecutionEnvironmentCapability } from "./executionCapability.js";
import { INHERITED_DEFAULT_MODEL } from "@grokforge/model-catalog";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface StreamHandlers {
  onTextDelta: (text: string) => void;
  /** Summarized / streamed reasoning when the API provides it */
  onThinkingDelta?: (text: string) => void;
  signal?: AbortSignal;
}

const DEFAULT_IDLE_TIMEOUT_MS = 30_000;
async function readWithIdleDeadline<T>(reader: ReadableStreamDefaultReader<T>, signal: AbortSignal | undefined, idleTimeoutMs: number): Promise<ReadableStreamReadResult<T>> {
  if (!Number.isFinite(idleTimeoutMs) || idleTimeoutMs <= 0) return reader.read();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([reader.read(), new Promise<ReadableStreamReadResult<T>>((_, reject) => {
      timer = setTimeout(() => { const e = new Error("Provider transport produced no liveness before the idle deadline") as Error & { code?: string }; e.code = "provider_liveness_timeout"; reject(e); void reader.cancel("provider idle deadline").catch(() => undefined); }, idleTimeoutMs);
      if (signal) { onAbort = () => { const e = new Error("The operation was aborted") as Error & { name: string }; e.name = "AbortError"; reject(e); }; if (signal.aborted) onAbort(); else signal.addEventListener("abort", onAbort, { once: true }); }
    })]);
  } finally { if (timer) clearTimeout(timer); if (signal && onAbort) signal.removeEventListener("abort", onAbort); }
}

// Production defaults to xAI; tests may inject a local HTTP provider without
// changing the ACP protocol or mocking the provider logic itself.
const DEFAULT_BASE = process.env.GROKFORGE_XAI_BASE || "https://api.x.ai/v1";

export function mapApiError(status: number, body: string): Error & {
  status?: number;
  code?: string;
  userMessage?: string;
} {
  const snippet = body.slice(0, 500);
  const err = new Error(`xAI API ${status}: ${snippet}`) as Error & {
    status?: number;
    code?: string;
    userMessage?: string;
  };
  err.status = status;
  if (status === 401) {
    err.code = "auth_expired";
    err.userMessage =
      "Auth expired or invalid. Sign in with Grok again, or paste a fresh API key.";
  } else if (status === 403) {
    err.code = "auth_forbidden";
    err.userMessage =
      "Access denied (403). Your subscription may not allow this surface — switch to an API key in Settings.";
  } else if (status === 429) {
    err.code = "rate_limit";
    err.userMessage =
      "Rate limited or pool exhausted. Wait a moment, or switch to API key billing.";
  } else if (status >= 500) {
    err.code = "upstream_error";
    err.userMessage = "xAI server error — retry shortly.";
  } else {
    err.code = "api_error";
    err.userMessage = `API error (${status}).`;
  }
  return err;
}

export function getApiKey(): string | undefined {
  return (
    process.env.XAI_API_KEY?.trim() ||
    process.env.GROK_API_KEY?.trim() ||
    undefined
  );
}

export function getModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.XAI_MODEL?.trim() || env.GROK_MODEL?.trim() || INHERITED_DEFAULT_MODEL;
}

export type ChatCompletionResult = {
  content: string | null;
  tool_calls?: ToolCall[];
  finish_reason?: string;
  reasoning_content?: string | null;
};

/**
 * Non-streaming completion with tools (fallback when stream fails).
 */
export async function chatCompletion(options: {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  tools?: boolean;
  temperature?: number;
  reasoning_effort?: "low" | "medium" | "high";
  signal?: AbortSignal;
  capability: ExecutionEnvironmentCapability;
}): Promise<ChatCompletionResult> {
  const body: Record<string, unknown> = {
    model: options.model,
    messages: options.messages,
    temperature: options.temperature ?? 0.2,
    stream: false,
  };
  if (options.tools !== false) {
    body.tools = toolDefinitionsFor(options.capability);
    body.tool_choice = "auto";
  }
  if (options.reasoning_effort) {
    body.reasoning_effort = options.reasoning_effort;
  }

  const res = await fetch(`${DEFAULT_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: options.signal,
  });

  if (!res.ok) {
    throw mapApiError(res.status, await res.text());
  }

  const data = (await res.json()) as {
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: ToolCall[];
        reasoning_content?: string | null;
        reasoning?: string | null;
      };
      finish_reason?: string;
    }>;
  };
  const msg = data.choices?.[0]?.message;
  const reasoning =
    msg?.reasoning_content ??
    msg?.reasoning ??
    null;
  return {
    content: msg?.content ?? null,
    tool_calls: msg?.tool_calls,
    finish_reason: data.choices?.[0]?.finish_reason,
    reasoning_content: reasoning,
  };
}

type ToolCallDelta = {
  index?: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
};

/**
 * Streaming completion with tools + live reasoning deltas.
 * Assembles tool_calls from OpenAI-style stream chunks.
 */
export async function streamChatCompletion(options: {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  tools?: boolean;
  temperature?: number;
  reasoning_effort?: "low" | "medium" | "high";
  signal?: AbortSignal;
  onThinkingDelta?: (text: string) => void;
  onTextDelta?: (text: string) => void;
  onPhase?: (phase: "reasoning" | "writing" | "tools") => void;
  capability: ExecutionEnvironmentCapability;
  idleTimeoutMs?: number;
}): Promise<ChatCompletionResult> {
  const body: Record<string, unknown> = {
    model: options.model,
    messages: options.messages,
    temperature: options.temperature ?? 0.2,
    stream: true,
  };
  if (options.tools !== false) {
    body.tools = toolDefinitionsFor(options.capability);
    body.tool_choice = "auto";
  }
  if (options.reasoning_effort) {
    body.reasoning_effort = options.reasoning_effort;
  }

  const res = await fetch(`${DEFAULT_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: options.signal,
  });

  if (!res.ok) {
    throw mapApiError(res.status, await res.text());
  }
  if (!res.body) throw new Error("No response body for stream");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let reasoning = "";
  let finish_reason: string | undefined;
  let sawThinking = false;
  let sawContent = false;
  let sawTools = false;
  const toolMap = new Map<
    number,
    { id: string; name: string; arguments: string }
  >();

  while (true) {
    const { done, value } = await readWithIdleDeadline(reader, options.signal, options.idleTimeoutMs ?? Number(process.env.GROKFORGE_PROVIDER_IDLE_MS ?? DEFAULT_IDLE_TIMEOUT_MS));
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n");
    buffer = parts.pop() ?? "";
    for (const line of parts) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const json = JSON.parse(data) as {
          choices?: Array<{
            delta?: {
              content?: string | null;
              reasoning_content?: string | null;
              reasoning?: string | null;
              tool_calls?: ToolCallDelta[];
            };
            finish_reason?: string | null;
          }>;
        };
        const choice = json.choices?.[0];
        if (!choice) continue;
        if (choice.finish_reason) {
          finish_reason = choice.finish_reason;
        }
        const d = choice.delta;
        if (!d) continue;

        const think = d.reasoning_content ?? d.reasoning;
        if (think) {
          if (!sawThinking) {
            sawThinking = true;
            options.onPhase?.("reasoning");
          }
          reasoning += think;
          options.onThinkingDelta?.(think);
        }

        if (d.content) {
          if (!sawContent) {
            sawContent = true;
            options.onPhase?.("writing");
          }
          content += d.content;
          options.onTextDelta?.(d.content);
        }

        if (d.tool_calls?.length) {
          if (!sawTools) {
            sawTools = true;
            options.onPhase?.("tools");
          }
          for (const tc of d.tool_calls) {
            const idx = typeof tc.index === "number" ? tc.index : 0;
            const cur = toolMap.get(idx) ?? {
              id: "",
              name: "",
              arguments: "",
            };
            if (tc.id) cur.id = tc.id;
            if (tc.function?.name) cur.name = (cur.name || "") + tc.function.name;
            if (tc.function?.arguments) {
              cur.arguments += tc.function.arguments;
            }
            toolMap.set(idx, cur);
          }
        }
      } catch {
        /* ignore partial JSON */
      }
    }
  }

  // Providers occasionally close SSE without a trailing newline. Flush the
  // decoder and consume that final frame exactly once instead of dropping it.
  buffer += decoder.decode();
  const tail = buffer.trim();
  if (tail.startsWith("data:")) {
    const data = tail.slice(5).trim();
    if (data !== "[DONE]") {
      try {
        const json = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string|null; reasoning_content?: string|null; reasoning?: string|null; tool_calls?: ToolCallDelta[] }; finish_reason?: string|null }> };
        const choice = json.choices?.[0];
        if (choice?.finish_reason) finish_reason = choice.finish_reason;
        const d = choice?.delta;
        const think = d?.reasoning_content ?? d?.reasoning;
        if (think) { reasoning += think; options.onThinkingDelta?.(think); }
        if (d?.content) { content += d.content; options.onTextDelta?.(d.content); }
        for (const tc of d?.tool_calls ?? []) {
          const idx = typeof tc.index === "number" ? tc.index : 0;
          const cur = toolMap.get(idx) ?? { id: "", name: "", arguments: "" };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name += tc.function.name;
          if (tc.function?.arguments) cur.arguments += tc.function.arguments;
          toolMap.set(idx, cur);
        }
      } catch { /* malformed tail remains ignored */ }
    }
  }

  const tool_calls: ToolCall[] = [...toolMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, t]) => ({
      id: t.id || `call_${Math.random().toString(36).slice(2, 10)}`,
      type: "function" as const,
      function: {
        name: t.name || "unknown",
        arguments: t.arguments || "{}",
      },
    }))
    .filter((t) => t.function.name && t.function.name !== "unknown");

  return {
    content: content || null,
    tool_calls: tool_calls.length ? tool_calls : undefined,
    finish_reason,
    reasoning_content: reasoning || null,
  };
}

/** Stream text-only completion (no tools) for snappy UX on pure chat. */
export async function streamTextCompletion(options: {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  handlers: StreamHandlers;
  reasoning_effort?: "low" | "medium" | "high";
  idleTimeoutMs?: number;
}): Promise<string> {
  const body: Record<string, unknown> = {
    model: options.model,
    messages: options.messages,
    temperature: 0.2,
    stream: true,
  };
  if (options.reasoning_effort) {
    body.reasoning_effort = options.reasoning_effort;
  }
  const res = await fetch(`${DEFAULT_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: options.handlers.signal,
  });

  if (!res.ok) {
    throw mapApiError(res.status, await res.text());
  }

  if (!res.body) throw new Error("No response body for stream");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  while (true) {
    const { done, value } = await readWithIdleDeadline(reader, options.handlers.signal, options.idleTimeoutMs ?? Number(process.env.GROKFORGE_PROVIDER_IDLE_MS ?? DEFAULT_IDLE_TIMEOUT_MS));
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n");
    buffer = parts.pop() ?? "";
    for (const line of parts) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const json = JSON.parse(data) as {
          choices?: Array<{
            delta?: {
              content?: string;
              reasoning_content?: string;
              reasoning?: string;
            };
          }>;
        };
        const d = json.choices?.[0]?.delta;
        const think = d?.reasoning_content ?? d?.reasoning;
        if (think) {
          options.handlers.onThinkingDelta?.(think);
        }
        const delta = d?.content;
        if (delta) {
          full += delta;
          options.handlers.onTextDelta(delta);
        }
      } catch {
        /* ignore partial JSON */
      }
    }
  }
  // Flush an unterminated final SSE line. Some providers close the response
  // immediately after the JSON frame without writing the conventional newline;
  // retaining it would silently drop the final answer/reasoning delta.
  buffer += decoder.decode();
  const tail = buffer.trim();
  if (tail.startsWith("data:")) {
    const data = tail.slice(5).trim();
    if (data !== "[DONE]") {
      try {
        const json = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string; reasoning_content?: string; reasoning?: string } }> };
        const d = json.choices?.[0]?.delta;
        const think = d?.reasoning_content ?? d?.reasoning;
        if (think) options.handlers.onThinkingDelta?.(think);
        if (d?.content) { full += d.content; options.handlers.onTextDelta(d.content); }
      } catch { /* malformed tail is ignored consistently with regular frames */ }
    }
  }
  return full;
}

export const SYSTEM_PROMPT = `You are Grok Code Shell — a local coding agent for the user's workspace.

Rules:
- Prefer tools (read_file, list_dir, grep) before answering questions about the repo.
- For edits, use write_file with the FULL new file content (preferred) or apply_patch.
- Writes and shell commands require user approval; they are staged until the user accepts.
- Never invent file paths outside the workspace. Paths are relative to the workspace root.
- Be concise. Show code in fenced blocks when helpful.
- run_shell is for verification (tests, builds); do not run destructive commands (rm -rf, format disk, etc.).
- For structured comparisons or multi-step plans, you may use fenced \`\`\`grok-ui JSON blocks (callout, steps, compare, kv, metrics, choices, carousel, tabs, map, download, image, actions, embed) — never raw HTML and never a bare \`grok-ui {\` prefix.
`;

export const CHAT_SYSTEM_PROMPT = `You are Grok — a helpful desktop assistant for everyday knowledge work (not a coding IDE).

Primary jobs: writing and editing (email, chat, docs), summarizing long text, analysis of reports and notes, translation (especially English ↔ Japanese), planning, checklists, recipes, and light clerical work. Presentations: deliver clear slide outlines and speaker notes unless the user asks for another format.

Rules:
- Answer clearly in plain language. Use markdown when helpful (headings, bullets, tables).
- Do not assume the user is a software developer unless they ask for coding help. Avoid jargon, terminals, and repo-centric advice by default.
- You may use tools to read files under the bound folder when the user asks about local files. If they mention PDFs and tools only see text files, suggest pasting text or exporting PDF to .txt/.md — do not pretend you read binary PDF pages unless file content is actually available.
- For long translations: preserve meaning and tone; keep a short glossary of proper nouns/terms; offer to continue section-by-section if the source is very long.
- For research/analysis: structure findings (summary, key points, risks, open questions) unless the user wants a freeform reply.
- Writes and shell commands require user approval; prefer not to run destructive commands.
- Paths are relative to the workspace root; never invent paths outside it.
- Be concise when the user wants a short email or chat; be thorough when they paste a large report.

## Rich UI (preferred for structured answers)
When a response benefits from visual structure (comparisons, options, steps, metrics, maps, downloads), emit a fenced block with language tag grok-ui containing JSON only (no raw HTML). Always use a real markdown fence. Never write \`grok-ui {\` as prose. The app renders allowlisted components only.

Schema:
\`\`\`grok-ui
{
  "version": 1,
  "blocks": [
    { "type": "callout", "tone": "info|success|warn|danger|neutral", "title": optional, "body": "..." },
    { "type": "carousel", "title": optional, "items": [{ "title": "...", "body": "...", "badge": optional, "footer": optional }] },
    { "type": "choices", "prompt": "...", "options": [{ "id": optional, "label": "...", "description": optional, "recommended": optional }] },
    { "type": "steps", "title": optional, "items": ["step 1", "step 2"] },
    { "type": "kv", "title": optional, "pairs": [{ "k": "...", "v": "..." }] },
    { "type": "compare", "title": optional, "headers": ["A","B"], "rows": [["...","..."]] },
    { "type": "metrics", "title": optional, "items": [{ "label": "...", "value": "...", "hint": optional }] },
    { "type": "tabs", "tabs": [{ "label": "...", "body": "..." }] },
    { "type": "progress", "title": optional, "value": 0-100, "label": optional },
    { "type": "timeline", "title": optional, "items": [{ "title": "...", "body": optional, "time": optional }] },
    { "type": "quote", "text": "...", "cite": optional },
    { "type": "checklist", "title": optional, "items": [{ "text": "...", "done": false }] },
    { "type": "file", "name": "...", "path": optional, "note": optional },
    { "type": "download", "name": "...", "content": "text to save", "mime": optional, "href": "https only if remote", "note": optional },
    { "type": "map", "query": "place or address", "label": optional, "lat": optional, "lng": optional, "zoom": optional },
    { "type": "image", "src": "https://...", "alt": optional, "caption": optional },
    { "type": "actions", "title": optional, "items": [{ "label": "...", "href": "https://...", "value": "composer text" }] },
    { "type": "embed", "provider": "youtube|vimeo", "id": "safe id only", "title": optional }
  ]
}
\`\`\`

Guidelines:
- Prefer grok-ui for multi-option decisions (carousel or choices), effort/plan comparisons (compare or metrics), numbered procedures (steps), places (map), and saveable text (download).
- You may mix short markdown prose with one or more grok-ui blocks. Close each fence before more prose.
- Also use normal markdown tables and task lists (- [ ] / - [x]) when a full grok-ui block is overkill.
- Never invent HTML/CSS/JS. Never emit an iframe src. Only the types above.
- Keep JSON valid. Max ~8 options / ~12 carousel cards.
- When the user is choosing between product modes or plans, use carousel or choices so they can click "Choose this". Mark one option \`"recommended": true\` when you have a clear pick.
`;

export function systemPromptForMode(capability: { status: string; platform?: string; executable?: string | null; displayName?: string | null; dialect?: string | null; reasonCode?: string | null; reason?: string | null; structuredRepositoryTools?: readonly string[] }): string {
  const mode = process.env.GROKFORGE_MODE?.trim().toLowerCase();
  const base = mode === "chat" ? CHAT_SYSTEM_PROMPT : SYSTEM_PROMPT;
  const context = capability.status === "available"
    ? `\nHost shell: ${capability.platform}; executable ${capability.executable}; display ${capability.displayName}; dialect ${capability.dialect}. Start in the workspace directory. Prefer list_dir, read_file, and grep for ordinary repository work; use shell only when those tools cannot express it. Do not claim confinement.`
    : `\nShell unavailable (${capability.platform ?? "unknown"}). Prefer structured repository tools list_dir, read_file, and grep. Reason code: ${capability.reasonCode ?? "unsupported_platform"}. ${capability.reason ?? "Shell execution is unavailable."}`;
  return base + context;
}
