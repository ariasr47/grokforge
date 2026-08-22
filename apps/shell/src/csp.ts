/** Channel host ladders (must match Rust `ladder()` in src-tauri). */
export const PROD_HOST_PORTS = [
  8787, 8800, 8801, 8802, 8803, 8804, 8805, 8806,
] as const;
export const DEV_HOST_PORTS = [
  8788, 8810, 8811, 8812, 8813, 8814, 8815, 8816,
] as const;

const UPDATER_CONNECT = [
  "https://github.com",
  "https://objects.githubusercontent.com",
  "https://release-assets.githubusercontent.com",
];

function loopback(ports: readonly number[]): string[] {
  return ports.flatMap((p) => [`http://127.0.0.1:${p}`, `ws://127.0.0.1:${p}`]);
}

export function connectSrc(kind: "prod" | "dev"): string {
  const ports = kind === "dev" ? DEV_HOST_PORTS : PROD_HOST_PORTS;
  const extra =
    kind === "dev"
      ? [
          "http://localhost:5174",
          "ws://localhost:5174",
          "http://127.0.0.1:5174",
          "ws://127.0.0.1:5174",
        ]
      : [];
  return [
    "'self'",
    "ipc:",
    "http://ipc.localhost",
    ...loopback(ports),
    ...extra,
    ...UPDATER_CONNECT,
  ].join(" ");
}
