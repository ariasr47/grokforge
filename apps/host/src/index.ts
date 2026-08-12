import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { AgentSession } from "./session.js";
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
import { spawn } from "node:child_process";
import { resolveApiKeyAsync, loadConfig } from "./config.js";
import { getGitBranch } from "./git.js";
import {
  hydrateConnectorEnv,
  listConnectors,
  setConnectorToken,
  testConnector,
} from "./connectors.js";
import { channelMeta, defaultPort } from "./channel.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = defaultPort();
const CHANNEL = channelMeta();
const session = new AgentSession();
hydrateConnectorEnv();

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(data);
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

  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  try {
    if (method === "GET" && url.pathname === "/api/health") {
      sendJson(res, 200, {
        ok: true,
        service: "grokforge-host",
        version: "0.3.1",
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
      sendJson(res, 200, session.getState());
      return;
    }

    if (method === "POST" && url.pathname === "/api/workspace") {
      const body = JSON.parse((await readBody(req)) || "{}") as { path?: string };
      if (!body.path) {
        sendJson(res, 400, { error: "path required" });
        return;
      }
      const state = await session.openWorkspace(body.path);
      sendJson(res, 200, state);
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
        const root = path.resolve(st.workspace);
        const target = path.resolve(root, rel);
        const under = (abs: string) => {
          const a =
            process.platform === "win32" ? abs.toLowerCase() : abs;
          const r =
            process.platform === "win32" ? root.toLowerCase() : root;
          return (
            a === r ||
            a.startsWith(r + path.sep) ||
            a.startsWith(r + "/")
          );
        };
        if (!under(target)) {
          // Also allow absolute paths that stay under workspace
          const abs = path.resolve(rel);
          if (!under(abs)) {
            sendJson(res, 400, { error: "path escapes workspace" });
            return;
          }
          const text = await fs.promises.readFile(abs, "utf8");
          sendJson(res, 200, {
            path: abs,
            content: text.slice(0, 120_000),
            truncated: text.length > 120_000,
          });
          return;
        }
        const text = await fs.promises.readFile(target, "utf8");
        sendJson(res, 200, {
          path: target,
          content: text.slice(0, 120_000),
          truncated: text.length > 120_000,
        });
      } catch (e) {
        sendJson(res, 404, {
          error: e instanceof Error ? e.message : String(e),
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
            sendJson(res, 200, session.updateSettings(rest));
          } else {
            sendJson(res, 200, state);
          }
        } catch (e) {
          sendJson(res, 400, {
            error: e instanceof Error ? e.message : String(e),
          });
        }
        return;
      }
      const state = session.updateSettings(body);
      sendJson(res, 200, state);
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
      sendJson(res, 200, state);
      return;
    }

    /** Warm agent for a mode without switching the live UI mode (hover prefetch). */
    if (method === "POST" && url.pathname === "/api/prefetch-mode") {
      const body = JSON.parse((await readBody(req)) || "{}") as {
        mode?: "chat" | "code";
      };
      if (body.mode !== "chat" && body.mode !== "code") {
        sendJson(res, 400, { error: "mode must be chat or code" });
        return;
      }
      const result = await session.prefetchMode(body.mode);
      sendJson(res, 200, result);
      return;
    }

    if (method === "POST" && url.pathname === "/api/effort") {
      const body = JSON.parse((await readBody(req)) || "{}") as {
        effort?: "auto" | "fast" | "expert" | "heavy";
      };
      try {
        if (!body.effort) throw new Error("effort required");
        const state = session.setEffort(body.effort);
        sendJson(res, 200, state);
      } catch (e) {
        sendJson(res, 400, {
          error: e instanceof Error ? e.message : String(e),
        });
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
        sendJson(res, 200, state);
      } catch (e) {
        sendJson(res, 400, {
          error: e instanceof Error ? e.message : String(e),
        });
      }
      return;
    }

    if (method === "POST" && url.pathname === "/api/prompt") {
      const body = JSON.parse((await readBody(req)) || "{}") as {
        text?: string;
        effort?: "auto" | "fast" | "expert" | "heavy";
        history?: Array<{
          role: "user" | "assistant" | "system";
          content: string;
        }>;
      };
      if (!body.text?.trim()) {
        sendJson(res, 400, { error: "text required" });
        return;
      }
      try {
        await session.prompt(body.text.trim(), body.effort, {
          history: Array.isArray(body.history) ? body.history.slice(-40) : undefined,
        });
        sendJson(res, 200, { ok: true });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        const busy = /busy/i.test(message);
        sendJson(res, busy ? 409 : 400, { error: message });
      }
      return;
    }

    if (method === "POST" && url.pathname === "/api/cancel") {
      await session.cancel();
      sendJson(res, 200, { ok: true });
      return;
    }

    if (method === "POST" && url.pathname === "/api/restart") {
      const state = await session.restartAgent();
      sendJson(res, 200, state);
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
      sendJson(res, 200, state);
      return;
    }

    if (method === "POST" && url.pathname === "/api/permission") {
      const body = JSON.parse((await readBody(req)) || "{}") as {
        id?: string;
        decision?: PermissionDecision;
      };
      if (!body.id || !body.decision) {
        sendJson(res, 400, { error: "id and decision required" });
        return;
      }
      try {
        await session.permission(body.id, body.decision);
        sendJson(res, 200, { ok: true });
      } catch {
        sendJson(res, 404, { error: "no pending permission" });
      }
      return;
    }

    if (method === "POST" && url.pathname === "/api/diff") {
      const body = JSON.parse((await readBody(req)) || "{}") as {
        id?: string;
        action?: "accept" | "reject";
      };
      if (!body.id || !body.action) {
        sendJson(res, 400, { error: "id and action required" });
        return;
      }
      try {
        await session.diffAction(body.id, body.action);
        sendJson(res, 200, { ok: true });
      } catch {
        sendJson(res, 404, { error: "no pending edit" });
      }
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

const wss = new WebSocketServer({ server, path: "/ws" });

function wsSend(ws: WebSocket, obj: unknown): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

wss.on("connection", (ws) => {
  wsSend(ws, { type: "state", state: session.getState() });
  const off = session.on((event) => {
    wsSend(ws, event);
  });

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
            wsSend(ws, { type: "state", state: session.getState() });
            break;
          case "open_workspace":
            if (!msg.path) throw new Error("path required");
            await session.openWorkspace(msg.path);
            break;
          case "prompt":
            if (!msg.text) throw new Error("text required");
            await session.prompt(msg.text);
            break;
          case "cancel":
            await session.cancel();
            break;
          case "restart":
            await session.restartAgent();
            break;
          case "permission":
            if (!msg.id || !msg.decision) throw new Error("id and decision required");
            await session.permission(msg.id, msg.decision);
            break;
          case "diff":
            if (!msg.id || !msg.action) throw new Error("id and action required");
            await session.diffAction(msg.id, msg.action);
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

  ws.on("close", () => off());
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
