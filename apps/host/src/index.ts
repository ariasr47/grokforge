import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { AgentSession, retainActivityAfterDiff, retainActivityAfterRecovery } from "./session.js";
import { TRUSTED_COMMAND_CLASS_CATALOG } from "./trusted-command-classes.js";
import type { PermissionDecision } from "@grokforge/acp-client";
import {
  clientLog,
  log,
  logPath,
  logsDir,
  readLogTail,
  writeDiagnosticsBundle,
} from "./log.js";
import { pickFolderNative } from "./pick-folder.js";
import { listWorkspaceFiles } from "./workspace-files.js";
import { resolveConfinedTarget } from "./workspace-confinement.js";
import { spawn } from "node:child_process";
import { resolveApiKeyAsync, loadConfig } from "./config.js";
import { getGitBranch } from "./git.js";
import {
  hydrateConnectorEnv,
  listConnectors,
  setConnectorToken,
  testConnector,
} from "./connectors.js";
import { channelMeta, defaultPort, dataDir } from "./channel.js";
import {
  isJsonContentType,
  isOriginAllowed,
  requestHasBody,
} from "./request-lockdown.js";
import { hasPriorConversations } from "./shell-history.js";
import { APP_VERSION } from "./build-version.js";
import { EditJournal } from "./edit-journal.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = defaultPort();
const CHANNEL = channelMeta();
const session = new AgentSession();
// Stable shell session ids own independent AgentSession/ACP contexts. The legacy singleton
// remains the default for routes that predate reliable-run ownership.
const sessionRegistry = new Map<string, AgentSession>();
const editJournal = new EditJournal(dataDir());
const wsBindings = new Map<WebSocket, Map<string, () => void>>();
function bindSocketSession(ws: WebSocket, sid: string): void {
  const owner = sessionFor(sid, false); if (!owner) return;
  const bindings = wsBindings.get(ws) ?? new Map<string,()=>void>();
  if (bindings.has(sid)) return;
  bindings.set(sid, owner.on((event) => wsSend(ws, event)));
  wsBindings.set(ws, bindings);
}
function sessionFor(id: string | null | undefined, create = true): AgentSession | null {
  if (!id) return session;
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(id)) return null;
  let value = sessionRegistry.get(id);
  if (!value && create) { value = new AgentSession(id); sessionRegistry.set(id, value); for (const ws of wsBindings.keys()) bindSocketSession(ws, id); }
  return value ?? null;
}
hydrateConnectorEnv();

/**
 * Never sends the `*` wildcard — GATE Z lockdown (SPEC §8, INTERFACE_CONTRACT.md "Request
 * lockdown"). Cross-origin CORS headers for an *allowed* origin are set once, early in the
 * request handler below (`res.setHeader`), before any route runs; `res.writeHead()` here only
 * adds `Content-Type` and merges with whatever was already set via `setHeader`.
 */
function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(data);
}
function sendContractError(res:http.ServerResponse,status:number,code:string,error:string,extra:Record<string,unknown>={}){sendJson(res,status,{error,code,retryable:false,runId:null,...extra});}

/**
 * The single origin-aware builder for every state object the engine emits
 * (INTERFACE_CONTRACT.md "Which surfaces carry it", property 4; SPEC.md §2.8 property 4 / §9.13).
 * `priorConversations` is per-requester (D1), so it is stamped here from the caller's own `Origin`
 * rather than baked into `AgentSession.getState()`, which has no requester. Every HTTP response and
 * every WS `state` frame that carries a state object MUST route through this function — that is what
 * makes "any state object carries the field" true by construction instead of by a list of call sites
 * an eighth endpoint (or a second per-requester field) could silently miss. A future response that
 * hand-assembles a state-shaped body without calling this sits outside the guarantee (the named
 * residual, SPEC.md §9.13) — the standing obligation is that such a response is named in
 * INTERFACE_CONTRACT.md.
 */
function stampState<T extends object>(
  state: T,
  origin: string | string[] | null | undefined,
): T & { priorConversations: boolean; activeRunCount: number; busy: boolean } {
  const activeRunCount = (session.getActiveRunId() ? 1 : 0) + [...sessionRegistry.values()].reduce((count, owner) => count + (owner.getActiveRunId() ? 1 : 0), 0);
  return { ...state, priorConversations: hasPriorConversations(origin), activeRunCount, busy: activeRunCount > 0 };
}

/** HTTP convenience wrapper around `stampState` — sends 200 with the stamped body. */
function sendState<T extends object>(
  res: http.ServerResponse,
  origin: string | string[] | null | undefined,
  state: T,
): void {
  sendJson(res, 200, stampState(state, origin));
}

