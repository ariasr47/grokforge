// Minimal jsdom bootstrap for component / flow-integration tests run under
// Node's built-in test runner (`node --import tsx --import ./src/testEnv.ts --test …`).
// Loaded via `--import` so `document`/`window` exist before React/RTL modules load.
// Safe to load ahead of plain unit test files too (only defines globals that
// are missing / configurable; never throws on Node's own getter-only globals).
import { spawn } from "node:child_process";
import { JSDOM } from "jsdom";
import React from "react";

// tsx's node loader can lower JSX test modules using the classic runtime even
// when the project tsconfig selects react-jsx. Keep the test DOM equivalent to
// the browser bundle by exposing the runtime binding before tests import JSX.
Object.defineProperty(globalThis, "React", { value: React, configurable: true, writable: true });

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});

const { window } = dom;

function defineGlobal(name: string, value: unknown): void {
  const existing = Object.getOwnPropertyDescriptor(globalThis, name);
  if (existing && !existing.configurable) return;
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

// Timers/fetch/WebSocket/queueMicrotask: keep Node's native implementations.
// jsdom's own versions are wrappers that (when hoisted onto globalThis in
// place of the Node originals they internally delegate to) recurse forever.
// Tests substitute fetch/WebSocket explicitly per case anyway.
const skip = new Set([
  "window",
  "self",
  "top",
  "parent",
  "frames",
  "location",
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "queueMicrotask",
  "fetch",
  "WebSocket",
  "performance",
]);
for (const key of Object.getOwnPropertyNames(window)) {
  if (skip.has(key)) continue;
  defineGlobal(key, (window as unknown as Record<string, unknown>)[key]);
}

defineGlobal("window", window);
defineGlobal("document", window.document);
defineGlobal("navigator", window.navigator);

// jsdom does not implement matchMedia.
window.matchMedia =
  window.matchMedia ||
  ((query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList);
defineGlobal("matchMedia", window.matchMedia);

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
defineGlobal("ResizeObserver", ResizeObserverStub);
if (!("ResizeObserver" in window)) {
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
}

if (!window.HTMLElement.prototype.scrollIntoView) {
  window.HTMLElement.prototype.scrollIntoView = () => {};
}
if (!(window.Element.prototype as unknown as { scrollTo?: () => void }).scrollTo) {
  (window.Element.prototype as unknown as { scrollTo: () => void }).scrollTo = () => {};
}

defineGlobal(
  "requestAnimationFrame",
  (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0) as unknown as number,
);
defineGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));

// jsdom implements neither `URL.createObjectURL` nor `URL.revokeObjectURL`
// (used by exportDiagnostics.ts's file-download path). `downloadText`
// already swallows a `createObjectURL` failure, but the deferred
// `revokeObjectURL(url)` call (`setTimeout(..., 2000)`) is bare and throws
// asynchronously — after most tests have already finished — producing an
// uncaught exception that fails the whole suite. No-op fallbacks here match
// the `matchMedia`/`ResizeObserver` shims above; a test that needs to
// inspect the actual Blob overrides `createObjectURL` locally and restores
// it, which layers cleanly on top of this base no-op.
type URLStatics = { createObjectURL?: unknown; revokeObjectURL?: unknown };
const urlStatics = window.URL as unknown as URLStatics;
if (typeof urlStatics.createObjectURL !== "function") {
  urlStatics.createObjectURL = () => "blob:jsdom-unavailable";
}
if (typeof urlStatics.revokeObjectURL !== "function") {
  urlStatics.revokeObjectURL = () => {};
}

// App-test hangs (HostSocket reconnect / React update loops / jsdom assert.inspect)
// have previously ignored `--test-timeout` because they never return to the
// event loop, then filled tens of GB. The in-process interval cannot fire in
// that case, so a detached child watches RSS and taskkills this pid.
const HEAP_ABORT_MB = 768;
const RSS_ABORT_MB = 1536;
const leakWatchdog = setInterval(() => {
  const mem = process.memoryUsage();
  const heapMb = mem.heapUsed / (1024 * 1024);
  const rssMb = mem.rss / (1024 * 1024);
  if (heapMb <= HEAP_ABORT_MB && rssMb <= RSS_ABORT_MB) return;
  console.error(
    `[testEnv] aborting runaway test process heap=${heapMb.toFixed(0)}MB rss=${rssMb.toFixed(0)}MB`,
  );
  process.exit(134);
}, 500);
leakWatchdog.unref();

{
  const parentPid = process.pid;
  const limitMb = RSS_ABORT_MB;
  const child = spawn(
    process.execPath,
    [
      "-e",
      `const pid=${parentPid};const limit=${limitMb};const {spawnSync}=require('node:child_process');
setInterval(()=>{
  const r=spawnSync('powershell.exe',['-NoProfile','-Command','(Get-Process -Id '+pid+' -EA SilentlyContinue).WorkingSet64'],{windowsHide:true,encoding:'utf8'});
  const ws=Number(String(r.stdout||'').trim());
  if(!Number.isFinite(ws)||ws<=0) process.exit(0);
  if(ws/1048576>limit){ spawnSync('taskkill',['/PID',String(pid),'/T','/F'],{windowsHide:true}); process.exit(1); }
},400);`,
    ],
    { detached: true, stdio: "ignore", windowsHide: true },
  );
  child.unref();
  const reap = () => {
    if (child.pid) {
      try {
        spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }).unref();
      } catch {
        /* already gone */
      }
    }
  };
  process.on("exit", reap);
}
