/**
 * xAI OAuth (device code + refresh) using the public Grok CLI client_id.
 * Discovery: https://auth.x.ai/.well-known/openid-configuration
 */
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./channel.js";
import { log } from "./log.js";

export const XAI_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
const DEVICE_URL = "https://auth.x.ai/oauth2/device/code";
const TOKEN_URL = "https://auth.x.ai/oauth2/token";
const SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "grok-cli:access",
  "api:access",
].join(" ");

export interface OAuthTokens {
  access_token: string;
  refresh_token?: string;
  expires_at: number; // epoch ms
  token_type?: string;
  scope?: string;
  obtained_at: number;
}

export interface DeviceStart {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
}

function oauthStorePath(): string {
  return path.join(dataDir(), "oauth.json");
}

export function loadOAuthTokens(): OAuthTokens | null {
  try {
    const raw = fs.readFileSync(oauthStorePath(), "utf8");
    const t = JSON.parse(raw) as OAuthTokens;
    if (!t.access_token) return null;
    return t;
  } catch {
    return null;
  }
}

export function saveOAuthTokens(tokens: OAuthTokens): void {
  const dir = path.dirname(oauthStorePath());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(oauthStorePath(), JSON.stringify(tokens, null, 2), "utf8");
}

export function clearOAuthTokens(): void {
  try {
    fs.unlinkSync(oauthStorePath());
  } catch {
    /* ignore */
  }
}

export async function startDeviceLogin(): Promise<DeviceStart> {
  const body = new URLSearchParams({
    client_id: XAI_CLIENT_ID,
    scope: SCOPES,
  });
  const res = await fetch(DEVICE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Device auth failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    device_code: string;
    user_code: string;
    verification_uri: string;
    verification_uri_complete?: string;
    expires_in: number;
    interval?: number;
  };
  log("info", "oauth device code started", { user_code: data.user_code });
  return {
    device_code: data.device_code,
    user_code: data.user_code,
    verification_uri: data.verification_uri,
    verification_uri_complete: data.verification_uri_complete,
    expires_in: data.expires_in,
    interval: data.interval ?? 5,
  };
}

export async function pollDeviceToken(
  deviceCode: string,
  intervalSec: number,
  signal?: AbortSignal,
): Promise<OAuthTokens> {
  const deadline = Date.now() + 15 * 60 * 1000;
  let interval = Math.max(3, intervalSec) * 1000;

  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error("OAuth cancelled");
    await sleep(interval, signal);

    const body = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: deviceCode,
      client_id: XAI_CLIENT_ID,
    });
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal,
    });
    const data = (await res.json()) as Record<string, unknown>;

    if (res.ok && typeof data.access_token === "string") {
      const expiresIn = Number(data.expires_in ?? 3600);
      const tokens: OAuthTokens = {
        access_token: data.access_token,
        refresh_token:
          typeof data.refresh_token === "string" ? data.refresh_token : undefined,
        expires_at: Date.now() + expiresIn * 1000,
        token_type: typeof data.token_type === "string" ? data.token_type : "Bearer",
        scope: typeof data.scope === "string" ? data.scope : undefined,
        obtained_at: Date.now(),
      };
      saveOAuthTokens(tokens);
      log("info", "oauth tokens saved");
      return tokens;
    }

    const err = String(data.error ?? "");
    if (err === "authorization_pending") continue;
    if (err === "slow_down") {
      interval += 2000;
      continue;
    }
    if (err === "expired_token" || err === "access_denied") {
      throw new Error(`OAuth ${err}`);
    }
    if (!res.ok) {
      throw new Error(
        `OAuth poll failed (${res.status}): ${JSON.stringify(data).slice(0, 300)}`,
      );
    }
  }
  throw new Error("OAuth timed out — restart Sign in with Grok");
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: XAI_CLIENT_ID,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok || typeof data.access_token !== "string") {
    const code = String(data.error ?? res.status);
    const err = new Error(`Token refresh failed: ${code}`);
    (err as Error & { code?: string }).code = "auth_expired";
    throw err;
  }
  const expiresIn = Number(data.expires_in ?? 3600);
  const tokens: OAuthTokens = {
    access_token: data.access_token,
    refresh_token:
      typeof data.refresh_token === "string"
        ? data.refresh_token
        : refreshToken,
    expires_at: Date.now() + expiresIn * 1000,
    token_type: typeof data.token_type === "string" ? data.token_type : "Bearer",
    scope: typeof data.scope === "string" ? data.scope : undefined,
    obtained_at: Date.now(),
  };
  saveOAuthTokens(tokens);
  return tokens;
}

/** Return a valid access token, refreshing if near expiry. */
export async function getValidAccessToken(): Promise<string | undefined> {
  let t = loadOAuthTokens();
  if (!t) return undefined;
  const skew = 60_000;
  if (t.expires_at - skew > Date.now()) return t.access_token;
  if (!t.refresh_token) return t.access_token; // try anyway
  try {
    t = await refreshAccessToken(t.refresh_token);
    return t.access_token;
  } catch (e) {
    log("warn", "oauth refresh failed", {
      message: e instanceof Error ? e.message : String(e),
    });
    return undefined;
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("cancelled"));
      return;
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new Error("cancelled"));
      },
      { once: true },
    );
  });
}