const MAX_BODY_BYTES = 4 * 1024 * 1024; // 4 MiB

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    const buf = c as Buffer;
    size += buf.length;
    if (size > MAX_BODY_BYTES) {
      throw new Error(`Request body exceeds ${MAX_BODY_BYTES} bytes`);
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
  const method = req.method || "GET";

  // --- GATE Z request lockdown (SPEC §8 / INTERFACE_CONTRACT.md "Request lockdown") ---------
  // Origin allowlist: refuses BOTH the preflight and the actual request, on every route (AC13,
  // AC14). No Origin header at all (loopback CLI, the conformance runner) is allowed. Runs before
  // any route logic, any body read, and any CORS header is set — a foreign origin gets nothing.
  const origin = req.headers.origin;
  if (!isOriginAllowed(origin)) {
    // Every refusal is logged at warn level (SPEC §2.7 rule 6) — the operator's only signal that
    // the wrong build (or a mis-generated allowlist) shipped, since the browser side of a 403 with
    // no Access-Control-Allow-Origin is an opaque rejection indistinguishable from connection-refused.
    log("warn", "origin refused", {
      origin: Array.isArray(origin) ? origin.join(", ") : (origin ?? ""),
      route: url.pathname,
      method,
    });
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "origin not allowed" }));
    return;
  }
  // Reflect the exact allowed origin (never "*") so a legitimate cross-origin shell can still read
  // the response; a request with no Origin header gets no CORS header at all (not needed).
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  if (method === "OPTIONS") {
    // Allow-side preflight (SPEC §2.7 / AC-S1). The packaged WebView treats the loopback host as
    // cross-site and preflights `content-type`; without these headers the real request never fires
    // at all — a TOTAL connect failure, not a degraded one. ACAO/Vary were already set above for an
    // allowed origin; never "*" (AC23).
    res.writeHead(204, {
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "600",
    });
    res.end();
    return;
  }

  // JSON-only bodies (AC15): refused before any route reads/parses the body, so no state can move.
  // A bodyless POST (/api/cancel) is unaffected.
  if (requestHasBody(req.headers) && !isJsonContentType(req.headers["content-type"])) {
    res.writeHead(415, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "content-type must be application/json" }));
    return;
  }

  try {
    if (method === "GET" && url.pathname === "/api/health") {
      sendJson(res, 200, {
        ok: true,
        service: "grokforge-host",
        version: APP_VERSION,
        channel: CHANNEL.channel,
        channelLabel: CHANNEL.label,
        port: PORT,
        dataDir: CHANNEL.dataDir,
        log: logPath(),
        pid: process.pid,
      });
      return;
    }

    if (method === "GET" && url.pathname === "/api/state") {
      // priorConversations is PER-REQUESTER (INTERFACE_CONTRACT.md), stamped by the shared builder
      // below at the HTTP edge — AgentSession.getState() has no requester. An absent Origin (the
      // native health probe, the conformance runner) always reads false.
      const requested = url.searchParams.get("sessionId");
      const owner = requested ? sessionFor(requested, false) : session;
      if (requested && !owner) { sendContractError(res,404,"session_not_found","Session not found"); return; }
      await owner!.awaitReady();
      await owner!.refreshWorkspacePolicy();
      await owner!.refreshProjectInstructionsPresence();
      sendState(res, origin, owner!.getState());
      return;
    }

    if (method === "GET" && url.pathname === "/api/workspace-policy") {
      const workspace = url.searchParams.get("workspace");
      if (!workspace || !path.isAbsolute(workspace)) { sendContractError(res,400,"invalid_workspace","Workspace must be an absolute directory"); return; }
      try { sendJson(res,200,{policy:await session.getWorkspacePolicy(workspace)}); } catch { sendContractError(res,400,"invalid_workspace","Invalid workspace"); } return;
    }
    if (method === "POST" && url.pathname === "/api/workspace-policy") {
      const body=JSON.parse((await readBody(req))||"{}") as {sessionId?:string;workspace?:string;mode?:"review"|"trusted_workspace"};
      if (!body.sessionId || !body.workspace || !body.mode || !path.isAbsolute(body.workspace)) { sendContractError(res,400,"invalid_workspace","Invalid workspace or policy"); return; }
      // Saving a workspace policy is a legitimate session-establishing mutation:
      // a newly-created shell session must be able to choose Trusted before its
      // first prompt. Read/cancel/replay routes remain non-creating.
      const owner=sessionFor(body.sessionId,true); if (!owner) { sendContractError(res,404,"session_not_found","Session not found"); return; }
      try { sendJson(res,200,{policy:await owner.saveWorkspacePolicy(body.workspace,body.mode)}); } catch(e) { const code=(e as any)?.code; sendContractError(res,code==="run_active"?409:400,code==="run_active"?"run_active":"invalid_policy",code==="run_active"?"Run is active":"Invalid policy",code==="run_active"?{activeRunId:owner.getActiveRunId()}:{}); } return;
    }
    if (method === "GET" && url.pathname === "/api/trusted-command-class-catalog") {
      sendJson(res, 200, { catalog: TRUSTED_COMMAND_CLASS_CATALOG });
      return;
    }
    if (method === "GET" && url.pathname === "/api/trusted-command-classes") {
      const workspace = url.searchParams.get("workspace");
      if (!workspace || !path.isAbsolute(workspace)) {
        sendContractError(res, 400, "invalid_workspace", "Workspace must be an absolute directory");
        return;
      }
      try {
        sendJson(res, 200, { classes: await session.getTrustedCommandClasses(workspace) });
      } catch {
        sendContractError(res, 400, "invalid_workspace", "Invalid workspace");
      }
      return;
    }
    if (method === "POST" && url.pathname === "/api/trusted-command-classes") {
      const body = JSON.parse((await readBody(req)) || "{}") as {
        sessionId?: string;
        workspace?: string;
        classes?: unknown;
        expectedRevision?: string;
      };
      if (
        !body.sessionId ||
        !body.workspace ||
        !path.isAbsolute(body.workspace) ||
        typeof body.expectedRevision !== "string"
      ) {
        sendContractError(res, 400, "invalid_workspace", "Invalid workspace or classes request");
        return;
      }
      const owner = sessionFor(body.sessionId, true);
      if (!owner) {
        sendContractError(res, 404, "session_not_found", "Session not found");
        return;
      }
      try {
        sendJson(res, 200, {
          classes: await owner.saveTrustedCommandClasses(
            body.workspace,
            body.classes,
            body.expectedRevision,
          ),
        });
      } catch (e) {
        const code = (e as any)?.code;
        if (code === "run_active") {
          sendContractError(res, 409, "run_active", "Run is active", {
            activeRunId: owner.getActiveRunId(),
          });
          return;
        }
        if (code === "class_revision_conflict") {
          sendContractError(res, 409, "class_revision_conflict", "Class revision conflict");
          return;
        }
        if (code === "invalid_classes" || code === "invalid_request") {
          sendContractError(res, 400, code, "Invalid classes");
          return;
        }
        if (code === "invalid_workspace") {
          sendContractError(res, 400, "invalid_workspace", "Invalid workspace");
          return;
        }
        sendContractError(res, 500, "class_save_failed", "Could not save Trusted command classes");
      }
      return;
    }
    if (method === "POST" && url.pathname === "/api/session-permission-mode") {
      const body=JSON.parse((await readBody(req))||"{}") as {sessionId?:string;activationToken?:string;mode?:"workspace"|"bypass_permissions"};
      if(body.mode==="bypass_permissions" && (!body.activationToken || !body.sessionId)) { sendContractError(res,403,"bypass_activation_invalid","Invalid activation token"); return; }
      const owner=body.sessionId?sessionFor(body.sessionId,false):null;
      if (!owner) { sendContractError(res, body.mode==="bypass_permissions"?403:404, body.mode==="bypass_permissions"?"bypass_activation_invalid":"session_not_found", body.mode==="bypass_permissions"?"Invalid activation token":"Session not found"); return; }
      try { sendJson(res,200,await owner.setPermissionMode(body.mode ?? "workspace",body.activationToken)); } catch(e) { const code=(e as any)?.code??"invalid_policy"; sendContractError(res,code.startsWith("bypass_")?403:code==="run_active"?409:400,code,e instanceof Error?e.message:"Invalid permission mode",code==="run_active"?{activeRunId:owner.getActiveRunId()}:{}); } return;
    }

    if (method === "POST" && url.pathname === "/api/workspace") {
      const body = JSON.parse((await readBody(req)) || "{}") as { path?: string };
      if (!body.path) {
        sendJson(res, 400, { error: "path required" });
        return;
      }
      const state = await session.openWorkspace(body.path);
      sendState(res, origin, state);
      return;
    }

    if (method === "POST" && url.pathname === "/api/pick-folder") {
      const picked = await pickFolderNative();
      if (!picked) {
        sendJson(res, 200, { cancelled: true, path: null });
        return;
      }
      sendJson(res, 200, { cancelled: false, path: picked });
      return;
    }

    if (method === "GET" && url.pathname === "/api/workspace/files") {
      const st = session.getState();
      if (!st.workspace) {
        sendJson(res, 400, { error: "no workspace open" });
        return;
      }
      const files = await listWorkspaceFiles(st.workspace);
      sendJson(res, 200, { files });
      return;
    }

    if (method === "GET" && url.pathname === "/api/workspace/read") {
      const rel = url.searchParams.get("path")?.trim();
      const st = session.getState();
      if (!st.workspace) {
        sendJson(res, 400, { error: "no workspace open" });
        return;
      }
      if (!rel) {
        sendJson(res, 400, { error: "path required" });
        return;
      }
      try {
        const target = await resolveConfinedTarget({ workspace: st.workspace, target: rel, kind: "read" });
        const verified = await target.recheck();
        const text = await fs.promises.readFile(verified.canonicalPath, "utf8");
        sendJson(res, 200, {
          path: target.path,
          content: text.slice(0, 120_000),
          truncated: text.length > 120_000,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        sendJson(res, message === "outside_workspace" ? 400 : 404, {
          error: message === "outside_workspace" ? "path escapes workspace" : message,
        });
      }
      return;
    }

    if (method === "GET" && url.pathname === "/api/workspace/branch") {
      const q = url.searchParams.get("path");
      const st = session.getState();
      const target = q?.trim() || st.workspace;
      if (!target) {
        sendJson(res, 400, { error: "no path" });
        return;
      }
      const branch = await getGitBranch(target);
      sendJson(res, 200, { path: target, branch });
      return;
    }

    if (method === "POST" && url.pathname === "/api/workspace/branches") {
      const body = JSON.parse((await readBody(req)) || "{}") as {
        paths?: string[];
      };
      const paths = Array.isArray(body.paths) ? body.paths : [];
      const branches: Record<string, string | null> = {};
      await Promise.all(
        paths.slice(0, 30).map(async (p) => {
          branches[p] = await getGitBranch(p);
        }),
      );
      sendJson(res, 200, { branches });
      return;
    }

    if (method === "POST" && url.pathname === "/api/test-connection") {
      const cfg = loadConfig();
      const st = session.getState();
      const { token, source } = await resolveApiKeyAsync(cfg);
      let probe: { ok: boolean; status?: number; detail?: string } = {
        ok: false,
        detail: "no credential",
      };
      if (token) {
        try {
          const r = await fetch("https://api.x.ai/v1/models", {
            headers: { Authorization: `Bearer ${token}` },
          });
          probe = {
            ok: r.ok,
            status: r.status,
            detail: r.ok ? "models endpoint reachable" : (await r.text()).slice(0, 200),
          };
        } catch (e) {
          probe = {
            ok: false,
            detail: e instanceof Error ? e.message : String(e),
          };
        }
      }
      sendJson(res, 200, {
        hostOk: true,
        authMode: st.authMode,
        authSource: source,
        hasCredential: Boolean(token),
        model: st.model,
        probe,
      });
      return;
    }

    if (method === "POST" && url.pathname === "/api/open-logs") {
      const dir = logsDir();
      try {
        if (process.platform === "win32") {
          spawn("explorer", [dir], { detached: true, stdio: "ignore" }).unref();
        } else {
          spawn("xdg-open", [dir], { detached: true, stdio: "ignore" }).unref();
        }
        sendJson(res, 200, { ok: true, path: dir });
      } catch (e) {
        sendJson(res, 500, {
          error: e instanceof Error ? e.message : String(e),
          path: dir,
        });
      }
      return;
    }

    if (method === "GET" && url.pathname === "/api/logs") {
      const tails = readLogTail();
      sendJson(res, 200, {
        ok: true,
        dir: logsDir(),
        hostPath: tails.hostPath,
        clientPath: tails.clientPath,
        host: tails.host,
        client: tails.client,
      });
      return;
    }

    if (method === "POST" && url.pathname === "/api/client-log") {
      const body = JSON.parse((await readBody(req)) || "{}") as {
        level?: "info" | "warn" | "error" | "debug";
        message?: string;
        meta?: Record<string, unknown>;
      };
      const level = body.level ?? "info";
      const message = (body.message ?? "").slice(0, 4000);
      if (!message) {
        sendJson(res, 400, { error: "message required" });
        return;
      }
      clientLog(level, message, body.meta);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (method === "POST" && url.pathname === "/api/export-diagnostics") {
      const body = JSON.parse((await readBody(req)) || "{}") as {
        markdown?: string;
        openFolder?: boolean;
      };
      const tails = readLogTail();
      const st = session.getState();
      const clientMd = (body.markdown ?? "").trim();
      const md = [
        "# Grok Code Shell — session diagnostics",
        "",
        `Exported: ${new Date().toISOString()}`,
        "",
        "## Host state",
        "```json",
        JSON.stringify(
          {
            workspace: st.workspace,
            workspaceName: st.workspaceName,
            authMode: st.authMode,
            authSource: st.authSource,
            hasApiKey: st.hasApiKey,
            model: st.model,
            connected: st.connected,
            busy: st.busy,
            sessionId: st.sessionId,
            shellAllowlist: st.shellAllowlist,
            mode: st.mode,
            effort: st.effort,
            appliedEffort: st.appliedEffort,
            appliedModel: st.appliedModel,
            chatRoot: st.chatRoot,
            recent: st.recent,
          },
          null,
          2,
        ),
        "```",
        "",
        "## Host log (tail)",
        "```",
        tails.host || "(empty)",
        "```",
        "",
        "## Client log (tail)",
        "```",
        tails.client || "(empty)",
        "```",
        "",
        clientMd
          ? ["## Client session bundle", "", clientMd, ""].join("\n")
          : "",
      ]
        .filter(Boolean)
        .join("\n");
      const written = writeDiagnosticsBundle(md);
      log("info", "diagnostics exported", { path: written.path });
      if (body.openFolder !== false) {
        try {
          if (process.platform === "win32") {
            spawn("explorer", ["/select,", written.path], {
              detached: true,
              stdio: "ignore",
            }).unref();
          } else {
            spawn("xdg-open", [written.dir], {
              detached: true,
              stdio: "ignore",
            }).unref();
          }
        } catch {
          /* ignore open failures */
        }
      }
      sendJson(res, 200, {
        ok: true,
        path: written.path,
        dir: written.dir,
        markdown: md,
      });
      return;
    }

    if (method === "POST" && url.pathname === "/api/settings") {
      const body = JSON.parse((await readBody(req)) || "{}") as {
        apiKey?: string;
        model?: string;
        clearKey?: boolean;
          shellAllowlist?: boolean;
          sessionId?: string;
          runId?: string;
          cursors?: Array<{sessionId:string;runId:string;afterEventSeq:number}>;
        mode?: "chat" | "code";
        effort?: "auto" | "fast" | "expert" | "heavy";
        agentId?: string;
      };
      if (typeof body.agentId === "string" && body.agentId.trim()) {
        try {
          const state = session.setAgentId(body.agentId.trim());
          // Still apply other settings if present
          const { agentId: _a, ...rest } = body;
          if (
            rest.apiKey !== undefined ||
            rest.model !== undefined ||
            rest.clearKey ||
            rest.shellAllowlist !== undefined ||
            rest.effort !== undefined ||
            rest.mode !== undefined
          ) {
            sendState(res, origin, session.updateSettings(rest));
          } else {
            sendState(res, origin, state);
          }
        } catch (e) {
          sendJson(res, 400, {
            error: e instanceof Error ? e.message : String(e),
          });
        }
        return;
      }
      const state = session.updateSettings(body);
      sendState(res, origin, state);
      return;
    }

    if (method === "GET" && url.pathname === "/api/agents") {
      sendJson(res, 200, {
        agents: session.listAgents(),
        active: session.getAgentInfo(),
      });
      return;
    }

    if (method === "GET" && url.pathname === "/api/connectors") {
      sendJson(res, 200, { connectors: listConnectors() });
      return;
    }

    if (method === "POST" && url.pathname === "/api/connectors/token") {
      const body = JSON.parse((await readBody(req)) || "{}") as {
        id?: string;
        token?: string | null;
      };
      if (!body.id) {
        sendJson(res, 400, { error: "id required" });
        return;
      }
      const connectors = setConnectorToken(body.id, body.token ?? null);
      sendJson(res, 200, { connectors });
      return;
    }

    if (method === "POST" && url.pathname === "/api/connectors/test") {
      const body = JSON.parse((await readBody(req)) || "{}") as { id?: string };
      if (!body.id) {
        sendJson(res, 400, { error: "id required" });
        return;
      }
      const result = await testConnector(body.id);
      sendJson(res, 200, {
        ...result,
        connectors: listConnectors(),
      });
      return;
    }

    if (method === "GET" && url.pathname === "/api/policy") {
      const { loadPolicy } = await import("./policy.js");
      sendJson(res, 200, { policy: loadPolicy() });
      return;
    }

    if (method === "POST" && url.pathname === "/api/policy") {
      const body = JSON.parse((await readBody(req)) || "{}") as Record<
        string,
        unknown
      >;
      const { mergePolicyPatch } = await import("./policy.js");
      const policy = mergePolicyPatch(body as Parameters<typeof mergePolicyPatch>[0]);
      sendJson(res, 200, { policy });
      return;
    }

    if (method === "GET" && url.pathname === "/api/audit-path") {
      const { auditLogPath } = await import("./audit.js");
      sendJson(res, 200, { path: auditLogPath() });
      return;
    }

    if (method === "POST" && url.pathname === "/api/mode") {
      const body = JSON.parse((await readBody(req)) || "{}") as {
        mode?: "chat" | "code";
      };
      if (body.mode !== "chat" && body.mode !== "code") {
        sendJson(res, 400, { error: "mode must be chat or code" });
        return;
      }
      const state = await session.setMode(body.mode);
      sendState(res, origin, state);
      return;
    }

    if (method === "POST" && url.pathname === "/api/effort") {
      const body = JSON.parse((await readBody(req)) || "{}") as {
        effort?: "auto" | "fast" | "expert" | "heavy";
      };
      try {
        if (!body.effort) throw new Error("effort required");
        const state = session.setEffort(body.effort);
        sendState(res, origin, state);
      } catch (e) {
        sendJson(res, 400, {
          error: e instanceof Error ? e.message : String(e),
        });
      }
      return;
    }

    if (method === "POST" && url.pathname === "/api/plan-engagement") {
      const body = JSON.parse((await readBody(req)) || "{}") as { engaged?: boolean; sessionId?: string };
      const owner = sessionFor(body.sessionId) || session;
      try {
        if (typeof body.engaged !== "boolean") throw Object.assign(new Error("engaged required"), { code: "invalid_request" });
        const state = owner.setPlanEngagement(body.engaged);
        sendState(res, origin, state);
      } catch (e) {
        const code = (e as { code?: string })?.code ?? "invalid_request";
        const status = code === "plan_engagement_unvouched" ? 409 : code === "plan_not_applicable" ? 400 : 400;
        sendContractError(res, status, code, e instanceof Error ? e.message : String(e));
      }
      return;
    }

    if (method === "POST" && url.pathname === "/api/chat-root") {
      const body = JSON.parse((await readBody(req)) || "{}") as {
        path?: string | null;
      };
      try {
        const state = await session.setChatRoot(
          body.path === undefined ? null : body.path,
        );
        sendState(res, origin, state);
      } catch (e) {
        sendJson(res, 400, {
          error: e instanceof Error ? e.message : String(e),
        });
      }
      return;
    }

    if (method === "POST" && url.pathname === "/api/prompt") {
      const body = JSON.parse((await readBody(req)) || "{}") as {
        sessionId?: string;
        text?: string;
        effort?: "auto" | "fast" | "expert" | "heavy";
        history?: Array<{
          role: "user" | "assistant" | "system";
          content: string;
        }>;
      };
      if (!body.text?.trim()) {
        sendContractError(res,400,"invalid_request","text required");
        return;
      }
      const legacyPrompt = !body.sessionId;
      const ownedSession = sessionFor(body.sessionId) || session;
      if (body.sessionId && !ownedSession) { sendContractError(res,400,"invalid_request","invalid sessionId"); return; }
      try {
        const run = await ownedSession.prompt(body.text.trim(), body.effort, {
          history: Array.isArray(body.history) ? body.history.slice(-40) : undefined,
          originKey: typeof origin === "string" ? origin : null,
          clientSessionId: body.sessionId,
        });
        sendJson(res, legacyPrompt ? 200 : 202, legacyPrompt ? { ok: true } : { accepted: true, run });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        const code = (e as { code?: string })?.code;
        if (code === "plan_engagement_unvouched" || code === "plan_decision_pending") {
          sendContractError(res, 409, code, message);
          return;
        }
        const busy = code === "run_active" || /busy/i.test(message);
        sendContractError(res,busy?409:400,busy?"run_active":"invalid_request",message, busy ? { activeRunId: ownedSession.getActiveRunId() } : {});
      }
      return;
    }

    if (method === "POST" && url.pathname === "/api/cancel") {
      const body = JSON.parse((await readBody(req)) || "{}") as {sessionId?:string;runId?:string};
      if (!body.sessionId || !body.runId) { await session.cancel(); sendJson(res, 200, { ok: true }); return; }
      const ownedSession = sessionFor(body.sessionId, false);
      if (!ownedSession) { sendContractError(res,404,"run_not_found","Run not found"); return; }
      try { const run = await ownedSession.cancelRun(body.runId, body.sessionId); sendJson(res, 202, { accepted:true, run }); }
      catch (e) { const code = e instanceof Error && (e as any).code === "run_terminal" ? "run_terminal" : "run_not_found"; sendContractError(res, code === "run_terminal" ? 409 : 404, code, e instanceof Error ? e.message : "Run not found"); }
      return;
    }

    if (method === "POST" && url.pathname === "/api/restart") {
      const state = await session.restartAgent();
      sendState(res, origin, state);
      return;
    }

    if (method === "POST" && url.pathname === "/api/oauth/start") {
      const start = await session.startOAuth();
      sendJson(res, 200, {
        user_code: start.user_code,
        verification_uri: start.verification_uri,
        verification_uri_complete: start.verification_uri_complete,
        expires_in: start.expires_in,
        interval: start.interval,
      });
      return;
    }

    if (method === "POST" && url.pathname === "/api/oauth/cancel") {
      session.cancelOAuth();
      sendJson(res, 200, { ok: true });
      return;
    }

    if (method === "POST" && url.pathname === "/api/oauth/logout") {
      const state = session.logoutOAuth();
      sendState(res, origin, state);
      return;
    }

    if (method === "POST" && url.pathname === "/api/permission") {
      const body = JSON.parse((await readBody(req)) || "{}") as {
        id?: string; sessionId?:string; runId?:string; requestId?:string; invocationId?:string;
        decision?: PermissionDecision;
      };
      if (!body.sessionId || !body.runId || !body.requestId || !body.invocationId || !body.decision) {
        sendContractError(res,400,"invalid_request","decision ownership fields required");
        return;
      }
      const owner=sessionFor(body.sessionId,false) ?? (session.getState().session?.sessionId===body.sessionId?session:null); if(!owner){sendContractError(res,404,"run_not_found","Run not found");return;}
      try {
        const run=owner.getRun(body.runId); if(!run || run.sessionId!==body.sessionId) throw Object.assign(new Error("no pending permission"),{code:"decision_not_found"});
        const settled = await owner.permission(body.id ?? body.requestId, body.decision,{sessionId:run.sessionId,runId:body.runId,connectionGeneration:run.connectionGeneration}, body.invocationId);
        sendJson(res, 200, { ok: true, request:{requestId:body.requestId,invocationId:body.invocationId,kind:"permission",status:settled,title:"Permission",detail:"",expiresAt:new Date().toISOString(),policy:run.policy} });
      } catch (e) {
        const code=(e as any)?.code??"decision_not_found"; sendContractError(res,(code==="run_terminal"||code==="request_expired")?409:404,code,"no pending permission");
      }
      return;
    }

    if (method === "POST" && url.pathname === "/api/plan") {
      const body = JSON.parse((await readBody(req)) || "{}") as {
        sessionId?: string; runId?: string; requestId?: string; invocationId?: string;
        connectionGeneration?: number; action?: "accept" | "keep_planning";
      };
      if (!body.sessionId || !body.runId || !body.requestId || !body.invocationId || !Number.isInteger(body.connectionGeneration) || (body.action !== "accept" && body.action !== "keep_planning")) {
        sendContractError(res,400,"invalid_request","plan ownership fields required");
        return;
      }
      const owner=sessionFor(body.sessionId,false) ?? (session.getState().session?.sessionId===body.sessionId?session:null); if(!owner){sendContractError(res,404,"run_not_found","Run not found");return;}
      try {
        const settled = await owner.planAction(body.requestId, body.action, {
          sessionId: body.sessionId,
          runId: body.runId,
          connectionGeneration: body.connectionGeneration!,
        }, body.invocationId);
        const run = owner.getRun(body.runId, body.sessionId);
        sendJson(res, 200, { ok: true, request:{requestId:body.requestId,invocationId:body.invocationId,kind:"plan",status:settled,title:"Plan",detail:"",expiresAt:null,policy:run?.policy??null} });
      } catch (e) {
        const code=(e as {code?:string})?.code??"decision_not_found"; sendContractError(res,(code==="run_terminal"||code==="request_expired")?409:404,code,e instanceof Error?e.message:"no pending plan");
      }
      return;
    }

    if (method === "POST" && url.pathname === "/api/diff") {
      const body = JSON.parse((await readBody(req)) || "{}") as {
        id?: string; sessionId?:string; runId?:string; requestId?:string; invocationId?:string; editId?:string;
        action?: "accept" | "reject";
      };
      if (!body.sessionId || !body.runId || !body.requestId || !body.invocationId || !body.editId || !body.action) {
        sendContractError(res,400,"invalid_request","edit ownership fields required");
        return;
      }
      const owner=sessionFor(body.sessionId,false) ?? (session.getState().session?.sessionId===body.sessionId?session:null); if(!owner){sendContractError(res,404,"run_not_found","Run not found");return;}
      try {
        const run=owner.getRun(body.runId); if(!run || run.sessionId!==body.sessionId) throw Object.assign(new Error("no pending edit"),{code:"decision_not_found"});
        const settled = await owner.diffAction(body.editId, body.action,{sessionId:run.sessionId,runId:body.runId,connectionGeneration:run.connectionGeneration}, body.invocationId);
        const prior = await owner.findActivityForEdit(body.runId, body.sessionId, body.editId, body.invocationId);
        const activity = retainActivityAfterDiff(prior, {
          editId: body.editId,
          invocationId: body.invocationId,
          action: body.action,
          policy: run.policy,
        });
        await owner.appendActivity(body.runId, activity);
        sendJson(res, 200, { ok: true, request:{requestId:body.requestId,invocationId:body.invocationId,kind:"diff",status:settled,title:"Edit",detail:"",expiresAt:new Date().toISOString(),policy:run.policy}, activity });
      } catch (e) {
        const code=(e as any)?.code??"decision_not_found"; sendContractError(res,(code==="run_terminal"||code==="request_expired")?409:404,code,"no pending edit");
      }
      return;
    }

    if (method === "GET" && url.pathname.startsWith("/api/runs/")) {
      const runId = decodeURIComponent(url.pathname.slice("/api/runs/".length));
      const sid = url.searchParams.get("sessionId"); const afterRaw = url.searchParams.get("after") ?? "0"; const after = Number(afterRaw);
      if (!sid || !runId || !Number.isInteger(after) || after < 0) { sendContractError(res,400,"invalid_request","sessionId and valid after are required"); return; }
      // Rehydrate a stable client session on first replay after host restart;
      // the AgentSession constructor hydrates its durable journal before this
      // route returns, allowing orphan terminalization to be observed before
      // a new prompt is admitted.
      const ownedSession = sessionFor(sid, true); if (!ownedSession) { sendContractError(res,404,"run_not_found","Run not found"); return; }
      try { const result = await ownedSession.replayRun(runId, sid, after); sendJson(res,200,result); }
      catch { sendContractError(res,404,"run_not_found","Run not found"); }
      return;
    }

    if (method === "POST" && url.pathname === "/api/edit-recovery") {
      const body=JSON.parse((await readBody(req))||"{}") as {sessionId?:string;runId?:string;editId?:string};
      if(!body.sessionId||!body.runId||!body.editId){sendContractError(res,400,"invalid_request","recovery ownership fields required");return;}
      const owner=sessionFor(body.sessionId,false); if(!owner||!owner.getRun(body.runId,body.sessionId)){sendContractError(res,404,"edit_not_found","Edit not found");return;}
      try {
        const result=await editJournal.revert(body.editId,{runId:body.runId});
        const run=owner.getRun(body.runId,body.sessionId)!;
        const prior=await owner.findActivityForEdit(body.runId,body.sessionId,body.editId,result.entry.invocationId);
        const activity=retainActivityAfterRecovery(prior,{
          editId:body.editId,
          status:result.ok?"reverted":"conflict",
          fallbackDiff:typeof result.entry.diff==="string"?result.entry.diff:null,
          policy:run.policy,
        });
        await owner.appendActivity(body.runId,activity);
        if(!result.ok){sendContractError(res,409,"recovery_conflict","Edit not reverted",{activity});}
        else sendJson(res,200,{ok:true,activity});
      } catch (e) { const code=(e as any)?.code; if(code==="recovery_not_owned"){sendContractError(res,409,"recovery_unavailable","Edit is not available for this run");} else sendContractError(res,404,"edit_not_found","Edit not found"); }
      return;
    }

    // Static shell build (optional)
    if (method === "GET") {
      const shellDist = path.resolve(__dirname, "../../shell/dist");
      let filePath = path.join(
        shellDist,
        url.pathname === "/" ? "index.html" : url.pathname,
      );
      if (!filePath.startsWith(shellDist)) {
        sendJson(res, 403, { error: "forbidden" });
        return;
      }
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath);
        const types: Record<string, string> = {
          ".html": "text/html",
          ".js": "text/javascript",
          ".css": "text/css",
          ".svg": "image/svg+xml",
          ".json": "application/json",
        };
        res.writeHead(200, {
          "Content-Type": types[ext] || "application/octet-stream",
        });
        fs.createReadStream(filePath).pipe(res);
        return;
      }
      if (fs.existsSync(path.join(shellDist, "index.html"))) {
        res.writeHead(200, { "Content-Type": "text/html" });
        fs.createReadStream(path.join(shellDist, "index.html")).pipe(res);
        return;
      }
    }

    sendJson(res, 404, { error: "not found" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log("error", "request failed", { path: url.pathname, message });
    sendJson(res, 500, { error: message });
  }
});

// GATE Z lockdown applies to the /ws upgrade too (INTERFACE_CONTRACT.md "Request lockdown" table):
// same origin allowlist, no Origin header still allowed (loopback tooling).
const wss = new WebSocketServer({
  server,
  path: "/ws",
  verifyClient: (info, callback) => {
    const wsOriginHeader = info.req.headers.origin;
    if (!isOriginAllowed(wsOriginHeader)) {
      log("warn", "origin refused", {
        origin: Array.isArray(wsOriginHeader) ? wsOriginHeader.join(", ") : (wsOriginHeader ?? ""),
        route: "/ws",
        method: "UPGRADE",
      });
      callback(false, 403, "origin not allowed");
      return;
    }
    callback(true);
  },
});

function wsSend(ws: WebSocket, obj: unknown): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

wss.on("connection", (ws, req) => {
  // priorConversations is per-requester (D1); capture this connection's Origin once and stamp
  // every `state` frame with it via the same `stampState` builder the HTTP routes use, so the
  // shell's WS-driven state reads never diverge from the HTTP read (a field present on HTTP and
  // missing on WS would flicker the not-found state on the first WS push after boot).
  const wsOrigin = typeof req.headers.origin === "string" ? req.headers.origin : null;
  const wsUrl = new URL(req.url || "/ws", `http://127.0.0.1:${PORT}`);
  const initialSessionId = wsUrl.searchParams.get("sessionId");
  const initialOwner = initialSessionId ? sessionFor(initialSessionId, false) : session;
  void (async () => {
    const owner = initialOwner ?? session;
    await owner.awaitReady();
    await owner.refreshWorkspacePolicy();
    await owner.refreshProjectInstructionsPresence();
    wsSend(ws, {
      schemaVersion: 1,
      type: "state",
      state: stampState(owner.getState(), wsOrigin),
    });
  })();
  const subscriptions = new Map<string,()=>void>();
  wsBindings.set(ws, subscriptions);
  const subscribe = (sid:string|null|undefined) => {
    const owner = sid ? sessionFor(sid, false) : session;
    if (!owner) return;
    const key = sid ?? "__legacy";
    if (subscriptions.has(key)) return;
    subscriptions.set(key, owner.on((event) => {
    if ((event as { type?: string }).type === "state") {
      const e = event as { type: "state"; state: unknown };
      wsSend(ws, {
        schemaVersion: 1,
        type: "state",
        state: stampState(e.state as Record<string, unknown>, wsOrigin),
      });
      return;
    }
    wsSend(ws, event);
    }));
  };
  subscribe(initialSessionId);

  ws.on("message", (data) => {
    void (async () => {
      let msg: {
        type?: string;
        path?: string;
        text?: string;
        id?: string;
        decision?: PermissionDecision;
        action?: "accept" | "reject";
        apiKey?: string;
        model?: string;
        clearKey?: boolean;
        shellAllowlist?: boolean;
        sessionId?: string;
        runId?: string;
        requestId?: string;
        invocationId?: string;
        editId?: string;
        connectionGeneration?: number;
        cursors?: Array<{sessionId:string;runId:string;afterEventSeq:number}>;
      };
      try {
        msg = JSON.parse(String(data)) as typeof msg;
      } catch {
        log("warn", "ws bad_json");
        wsSend(ws, { type: "error", code: "bad_json", message: "Invalid JSON" });
        return;
      }
      try {
        switch (msg.type) {
          case "get_state":
            await session.refreshProjectInstructionsPresence();
            wsSend(ws, { schemaVersion: 1, type: "state", state: stampState(session.getState(), wsOrigin) });
            break;
          case "open_workspace":
            if (!msg.path) throw new Error("path required");
            await session.openWorkspace(msg.path);
            break;
          case "prompt":
            if (!msg.text) throw new Error("text required");
            { const owned = sessionFor(msg.sessionId) || session; subscribe(msg.sessionId); await owned.prompt(msg.text, undefined, { originKey: wsOrigin, clientSessionId: msg.sessionId }); }
            break;
          case "cancel":
            if (msg.sessionId && msg.runId) { const owned = sessionFor(msg.sessionId, false); if (!owned) throw new Error("run not found"); await owned.cancelRun(msg.runId, msg.sessionId); }
            else await session.cancel();
            break;
          case "resume_runs":
            for (const cursor of msg.cursors ?? []) { const owned = sessionFor(cursor.sessionId, false); if (!owned) continue; try { const replay = await owned.replayRun(cursor.runId, cursor.sessionId, cursor.afterEventSeq); for (const event of replay.events) wsSend(ws, event); } catch { /* stale cursor is isolated */ } }
            break;
          case "restart":
            await session.restartAgent();
            break;
          case "permission":
            if (!msg.id || !msg.decision || !msg.sessionId || !msg.runId || !msg.requestId || !msg.invocationId || msg.connectionGeneration === undefined) throw Object.assign(new Error("owned permission fields required; use HTTP route"),{code:"ownership_required"});
            { const owned=sessionFor(msg.sessionId,false); if(!owned) throw new Error("session not found"); await owned.permission(msg.id,msg.decision,{sessionId:msg.sessionId,runId:msg.runId,connectionGeneration:msg.connectionGeneration},msg.invocationId); }
            break;
          case "diff":
            if (!msg.id || !msg.action || !msg.sessionId || !msg.runId || !msg.requestId || !msg.invocationId || !msg.editId || msg.connectionGeneration === undefined) throw Object.assign(new Error("owned diff fields required; use HTTP route"),{code:"ownership_required"});
            { const owned=sessionFor(msg.sessionId,false); if(!owned) throw new Error("session not found"); await owned.diffAction(msg.id,msg.action,{sessionId:msg.sessionId,runId:msg.runId,connectionGeneration:msg.connectionGeneration},msg.invocationId); }
            break;
          case "set_settings":
            session.updateSettings({
              apiKey: msg.apiKey,
              model: msg.model,
              clearKey: msg.clearKey,
              shellAllowlist: msg.shellAllowlist,
            });
            break;
          case "oauth_start":
            await session.startOAuth();
            break;
          case "oauth_cancel":
            session.cancelOAuth();
            break;
          case "oauth_logout":
            session.logoutOAuth();
            break;
          default:
            wsSend(ws, {
              type: "error",
              code: "unknown_type",
              message: `Unknown message type: ${msg.type}`,
            });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log("error", "ws request_failed", { message, type: msg.type });
        wsSend(ws, { type: "error", code: "request_failed", message });
      }
    })();
  });

  ws.on("close", () => { for (const off of subscriptions.values()) off(); wsBindings.delete(ws); });
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    log("error", "port in use — another host owns this port", {
      port: PORT,
      pid: process.pid,
    });
    console.error(
      `Port ${PORT} already in use. Stop the other Grok host (or the process on that port) and retry.`,
    );
    process.exit(1);
  }
  log("error", "server error", { message: err.message, code: err.code });
  process.exit(1);
});

server.listen(PORT, "127.0.0.1", () => {
  log("info", `host listening on http://127.0.0.1:${PORT}`, {
    pid: process.pid,
    owned: true,
  });
  console.log(
    `Forge host [${CHANNEL.label}] http://127.0.0.1:${PORT} data=${CHANNEL.dataDir} (pid ${process.pid})`,
  );
  console.log(`WebSocket ws://127.0.0.1:${PORT}/ws`);
  console.log(`Log file ${logPath()}`);
});

let shuttingDown = false;
async function gracefulShutdown(signal: string) {
  if (shuttingDown) return; shuttingDown = true;
  log("info", "host shutting down", { signal });
  await Promise.all([session, ...sessionRegistry.values()].map(s => s.shutdown().catch(() => undefined)));
  await new Promise<void>(resolve => server.close(() => resolve()));
  process.exit(0);
}
process.once("SIGINT", () => { void gracefulShutdown("SIGINT"); });
process.once("SIGTERM", () => { void gracefulShutdown("SIGTERM"); });
