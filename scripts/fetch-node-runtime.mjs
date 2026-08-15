#!/usr/bin/env node
/**
 * Fetch, SHA256-verify and stage the pinned Windows Node runtime (SPEC §2.1). Fails CLOSED on a
 * digest mismatch — an unverified binary must never ship in an unsigned installer.
 * Usage: node scripts/fetch-node-runtime.mjs
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pin = JSON.parse(fs.readFileSync(path.join(root, "scripts", "node-runtime.json"), "utf8"));

const outDir = path.join(root, "apps", "shell", "src-tauri", "resources", "runtime");
const nodeExe = path.join(outDir, "node.exe");
const licenseFile = path.join(outDir, "LICENSE-node.txt");
const sidecar = path.join(outDir, "node.exe.sha256");

function sha256File(file) {
  const buf = fs.readFileSync(file);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function alreadyGood() {
  // Skip re-download when the staged node.exe still hashes to what the sidecar recorded on the
  // previous successful run (SPEC §2.1: "repeat builds are fast but a tampered file is still
  // caught"). The sidecar records the extracted binary's own digest, not the vendor zip's — there
  // is no separate published checksum for the unpacked exe, only for the zip (verified on every
  // fresh download, before extraction, against `scripts/node-runtime.json`).
  if (!fs.existsSync(nodeExe) || !fs.existsSync(sidecar)) return false;
  const recorded = fs.readFileSync(sidecar, "utf8").trim();
  return sha256File(nodeExe) === recorded;
}

async function main() {
  if (alreadyGood()) {
    console.log(`[fetch-node-runtime] up to date (${pin.version} ${pin.arch}), skipping download`);
    return;
  }

  fs.mkdirSync(outDir, { recursive: true });
  const zipName = `node-${pin.version}-${pin.arch}.zip`;
  const url = `https://nodejs.org/dist/${pin.version}/${zipName}`;
  console.log(`[fetch-node-runtime] downloading ${url}`);

  const res = await fetch(url);
  if (!res.ok) {
    console.error(`[fetch-node-runtime] FAIL: download ${url} -> ${res.status}`);
    process.exit(1);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const digest = crypto.createHash("sha256").update(buf).digest("hex");
  if (digest !== pin.sha256) {
    console.error(
      `[fetch-node-runtime] FAIL: digest mismatch\n  expected ${pin.sha256}\n  actual   ${digest}`,
    );
    process.exit(1);
  }
  console.log(`[fetch-node-runtime] digest OK (${digest})`);

  const tmpZip = path.join(outDir, zipName);
  fs.writeFileSync(tmpZip, buf);
  try {
    // Windows ships bsdtar as tar.exe (System32) — used explicitly by absolute path because a
    // Git-for-Windows GNU tar earlier on PATH misparses a drive-letter colon ("C:\...") as a
    // remote-host archive spec ("host:file") and fails with "Cannot connect to C:". bsdtar has no
    // such legacy remote-tape syntax. No npm dependency needed to read a zip either way.
    const winTar = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
    const tarBin = fs.existsSync(winTar) ? winTar : "tar";
    execFileSync(tarBin, ["-xf", tmpZip, "-C", outDir, `${zipName.replace(/\.zip$/, "")}/node.exe`], {
      stdio: "inherit",
    });
    const extracted = path.join(outDir, zipName.replace(/\.zip$/, ""), "node.exe");
    fs.copyFileSync(extracted, nodeExe);
    fs.rmSync(path.join(outDir, zipName.replace(/\.zip$/, "")), { recursive: true, force: true });
  } finally {
    fs.rmSync(tmpZip, { force: true });
  }

  // The pin's digest covers the vendor ZIP (verified above, before any extraction), not the bare
  // node.exe payload inside it — there is no separate vendor checksum for the unpacked binary. The
  // sidecar instead records the extracted file's own digest, purely so a repeat run of this script
  // can detect on-disk tampering (`alreadyGood()`) without re-downloading and re-verifying the zip.
  if (!fs.existsSync(nodeExe)) {
    console.error(`[fetch-node-runtime] FAIL: node.exe missing after extraction at ${nodeExe}`);
    process.exit(1);
  }
  const finalDigest = sha256File(nodeExe);
  fs.writeFileSync(sidecar, finalDigest, "utf8");

  console.log(`[fetch-node-runtime] fetching licence ${pin.licenseUrl}`);
  const licRes = await fetch(pin.licenseUrl);
  if (!licRes.ok) {
    console.error(`[fetch-node-runtime] FAIL: licence fetch -> ${licRes.status}`);
    process.exit(1);
  }
  fs.writeFileSync(licenseFile, await licRes.text(), "utf8");

  console.log(`[fetch-node-runtime] staged ${nodeExe}`);
}

main().catch((e) => {
  console.error("[fetch-node-runtime] FAIL:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
