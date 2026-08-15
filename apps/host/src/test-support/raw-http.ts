/**
 * Minimal raw HTTP client for host-level replay tests. `fetch` cannot express the forged-origin
 * shapes AC13/AC14 need to replay (a literal `null` string, a duplicated `Origin` header) because
 * browsers/undici normalize or forbid them; `node:http` gives full control over the wire.
 */
import http from "node:http";

export interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

export function rawRequest(
  baseUrl: string,
  method: string,
  urlPath: string,
  opts: { headers?: Record<string, string | string[]>; body?: string } = {},
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const u = new URL(urlPath, baseUrl);
    const req = http.request(
      {
        method,
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        headers: opts.headers,
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (c: string) => (data += c));
        res.on("end", () => {
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: data });
        });
      },
    );
    req.on("error", reject);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

/** Asserts no header on the response is `access-control-allow-origin: *` (GATE Z: never again). */
export function hasWildcardCors(res: RawResponse): boolean {
  const v = res.headers["access-control-allow-origin"];
  const val = Array.isArray(v) ? v.join(",") : v;
  return val === "*";
}
