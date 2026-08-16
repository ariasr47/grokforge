import { chromium } from "playwright";

const baseURL = process.env.GROKFORGE_SHELL_URL || "http://localhost:5173";
const cell = Number(process.env.GROKFORGE_TOOL_CELL || "1");
const cells = {
  1: { width: 1280, height: 800, theme: "aeon", density: "comfortable", motion: "full", zoom: 1 },
  2: { width: 800, height: 700, theme: "aeon", density: "compact", motion: "calm", zoom: 2 },
  3: { width: 800, height: 700, theme: "light", density: "comfortable", motion: "calm", zoom: 1 },
  4: { width: 1280, height: 800, theme: "light", density: "compact", motion: "full", zoom: 2 },
};
const visualCell = cells[cell] || cells[1];
const browser = await chromium.launch({
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--disable-features=OverlayScrollbar,FluentOverlayScrollbar"],
});
const dockCalls = { permission: [], diff: [] };
const page = await browser.newPage({ viewport: { width: visualCell.width, height: visualCell.height } });
page.setDefaultTimeout(5000);
await page.addInitScript((prefs) => {
  localStorage.setItem("grokforge.prefs.v1", JSON.stringify({ density: prefs.density, theme: prefs.theme, motion: prefs.motion, lastMode: "chat", effort: "auto", usedCode: false, showChatFiles: true, showSubagents: true }));
  class FixtureSocket {
    static OPEN = 1;
    static instances = [];
    readyState = 0;
    onopen = null;
    onmessage = null;
    onclose = null;
    onerror = null;
    listeners = { open: [], message: [], close: [] };
    constructor() {
      FixtureSocket.instances.push(this);
      setTimeout(() => {
        this.readyState = 1;
        this.onopen?.(new Event("open"));
      }, 0);
    }
    addEventListener(type, fn) { this.listeners[type]?.push(fn); }
    removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter((x) => x !== fn); }
    send() {}
    close() { this.readyState = 3; this.onclose?.(new CloseEvent("close")); }
    emit(data) { this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(data) })); }
  }
  window.WebSocket = FixtureSocket;
  window.__fixture = {
    emit(event) { FixtureSocket.instances.at(-1)?.emit(event); },
    disconnect() { FixtureSocket.instances.at(-1)?.close(); },
  };
}, visualCell);
await page.route("**/api/**", async (route) => {
  const path = new URL(route.request().url()).pathname;
  const state = {
    workspace: "C:/fixture", workspaceName: "fixture", authMode: "api_key", hasApiKey: true,
    authSource: "fixture", model: "grok-4", connected: true, busy: false, sessionId: "fixture",
    recent: [], mode: "chat", effort: "auto", shellCapability: {
      status: "available", platform: "win32", osFamily: "windows", executable: "C:/Windows/System32/cmd.exe",
      displayName: "Command Prompt (cmd.exe)", dialect: "cmd", reasonCode: null, reason: null,
    },
  };
  if (path === "/api/health") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, version: "fixture", channel: "dev", channelLabel: "DEV" }) });
  if (path === "/api/state") return route.fulfill({ contentType: "application/json", body: JSON.stringify(state) });
  if (path === "/api/prompt") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true }) });
  if (path === "/api/permission") { dockCalls.permission.push(route.request().postDataJSON()); return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true }) }); }
  if (path === "/api/diff") { dockCalls.diff.push(route.request().postDataJSON()); return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true }) }); }
  if (path === "/api/workspace/files") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ files: [] }) });
  return route.fulfill({ contentType: "application/json", body: JSON.stringify(state) });
});
await page.goto(baseURL, { waitUntil: "domcontentloaded" });
if (visualCell.zoom !== 1) await page.evaluate((zoom) => { document.documentElement.style.zoom = String(zoom); }, visualCell.zoom);
const topbarBox = await page.locator(".topbar").boundingBox();
const paletteBox = await page.locator(".topbar").getByRole("button", { name: "⌘K", exact: true }).boundingBox();
const settingsBox = await page.locator(".topbar").getByRole("button", { name: "Settings", exact: true }).boundingBox();
const viewportBox = page.viewportSize();
if (!topbarBox || !paletteBox || !settingsBox || !viewportBox || topbarBox.x < 0 || topbarBox.x + topbarBox.width > viewportBox.width || paletteBox.x < topbarBox.x || paletteBox.x + paletteBox.width > viewportBox.width || settingsBox.x < topbarBox.x || settingsBox.x + settingsBox.width > viewportBox.width) {
  throw new Error(`topbar controls clipped: ${JSON.stringify({ topbarBox, paletteBox, settingsBox, viewportBox })}`);
}
await page.getByLabel("Message to agent").fill("run the deterministic tool fixture");
if (visualCell.zoom !== 1) {
  await page.evaluate(() => document.querySelector('button[title^="Send"]')?.click());
} else {
  await page.getByRole("button", { name: "Send" }).click();
}
await page.waitForTimeout(150);
await page.evaluate(() => {
  for (let i = 0; i < 45; i += 1) {
    const id = `fixture-${i}`;
    if (i === 1) window.__fixture.emit({ type: "tool_run", schemaVersion: 2, activityId: id, toolCallId: id,
      lifecycle: "pending", execution: null, status: "running", name: "run_shell", input: { command: "pending" }, summary: null,
      command: null, output: null, error: null, reasonCode: null, reason: null, shellDisplayName: null, detailAvailable: true });
    window.__fixture.emit({ type: "tool_run", schemaVersion: 2, activityId: id, toolCallId: id,
      lifecycle: i === 0 ? "pending" : "terminal", execution: i === 0 ? null : i === 43 ? "not_executed" : "executed",
      status: i === 0 ? "running" : i === 43 ? "rejected" : i === 41 ? "failed" : "succeeded", name: "run_shell",
      input: { command: `echo fixture-${i}` }, summary: `fixture-${i}`, command: `echo fixture-${i}`,
      output: i === 41 ? null : `fixture output ${i}`, error: i === 41 ? "fixture failure" : null,
      reasonCode: i === 43 ? "leading_command_unresolved" : null,
      reason: i === 43 ? "fixture command unresolved" : null,
      shellDisplayName: "Command Prompt (cmd.exe)", detailAvailable: i !== 44 });
    if (i === 10) window.__fixture.emit({ type: "permission_request", id: "perm-10", kind: "shell", detail: "fixture" });
    if (i === 20) window.__fixture.emit({ type: "file_edit", id: "diff-20", path: "fixture.md", diff: "@@", status: "proposed" });
  }
  window.__fixture.emit({ type: "done", reason: "stop" });
});
await page.locator("[data-tool-activity]").first().waitFor();
const groups = await page.locator("[data-tool-activity]").count();
const rows = await page.locator(".tool-row").count();
const chips = await page.locator(".activity-chip").count();
const body = page.locator(".tool-activity-body").first();
const expanded = await page.locator(".tool-activity-head").first().getAttribute("aria-expanded");
const bodyTabIndex = await body.getAttribute("tabindex");
const identityCount = await page.locator(".tool-row").evaluateAll((els) => new Set(els.map((el) => el.textContent)).size);
const summaryText = await page.locator(".tool-activity-sub").first().textContent();
if (groups !== 1 || rows !== 45 || identityCount !== 45 || chips !== 2 || expanded !== "true" || bodyTabIndex !== "0" || !summaryText?.includes("1 failed") || !summaryText.includes("1 not run")) {
  await browser.close();
  throw new Error(`Expected 45 rows / 1 group / 2 chips / open focusable body / distinct summary; observed ${rows} / ${groups} / ${chips} / ${expanded} / ${bodyTabIndex} / ${summaryText}`);
}
const header = page.locator(".tool-activity-head").first();
await page.locator(".transcript").evaluate((el) => { el.scrollLeft = 0; });
const headerBox = await header.boundingBox();
const bodyBox = await body.boundingBox();
const groupBox = await page.locator("[data-tool-activity]").first().boundingBox();
const composerBox = await page.getByLabel("Message to agent").boundingBox();
const transcriptBox = await page.locator(".transcript").boundingBox();
const containment = await page.evaluate(() => {
  const read = (sel) => { const el = document.querySelector(sel); if (!el) return null; const s = getComputedStyle(el); return { contentVisibility: s.contentVisibility, contain: s.contain }; };
  return { transcript: read(".transcript"), group: read("[data-tool-activity]"), body: read(".tool-activity-body"), row: read(".tool-row"), chip: read(".activity-chip") };
});
if (containment.transcript?.contentVisibility !== "auto" || containment.transcript?.contain !== "content" || containment.group?.contentVisibility !== "visible" || containment.group?.contain !== "none" || containment.body?.contentVisibility !== "visible" || containment.body?.contain !== "none" || containment.row?.contentVisibility !== "visible" || containment.row?.contain !== "none" || containment.chip?.contentVisibility !== "visible" || containment.chip?.contain !== "none") throw new Error(`containment ownership mismatch: ${JSON.stringify(containment)}`);
if (!headerBox || !bodyBox || !groupBox || !composerBox || !transcriptBox || headerBox.height < 20 || bodyBox.height < 20 || composerBox.height < 20) throw new Error("unstable header/transcript/composer anchors");
if (bodyBox.width > groupBox.width + 2) throw new Error(`activity body escapes group inline bounds: ${JSON.stringify({ bodyBox, groupBox })}`);
const anchorBefore = { header: headerBox, transcript: transcriptBox, composer: composerBox };
if (headerBox.y < transcriptBox.y || headerBox.y + headerBox.height > transcriptBox.y + transcriptBox.height) { console.error("GEOMETRY_RED", { headerBox, transcriptBox, count: await page.locator('.transcript').count(), heads: await page.locator('.tool-activity-head').count(), chain: await header.evaluate((el) => { const out=[]; for(let n=el;n;n=n.parentElement) out.push({tag:n.tagName,cls:n.className,rect:(()=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})(),overflow:getComputedStyle(n).overflow}); return out; }), scroll: await page.locator('.transcript').first().evaluate((el)=>({top:el.scrollTop,client:el.clientHeight,height:el.scrollHeight})) }); throw new Error("header outside transcript viewport"); }
await page.getByLabel("Message to agent").focus({ preventScroll: true });
const permissionDecision = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/permission");
await page.keyboard.press("y");
await permissionDecision;
await page.locator(".tool-activity-body").focus({ preventScroll: true });
const diffDecision = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/diff");
await page.keyboard.press("a");
await diffDecision;
if (!dockCalls.permission.length || !dockCalls.diff.length) throw new Error("dock Y/A shortcuts did not route decisions");
await page.evaluate(() => window.__fixture.emit({ type: "permission_request", id: "perm-10", kind: "shell", detail: "fixture" }));
await page.getByRole("region", { name: "Allow running a command?" }).waitFor();
const permissionN = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/permission");
await page.getByLabel("Message to agent").focus({ preventScroll: true });
await page.keyboard.press("n");
await permissionN;
await page.waitForTimeout(80);
await page.evaluate(() => window.__fixture.emit({ type: "permission_request", id: "perm-10", kind: "shell", detail: "fixture" }));
await page.getByRole("region", { name: "Allow running a command?" }).waitFor();
const permissionS = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/permission");
await page.keyboard.press("s");
await permissionS;
await page.waitForTimeout(80);
await page.evaluate(() => window.__fixture.emit({ type: "file_edit", id: "diff-20", path: "fixture.md", diff: "@@", status: "proposed" }));
await page.locator("#diff-panel").waitFor();
const diffR = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/diff");
await page.keyboard.press("r");
await diffR;
await page.waitForTimeout(80);
if (dockCalls.permission.map((p) => p.decision).slice(-3).join(",") !== "allow_once,deny,allow_session") throw new Error(`Y/N/S payloads missing: ${JSON.stringify(dockCalls.permission)}`);
if (dockCalls.diff.map((p) => p.action).slice(-2).join(",") !== "accept,reject") throw new Error(`A/R payloads missing: ${JSON.stringify(dockCalls.diff)}`);
if (await page.locator(".activity-chip").count() !== 2) throw new Error("replayed dock identities created extra chips");
while (await page.locator(".toast-x").count()) await page.locator(".toast-x").first().click();
await body.hover();
await body.press("PageDown");
await body.press("End");
await body.press("Home");
await body.press("PageUp");
await page.mouse.wheel(0, 900);
await page.mouse.wheel(0, -900);
await header.evaluate((el) => el.scrollIntoView({ behavior: "auto", block: "nearest", inline: "nearest" }));
await page.locator(".transcript").evaluate((el) => {
  el.scrollLeft = 0;
  const h = document.querySelector(".tool-activity-head"); if (!h) return;
  const tr = el.getBoundingClientRect(); const hr = h.getBoundingClientRect();
  if (hr.top < tr.top) el.scrollTop -= tr.top - hr.top;
  else if (hr.bottom > tr.bottom) el.scrollTop += hr.bottom - tr.bottom;
});
await page.evaluate(() => { window.scrollTo(0, 0); for (const sel of [".app", ".layout", ".main", ".panel-chat", ".transcript"]) { const el = document.querySelector(sel); if (el) el.scrollLeft = 0; } });
const afterScrollHeader = await header.boundingBox();
const afterScrollComposer = await page.getByLabel("Message to agent").boundingBox();
const afterScrollTranscript = await page.locator(".transcript").boundingBox();
if (!afterScrollHeader || !afterScrollComposer || !afterScrollTranscript || afterScrollHeader.y < afterScrollTranscript.y || afterScrollHeader.y + afterScrollHeader.height > afterScrollTranscript.y + afterScrollTranscript.height) {
  console.error("GEOMETRY_AFTER_SCROLL_RED", { afterScrollHeader, afterScrollTranscript, afterScrollComposer, transcriptScroll: await page.locator(".transcript").evaluate((el) => ({ top: el.scrollTop, left: el.scrollLeft, clientHeight: el.clientHeight, scrollHeight: el.scrollHeight })) });
  throw new Error("header outside transcript viewport after scroll");
}
if (Math.abs(afterScrollHeader.x - anchorBefore.header.x) > 8 || Math.abs(afterScrollComposer.x - anchorBefore.composer.x) > 8) throw new Error(`anchor drift exceeded tolerance: ${JSON.stringify({ anchorBefore, afterScrollHeader, afterScrollComposer })}`);
const bodyScroll = await body.evaluate((el) => ({ top: el.scrollTop, height: el.scrollHeight, client: el.clientHeight }));
if (bodyScroll.height > bodyScroll.client) {
  await page.waitForTimeout(300);
  const targetScroll = await body.evaluate((el) => {
    const max = el.scrollHeight - el.clientHeight;
    const target = Math.max(1, Math.round(max * 0.35));
    el.scrollTop = target;
    el.dispatchEvent(new Event("scroll", { bubbles: true }));
    return target;
  });
  await page.waitForTimeout(150);
  const beforeDrag = await body.evaluate((el) => el.scrollTop);
  if (Math.abs(beforeDrag - targetScroll) > 1) throw new Error(`activity body did not settle at drag start: ${JSON.stringify({ targetScroll, beforeDrag })}`);
  const bb = await body.boundingBox();
  if (!bb) throw new Error("activity body has no drag geometry");
  const metrics = await body.evaluate((el) => ({
    top: el.scrollTop,
    max: el.scrollHeight - el.clientHeight,
    client: el.clientHeight,
    height: el.getBoundingClientRect().height,
    offsetWidth: el.offsetWidth,
    clientWidth: el.clientWidth,
    gutter: getComputedStyle(el).scrollbarGutter,
  }));
  const thumb = Math.max(24, bb.height * metrics.client / (metrics.max + metrics.client));
  const startY = bb.y + (metrics.top / metrics.max) * (bb.height - thumb) + thumb / 2;
  const visibleBottom = Math.min(bb.y + bb.height, afterScrollTranscript.y + afterScrollTranscript.height, page.viewportSize()?.height ?? bb.y + bb.height);
  const endY = Math.max(startY + 24, visibleBottom - 4);
  if (metrics.gutter !== "stable" || metrics.offsetWidth <= metrics.clientWidth) throw new Error(`stable scrollbar gutter missing: ${JSON.stringify(metrics)}`);
  const coordinateScale = bb.width / metrics.offsetWidth;
  const scrollbarWidth = (metrics.offsetWidth - metrics.clientWidth) * coordinateScale;
  // Chromium reserves the full gutter but the native draggable thumb can be
  // narrower than that reservation. Aim inside the right-edge hit region,
  // not at the gutter midpoint, which intermittently lands beside the thumb.
  const scrollbarX = Math.min(bb.x + bb.width - 2, (page.viewportSize()?.width ?? bb.x + bb.width) - 2);
  await body.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.mouse.move(scrollbarX, startY, { steps: 4 });
  await page.waitForTimeout(100);
  await page.mouse.down();
  await page.waitForTimeout(100);
  await page.mouse.move(scrollbarX, endY, { steps: 20 });
  await page.waitForTimeout(100);
  await page.mouse.up();
  await page.waitForTimeout(100);
  const afterDrag = await body.evaluate((el) => el.scrollTop);
  if (afterDrag === beforeDrag) {
    const chain = await body.evaluate((el) => { const out = []; for (let n = el; n; n = n.parentElement) { const r = n.getBoundingClientRect(); const s = getComputedStyle(n); out.push({ tag: n.tagName, cls: n.className, rect: { x: r.x, y: r.y, width: r.width, height: r.height }, overflowX: s.overflowX, width: s.width, maxWidth: s.maxWidth }); } return out; });
    throw new Error(`scrollbar drag did not move activity body: ${JSON.stringify({ bb, beforeDrag, afterDrag, bodyScroll, metrics, scrollbarWidth, scrollbarX, startY, endY, viewport: page.viewportSize(), chain })}`);
  }
}
await body.focus();
await body.press("Control+KeyK");
await page.keyboard.press("Escape");
await body.press("Tab");
await body.press("Shift+Tab");
await body.press("Tab");
if (await page.evaluate(() => document.activeElement?.classList.contains("tool-activity-body"))) throw new Error("Tab did not exit activity body");
await header.click();
if ((await header.getAttribute("aria-expanded")) !== "false") throw new Error("explicit collapse did not persist");
await header.click();
if ((await header.getAttribute("aria-expanded")) !== "true") throw new Error("explicit reopen failed");
await header.click();
await page.evaluate(() => window.__fixture.emit({ type: "tool_run", schemaVersion: 2, activityId: "fixture-44", toolCallId: "fixture-44", lifecycle: "pending", execution: null, status: "running", name: "run_shell", input: { command: "detail" }, summary: "fixture-44", command: "detail", output: null, error: null, reasonCode: null, reason: null, shellDisplayName: null, detailAvailable: true }));
if ((await header.getAttribute("aria-expanded")) !== "false") throw new Error("collapse disclosure thawed on update");
await header.click();
const detailRow = page.locator(".tool-row").filter({ hasText: "fixture-44" }).first();
await detailRow.getByRole("button").first().click();
if (!(await detailRow.textContent())?.includes("Details unavailable.")) throw new Error("missing-detail placeholder absent");
const detailControl = detailRow.getByRole("button").first();
await detailControl.focus({ preventScroll: true });
const detailBefore = await page.evaluate(() => {
  const transcript = document.querySelector(".transcript");
  const body = document.querySelector(".tool-activity-body");
  const rect = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
  return { active: document.activeElement?.outerHTML.slice(0, 180), transcriptTop: transcript?.scrollTop, bodyTop: body?.scrollTop, header: rect(".tool-activity-head"), composer: rect("textarea[aria-label='Message to agent']") };
});
await page.evaluate(() => window.__fixture.emit({ type: "tool_run", schemaVersion: 2, activityId: "fixture-44", toolCallId: "fixture-44", lifecycle: "terminal", execution: "executed", status: "succeeded", name: "run_shell", input: { command: "detail" }, summary: "fixture-44", command: "detail", output: "authoritative detail", error: null, reasonCode: null, reason: null, shellDisplayName: null, detailAvailable: true }));
await page.waitForTimeout(40);
if (!(await detailRow.textContent())?.includes("authoritative detail")) throw new Error("detail fill did not update same row");
const detailAfter = await page.evaluate(() => {
  const transcript = document.querySelector(".transcript");
  const body = document.querySelector(".tool-activity-body");
  const rect = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
  return { active: document.activeElement?.outerHTML.slice(0, 180), transcriptTop: transcript?.scrollTop, bodyTop: body?.scrollTop, header: rect(".tool-activity-head"), composer: rect("textarea[aria-label='Message to agent']") };
});
if (detailAfter.active !== detailBefore.active || detailAfter.transcriptTop !== detailBefore.transcriptTop || detailAfter.bodyTop !== detailBefore.bodyTop || JSON.stringify(detailAfter.header) !== JSON.stringify(detailBefore.header) || JSON.stringify(detailAfter.composer) !== JSON.stringify(detailBefore.composer)) throw new Error(`detail fill moved focus/scroll anchors: ${JSON.stringify({ detailBefore, detailAfter })}`);
if (!headerBox) throw new Error("missing stable header anchor");
await page.evaluate(() => window.__fixture.emit({ type: "tool_run", schemaVersion: 2, activityId: "fixture-999", toolCallId: "fixture-999", lifecycle: "terminal", execution: "executed", status: "succeeded", name: "run_shell", input: null, summary: "stale", command: null, output: "stale", error: null, reasonCode: null, reason: null, shellDisplayName: null, detailAvailable: true }));
if (await page.locator(".tool-row").count() !== 45) throw new Error("unseen post-done activity painted");
if (await page.locator("[data-tool-activity] .activity-chip").count() !== 0) throw new Error("chip incorrectly nested in activity group");
const frozenBefore = await page.locator(".tool-row").evaluateAll((els) => els.map((el) => el.textContent));
await page.evaluate(() => window.__fixture.emit({ type: "state", state: {
  workspace: "C:/fixture", workspaceName: "fixture", authMode: "api_key", hasApiKey: true, authSource: "fixture", model: "grok-4", connected: false, busy: false, sessionId: "fixture", recent: [], mode: "chat", effort: "auto", shellCapability: { status: "available", platform: "win32", osFamily: "windows", executable: "C:/Windows/System32/cmd.exe", displayName: "Command Prompt (cmd.exe)", dialect: "cmd", reasonCode: null, reason: null },
} }));
await page.waitForTimeout(100);
await page.evaluate(() => window.__fixture.disconnect());
await page.waitForTimeout(100);
await page.evaluate(() => window.__fixture.emit({ type: "state", state: { connected: false } }));
await page.waitForTimeout(300);
const frozenRow = page.locator(".tool-row").filter({ hasText: "fixture-0" }).first();
await frozenRow.getByRole("button").first().click();
if (!(await frozenRow.textContent())?.includes("Offline — tool status may be incomplete.")) throw new Error(`disconnect offline copy absent: ${(await page.locator(".tool-row").allTextContents()).join(" | ")}`);
const frozenAtDisconnect = await page.locator(".tool-row").evaluateAll((els) => els.map((el) => el.textContent));
await page.evaluate(() => window.__fixture.emit({ type: "tool_run", schemaVersion: 2, activityId: "fixture-0", toolCallId: "fixture-0", lifecycle: "terminal", execution: "executed", status: "failed", name: "run_shell", input: { command: "late" }, summary: "late", command: "late", output: "changed", error: "changed", reasonCode: null, reason: null, shellDisplayName: null, detailAvailable: true }));
await page.evaluate(() => window.__fixture.emit({ type: "tool_run", schemaVersion: 2, activityId: "post-freeze-unseen", toolCallId: "post-freeze-unseen", lifecycle: "terminal", execution: "executed", status: "succeeded", name: "run_shell", input: null, summary: "unseen", command: null, output: "unseen", error: null, reasonCode: null, reason: null, shellDisplayName: null, detailAvailable: true }));
await page.evaluate(() => window.__fixture.emit({ type: "state", state: {
  workspace: "C:/fixture", workspaceName: "fixture", authMode: "api_key", hasApiKey: true, authSource: "fixture", model: "grok-4", connected: true, busy: false, sessionId: "fixture", recent: [], mode: "chat", effort: "auto", shellCapability: { status: "available", platform: "win32", osFamily: "windows", executable: "C:/Windows/System32/cmd.exe", displayName: "Command Prompt (cmd.exe)", dialect: "cmd", reasonCode: null, reason: null },
} }));
await page.waitForTimeout(40);
const frozenAfter = await page.locator(".tool-row").evaluateAll((els) => els.map((el) => el.textContent));
if (JSON.stringify(frozenAfter) !== JSON.stringify(frozenAtDisconnect) || await page.locator(".tool-row").count() !== 45) throw new Error("disconnect thawed or changed frozen run");
const codeMode = page.getByRole("radio", { name: "Code" });
const chatMode = page.getByRole("radio", { name: "Chat" });
if (await codeMode.count() && await chatMode.count()) {
  await codeMode.click();
  await chatMode.click();
  if (await page.locator(".tool-row").filter({ hasText: "stale tail" }).count()) throw new Error("mode switch retained stale tail");
}
await page.evaluate(() => window.__fixture.emit({ type: "tool_run", schemaVersion: 2, activityId: "stale-before-next", toolCallId: "stale-before-next", lifecycle: "terminal", execution: "executed", status: "succeeded", name: "run_shell", input: null, summary: "stale tail", command: null, output: "stale", error: null, reasonCode: null, reason: null, shellDisplayName: null, detailAvailable: true }));
if (await page.locator(".tool-row").filter({ hasText: "stale tail" }).count()) throw new Error("discarded stale tail painted before next run");
const frozenGroups = await page.locator("[data-tool-activity]").count();
const composer = page.getByLabel("Message to agent");
await composer.fill("zero tool follow-up");
await composer.press("Control+KeyK");
await page.keyboard.press("Escape");
await page.evaluate(() => document.querySelector('button[title^="Send"]')?.click());
await page.waitForTimeout(80);
await page.evaluate(() => window.__fixture.emit({ type: "done", reason: "stop" }));
if (await page.locator("[data-tool-activity]").count() !== frozenGroups) throw new Error("zero-tool run created empty activity group");
await composer.fill("new run");
await page.evaluate(() => document.querySelector('button[title^="Send"]')?.click());
await page.waitForTimeout(80);
await page.evaluate(() => window.__fixture.emit({ type: "tool_run", schemaVersion: 2, activityId: "next-1", toolCallId: "next-1", lifecycle: "terminal", execution: "executed", status: "succeeded", name: "run_shell", input: { command: "next" }, summary: "next", command: "next", output: "next output", error: null, reasonCode: null, reason: null, shellDisplayName: null, detailAvailable: true }));
if (await page.locator(".tool-row").count() > 46) throw new Error("next run duplicated a row");
console.log("45 tool rows | 1 group | 0 duplicates | PASS");
await browser.close();
