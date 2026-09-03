// Minimal jsdom bootstrap for component / flow-integration tests run under
// Node's built-in test runner (`node --import tsx --import ./src/testEnv.ts --test …`).
// Loaded via `--import` so `document`/`window` exist before React/RTL modules load.
// Safe to load ahead of plain unit test files too (only defines globals that
// are missing / configurable; never throws on Node's own getter-only globals).
import { spawn } from "node:child_process";
import util from "node:util";
import { JSDOM } from "jsdom";
import React from "react";

// Cap Testing Library prettyDOM. Unbounded dumps over jsdom App trees hang
// (~10s) and surface as file-level "test failed" with no assertion.
if (!process.env.DEBUG_PRINT_LIMIT) process.env.DEBUG_PRINT_LIMIT = "120";

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

// jsdom stacks every element at 0×0. react-resizable-panels then treats
// pointerdown at (0,0) as a separator hit and focuses "Resize sidebar",
// so userEvent.type never reaches the composer. Give zero-size nodes
// unique boxes so hit-testing can distinguish them.
{
  const proto = window.HTMLElement.prototype;
  const original = proto.getBoundingClientRect;
  proto.getBoundingClientRect = function getBoundingClientRect() {
    try {
      if (this instanceof window.HTMLElement) {
        if (this.id === "composer-input") return new DOMRect(400, 520, 480, 72);
        if (this.getAttribute("aria-label") === "Resize sidebar") return new DOMRect(254, 0, 6, 24);
      }
      return original.apply(this);
    } catch {
      return new DOMRect();
    }
  };
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

// Import after JSDOM is on globalThis so Testing Library binds to this document.
// Truncate query errors — prettyDOM over the App tree hangs jsdom (~10s) and
// surfaces as a file-level "test failed" with no assertion. Configure the
// same @testing-library/react instance the tests import.
const rtl = await import("@testing-library/react");
rtl.configure({
  getElementError: (message) => {
    const first = String(message ?? "query failed").split("\n")[0];
    const error = new Error(first);
    error.name = "TestingLibraryElementError";
    return error;
  },
});

// Third guard in the same family as DEBUG_PRINT_LIMIT and getElementError
// above. node:assert builds its failure message with
// `util.inspect(value, { depth: 1000, getters: true, customInspect: false })`,
// and React attaches the whole fiber tree to every mounted DOM node as
// enumerable `__reactFiber$*` / `__reactProps$*` own properties. Inspecting one
// element off the App tree therefore walks the entire component tree, every
// hook's state and every prop, so this suite's house idiom for "that node is
// gone" — `assert.equal(screen.queryByRole(...), null)`, ~580 call sites — did
// not merely fail when it failed: it allocated past the RSS watchdog above and
// the process was taskkilled with no output, no stack and no assertion text.
// `customInspect: false` rules out a `util.inspect.custom` hook on jsdom's Node
// prototype, so guard the assert entry points instead. When either side is a
// DOM node, compare by identity — which is what strict equality already means
// for nodes, and the only meaningful comparison for the deep variants here —
// and describe the operands compactly. Assertions with no DOM node on either
// side are delegated to the original untouched.
{
  type DomLike = { nodeType: number; nodeName: string };

  const isDomNode = (value: unknown): value is DomLike =>
    typeof value === "object" &&
    value !== null &&
    typeof (value as DomLike).nodeType === "number" &&
    typeof (value as DomLike).nodeName === "string";

  const NAMED_ATTRS = ["id", "name", "type", "role", "aria-label", "data-testid", "class"];

  const describeDomNode = (node: DomLike): string => {
    if (node.nodeType === 9) return "#document";
    if (node.nodeType === 11) return "#document-fragment";
    if (node.nodeType === 3 || node.nodeType === 8) {
      const data = String((node as { data?: unknown }).data ?? "").replace(/\s+/g, " ").trim();
      return `${node.nodeName} ${JSON.stringify(data.slice(0, 40))}`;
    }
    const el = node as unknown as Element;
    const tag = node.nodeName.toLowerCase();
    const attrs = NAMED_ATTRS.map((name) => {
      const value = typeof el.getAttribute === "function" ? el.getAttribute(name) : null;
      return value ? ` ${name}="${value.slice(0, 60)}"` : "";
    }).join("");
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
    return text ? `<${tag}${attrs}>${text}</${tag}>` : `<${tag}${attrs}>`;
  };

  const describeOperand = (value: unknown): string => {
    if (isDomNode(value)) return describeDomNode(value);
    try {
      return util
        .inspect(value, { depth: 2, breakLength: Infinity, maxStringLength: 120 })
        .slice(0, 200);
    } catch {
      return String(value);
    }
  };

  // [method, failure headline, whether the method wants the operands identical]
  const GUARDED: Array<[string, string, boolean]> = [
    ["equal", "Expected values to be strictly equal:", true],
    ["strictEqual", "Expected values to be strictly equal:", true],
    ["deepEqual", "Expected the same DOM node:", true],
    ["deepStrictEqual", "Expected the same DOM node:", true],
    ["notEqual", "Expected values to be strictly unequal:", false],
    ["notStrictEqual", "Expected values to be strictly unequal:", false],
    ["notDeepEqual", "Expected different DOM nodes:", false],
    ["notDeepStrictEqual", "Expected different DOM nodes:", false],
  ];

  const nodeAssert = await import("node:assert");
  const { AssertionError } = nodeAssert;
  // `import assert from "node:assert/strict"` resolves to this same object.
  const strict = nodeAssert.strict as unknown as Record<string, unknown>;

  // Capture every original before installing any wrapper: in strict mode
  // `equal === strictEqual` and `deepEqual === deepStrictEqual`, so reading
  // them lazily would let one wrapper wrap another.
  const originals = new Map(
    GUARDED.map(([name]) => [name, strict[name] as (...args: unknown[]) => unknown]),
  );

  for (const [name, headline, wantIdentical] of GUARDED) {
    const original = originals.get(name);
    if (typeof original !== "function") continue;
    const guarded = function guarded(this: unknown, ...args: unknown[]): unknown {
      const [actual, expected] = args;
      // Forward the caller's arity untouched: Node rejects an explicitly
      // passed `undefined` message, so `fn(a, b, undefined)` is not the same
      // call as `fn(a, b)`. Anything without a DOM node, and any call too
      // short to compare, keeps node:assert's own behaviour and messages.
      if (args.length < 2 || (!isDomNode(actual) && !isDomNode(expected))) {
        return original.apply(this, args);
      }
      const message = args[2];
      if (Object.is(actual, expected) === wantIdentical) return undefined;
      if (message instanceof Error) throw message;
      throw new AssertionError({
        message:
          typeof message === "string" && message
            ? message
            : `${headline}\n\n+ actual   ${describeOperand(actual)}\n- expected ${describeOperand(expected)}\n`,
        actual: describeOperand(actual),
        expected: describeOperand(expected),
        operator: name,
        stackStartFn: guarded,
      });
    };
    try {
      Object.defineProperty(strict, name, {
        value: guarded,
        configurable: true,
        writable: true,
      });
    } catch {
      console.error(`[testEnv] could not guard assert.${name} against DOM-node inspection`);
    }
  }
}
