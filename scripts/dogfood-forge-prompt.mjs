#!/usr/bin/env node
/**
 * Drive one Review-mode prompt through the running Forge DEV UI.
 * Usage: node scripts/dogfood-forge-prompt.mjs [url] [workspace] <prompt>
 * Extra args after workspace are joined as the prompt. Or set FORGE_PROMPT.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const url = process.argv[2] || "http://127.0.0.1:5174/";
const workspace = process.argv[3] || "C:\\Dev\\grokforge";
const promptFile = process.env.FORGE_PROMPT_FILE;
const prompt =
  (promptFile && fs.existsSync(promptFile) ? fs.readFileSync(promptFile, "utf8") : "") ||
  process.env.FORGE_PROMPT ||
  process.argv.slice(4).join(" ").trim() ||
  "Reply with FORGE-CODE-OK and stop. Do not edit files.";
const outDir = path.resolve(process.env.FORGE_OUT_DIR || "docs/dogfood");
fs.mkdirSync(outDir, { recursive: true });
const tag = process.env.FORGE_SHOT || "forge-prompt";
const chatMode = process.env.FORGE_CHAT === "1";

const cdp = (process.env.FORGE_CDP || "").trim();
const browser = cdp
  ? await chromium.connectOverCDP(cdp)
  : await chromium.launch({ headless: true });
let page;
if (cdp) {
  const ctx = browser.contexts()[0] || (await browser.newContext());
  page =
    ctx.pages().find((p) => {
      const u = p.url();
      return /5174|tauri|localhost|127\.0\.0\.1/.test(u);
    }) ||
    ctx.pages()[0] ||
    (await ctx.newPage());
  await page.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
} else {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
}
page.setDefaultTimeout(30000);
const logs = [];
page.on("console", (msg) => {
  let line = `${msg.type()}: ${msg.text()}`;
  const loc = msg.location();
  if (loc?.url) line += ` @${loc.url}:${loc.lineNumber}`;
  logs.push(line.slice(0, 2000));
});
page.on("pageerror", (err) => logs.push(`pageerror: ${err.message}\n${err.stack || ""}`.slice(0, 2000)));
const hookConsoleStacks = () => {
  const orig = console.error;
  if (orig.__forgeStackHook) return;
  const hooked = function (...args) {
    try {
      const extra = args
        .slice(1)
        .map((a) => (typeof a === "string" ? a : a && a.stack ? a.stack : ""))
        .filter(Boolean)
        .join("\n");
      if (extra) orig.call(console, extra.slice(0, 4000));
    } catch {
      /* ignore */
    }
    return orig.apply(this, args);
  };
  hooked.__forgeStackHook = true;
  console.error = hooked;
};
await page.addInitScript(hookConsoleStacks);
await page.evaluate(hookConsoleStacks).catch(() => undefined);

const cancelRun = page.getByRole("button", { name: /^Cancel$/ });
if (await cancelRun.count()) {
  await cancelRun.first().click().catch(() => undefined);
  await page.waitForTimeout(800);
}
const alreadyForge = /:517[34](\/|$)|tauri\.localhost/.test(page.url());
if (!cdp || !alreadyForge) {
  await page.goto(cdp ? "http://localhost:5174/" : url, { waitUntil: "domcontentloaded" });
} else if (/127\.0\.0\.1:5174/.test(page.url())) {
  // Restore the Tauri devUrl origin so ensure_host IPC is allowed.
  await page.goto("http://localhost:5174/", { waitUntil: "domcontentloaded" });
}
await page.waitForTimeout(2000);
for (const name of chatMode
  ? ["Skip", "Chat — everyday agent", "Try again"]
  : ["Skip", "Code — repo agent", "Try again"]) {
  const b = page.getByRole("button", { name });
  if (await b.count()) await b.first().click().catch(() => undefined);
}
if (chatMode) {
  const chatTab = page.getByRole("radio", { name: /^Chat$/ });
  if (await chatTab.count()) await chatTab.first().click().catch(() => undefined);
} else {
  const codeTab = page.getByRole("button", { name: /^Code$/ });
  if (await codeTab.count()) await codeTab.first().click().catch(() => undefined);
  const codeRadio = page.getByRole("radio", { name: /^Code$/ });
  if (await codeRadio.count()) await codeRadio.first().click().catch(() => undefined);
}
await page.waitForTimeout(800);
await page.getByLabel("Message to agent").waitFor({ state: "visible", timeout: 20000 }).catch(() => undefined);

let opened = { status: 0, text: "skipped" };
if (!chatMode || process.env.FORGE_CHAT_WORKSPACE === "1") {
  opened = await page.evaluate(async (ws) => {
    const r = await fetch("/api/workspace", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: ws }),
    });
    return { status: r.status, text: (await r.text()).slice(0, 400) };
  }, workspace);
  await page.waitForTimeout(2000);
  if (chatMode) {
    const chatTab = page.getByRole("radio", { name: /^Chat$/ });
    if (await chatTab.count()) await chatTab.first().click().catch(() => undefined);
    await page.waitForTimeout(600);
  }
} else {
  await page.waitForTimeout(800);
}
if (process.env.FORGE_KEEP_SESSION !== "1") {
  const startNew = page.getByRole("button", { name: "Start a new conversation" });
  if (await startNew.count()) {
    await startNew.first().click().catch(() => undefined);
  } else if (chatMode) {
    const newchat = page.getByRole("button", { name: "New chat", exact: true });
    if (await newchat.count()) await newchat.first().click().catch(() => undefined);
  } else {
    const newsess = page.getByRole("button", { name: "New session", exact: true });
    if (await newsess.count()) await newsess.first().click().catch(() => undefined);
  }
  await page.waitForTimeout(1500);
} else {
  await page.waitForTimeout(800);
}

if (chatMode && process.env.FORGE_EFFORT) {
  const effortName = process.env.FORGE_EFFORT === "expert" ? "Expert" : process.env.FORGE_EFFORT;
  const effort = page.getByRole("radio", { name: effortName, exact: true });
  if (await effort.count()) await effort.first().click().catch(() => undefined);
  await page.waitForTimeout(400);
}

if (chatMode && process.env.FORGE_RENAME_HOME) {
  const homeName = process.env.FORGE_RENAME_HOME.trim();
  const trigger = page.locator(".chat-home-name-trigger");
  if (await trigger.count()) await trigger.first().click().catch(() => undefined);
  await page.waitForTimeout(300);
  const homeInput = page.getByLabel("Name this home");
  if (await homeInput.count()) {
    await homeInput.first().fill(homeName);
    const save = page.getByRole("button", { name: /^Save$/ });
    if (await save.count()) await save.first().click().catch(() => undefined);
    await page.waitForTimeout(600);
  }
}



const clicks = [];
let pickState = null;

if (process.env.FORGE_PALETTE === "1") {
  const palBtn = page.getByTitle("Command palette (Ctrl+K)");
  if (await palBtn.count()) await palBtn.first().click().catch(() => undefined);
  else await page.keyboard.press("Control+K");
  await page.waitForTimeout(600);
  const q = (process.env.FORGE_PALETTE_Q || "").trim();
  if (q) {
    const input = page.getByPlaceholder("Type a command…");
    if (await input.count()) await input.first().fill(q);
    await page.waitForTimeout(400);
  }
  if (process.env.FORGE_PALETTE_ENTER === "1") {
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
  }
  const shot = path.join(outDir, `${tag}.png`);
  await page.screenshot({ path: shot, fullPage: true });
  const body = (await page.locator("body").innerText()).slice(0, 8000);
  const dialog = await page.getByRole("dialog", { name: /command palette/i }).count();
  const options = await page.locator(".palette-option, [role='option']").count();
  const report = { opened, outcome: "palette", prompt: q || "palette", body, dialog, options, shot };
  fs.writeFileSync(path.join(outDir, `${tag}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ outcome: "palette", dialog, options, shot, bodyTail: body.slice(-1800) }, null, 2));
  if (!cdp) await browser.close();
  process.exit(0);
}

const slashClick = (process.env.FORGE_SLASH_CLICK || "").trim();
if (process.env.FORGE_SLASH === "1" || slashClick) {
  const catalogWait = Date.now() + 20000;
  while (Date.now() < catalogWait) {
    const disp = await page.evaluate(async () => {
      try {
        const r = await fetch("/api/state");
        const j = await r.json();
        return j?.skillsCatalog?.disposition || "";
      } catch {
        return "";
      }
    });
    if (disp === "ready") break;
    await page.waitForTimeout(400);
  }
  const box = page.getByLabel("Message to agent");
  await box.click();
  await box.fill("/");
  await page.waitForTimeout(800);
  await page.locator(".skills-palette").waitFor({ state: "visible", timeout: 8000 }).catch(() => undefined);
  await page.locator(".skills-palette-option").first().waitFor({ state: "visible", timeout: 12000 }).catch(() => undefined);
  const rowWait = Date.now() + 15000;
  while (Date.now() < rowWait && (await page.locator(".skills-palette-option").count()) === 0) {
    await page.waitForTimeout(400);
  }
  if (slashClick) {
    await box.pressSequentially(slashClick, { delay: 20 });
    await page.waitForTimeout(400);
  }
  if (process.env.FORGE_PLAN !== "1") {
    const planBtn = page.getByRole("button", { name: /^Plan$/ });
    if (await planBtn.count()) {
      const pressed = await planBtn.first().getAttribute("aria-pressed");
      if (pressed === "true") {
        await planBtn.first().click().catch(() => undefined);
        await page.waitForTimeout(250);
      }
    }
  }
  if (!slashClick) {
    await page.screenshot({ path: path.join(outDir, `${tag}-top.png`), fullPage: true });
  }
  const send = page.getByRole("button", { name: "Send" });
  const skillsState = {
    skills: await page.locator(".skills-palette").count(),
    rows: await page.locator(".skills-palette-option").count(),
    sendDisabled: await send.isDisabled(),
    sendTitle: await send.getAttribute("title"),
    clip: await page.evaluate(() => {
      const pal = document.querySelector(".skills-palette");
      const list = document.querySelector(".skills-palette-list");
      const last = document.querySelector(".skills-palette-option:last-child");
      if (!pal || !last) return null;
      if (list) list.scrollTop = list.scrollHeight;
      const p = pal.getBoundingClientRect();
      const r = last.getBoundingClientRect();
      return {
        palBottom: Math.round(p.bottom),
        lastBottom: Math.round(r.bottom),
        lastHeight: Math.round(r.height),
        lastText: (last.textContent || "").trim().slice(0, 40),
        clipped: r.bottom > p.bottom - 2,
        list: Boolean(list),
      };
    }),
  };
  if (!slashClick) {
    const shot = path.join(outDir, `${tag}.png`);
    await page.screenshot({ path: shot, fullPage: true });
    const body = (await page.locator("body").innerText()).slice(0, 8000);
    const report = { opened, outcome: "slash", prompt: "/", body, ...skillsState, shot };
    fs.writeFileSync(path.join(outDir, `${tag}.json`), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ outcome: "slash", ...skillsState, shot, bodyTail: body.slice(-1200) }, null, 2));
    if (!cdp) await browser.close();
    process.exit(0);
  }
  const pal = page.locator(".skills-palette");
  await pal.waitFor({ state: "visible", timeout: 8000 }).catch(() => undefined);
  if (await pal.count()) {
    const opt = pal.locator(".skills-palette-option").filter({ hasText: slashClick });
    if (await opt.count()) {
      await opt.first().click();
      clicks.push({ name: `slash:${slashClick}`, at: new Date().toISOString() });
    } else {
      await box.press("Enter");
      clicks.push({ name: `slash-enter:${slashClick}`, at: new Date().toISOString() });
    }
  }
  await page.waitForTimeout(400);
  skillsState.sendDisabledAfterClick = await send.isDisabled();
  const pickShot = path.join(outDir, `${tag}-arm.png`);
  await page.screenshot({ path: pickShot, fullPage: true });
  skillsState.armShot = pickShot;
  pickState = skillsState;
}

if (process.env.FORGE_SETTINGS === "1") {
  const settings = page.getByRole("button", { name: /^Settings$/ });
  if (await settings.count()) await settings.first().click().catch(() => undefined);
  await page.waitForTimeout(800);
  const shot = path.join(outDir, `${tag}.png`);
  await page.screenshot({ path: shot, fullPage: true });
  const body = (await page.locator("body").innerText()).slice(0, 8000);
  const report = { opened, outcome: "settings", prompt: "settings", body, shot };
  fs.writeFileSync(path.join(outDir, `${tag}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ outcome: "settings", shot, bodyTail: body.slice(-1500) }, null, 2));
  if (!cdp) await browser.close();
  process.exit(0);
}

const atClick = (process.env.FORGE_ATCLICK || "").trim();
if (process.env.FORGE_ATFILE === "1" || atClick) {
  const box = page.getByLabel("Message to agent");
  await box.click();
  await box.fill(atClick ? `@${atClick}` : "@");
  await page.waitForTimeout(800);
  const send = page.getByRole("button", { name: "Send" });
  const blockEl = page.locator(".composer-block-reason");
  pickState = {
    atMenu: await page.locator(".at-menu").count(),
    atButtons: await page.locator(".at-menu button").count(),
    listbox: await page.locator("[role='listbox']").count(),
    sendDisabled: await send.isDisabled(),
    sendTitle: await send.getAttribute("title"),
    blockReason: (await blockEl.count()) ? (await blockEl.textContent()) || "" : "",
  };
  if (process.env.FORGE_ATKEY === "1") {
    const opts = page.getByRole("option");
    pickState.optionCount = await opts.count();
    pickState.selectedBefore = await opts.evaluateAll((els) =>
      els.map((el) => ({
        text: (el.textContent || "").trim(),
        selected: el.getAttribute("aria-selected") === "true",
      })),
    );
    await box.press("ArrowDown");
    await page.waitForTimeout(200);
    pickState.selectedAfterDown = await opts.evaluateAll((els) =>
      els.map((el) => ({
        text: (el.textContent || "").trim(),
        selected: el.getAttribute("aria-selected") === "true",
      })),
    );
    pickState.draftAfterDown = await box.inputValue();
    await box.press("Enter");
    await page.waitForTimeout(200);
    pickState.draftAfterEnter = await box.inputValue();
    const shot = path.join(outDir, `${tag}.png`);
    await page.screenshot({ path: shot, fullPage: true });
    const body = (await page.locator("body").innerText()).slice(0, 8000);
    const report = { opened, outcome: "atkey", prompt: "@", body, pickState, shot };
    fs.writeFileSync(path.join(outDir, `${tag}.json`), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ outcome: "atkey", pickState, shot }, null, 2));
    if (!cdp) await browser.close();
    process.exit(0);
  }
  if (!atClick) {
    if (process.env.FORGE_ATARROW === "1") {
      await box.press("ArrowDown");
      await page.waitForTimeout(200);
      pickState.selected = await page.locator(".at-menu [aria-selected='true']").innerText().catch(() => "");
      pickState.activeClass = await page.locator(".at-menu button.is-active").count();
      pickState.btnHeights = await page.locator(".at-menu button").evaluateAll((els) =>
        els.map((el) => Math.round(el.getBoundingClientRect().height)),
      );
    }
    const shot = path.join(outDir, `${tag}.png`);
    await page.screenshot({ path: shot, fullPage: true });
    const body = (await page.locator("body").innerText()).slice(0, 8000);
    const report = {
      opened,
      outcome: process.env.FORGE_ATARROW === "1" ? "atarrow" : "atfile",
      prompt: "@",
      body,
      palette: pickState.listbox,
      pickState,
      shot,
    };
    fs.writeFileSync(path.join(outDir, `${tag}.json`), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ outcome: report.outcome, pickState, shot, bodyTail: body.slice(-1500) }, null, 2));
    if (!cdp) await browser.close();
    process.exit(0);
  }
  let pickBtn = page.locator(".at-menu button").filter({ hasText: `@${atClick}` });
  if (!(await pickBtn.count()) && /KEEP\.md$/i.test(atClick) === false) {
    pickBtn = page.locator(".at-menu button").filter({ hasText: atClick });
  }
  if (!(await pickBtn.count())) {
    pickBtn = page.locator(".at-menu button").first();
  }
  if (await pickBtn.count()) {
    await pickBtn.first().click();
    clicks.push({ name: `at:${atClick}`, at: new Date().toISOString() });
  }
  await page.waitForTimeout(300);
  pickState.draftAfterPick = await box.inputValue();
  pickState.sendDisabledAfterPick = await send.isDisabled();
  pickState.blockReasonAfterPick = (await blockEl.count())
    ? (await blockEl.textContent()) || ""
    : "";
  const pickShot = path.join(outDir, `${tag}-pick.png`);
  await page.screenshot({ path: pickShot, fullPage: true });
  pickState.pickShot = pickShot;
  const mention = pickState.draftAfterPick?.trim()
    ? pickState.draftAfterPick.endsWith(" ")
      ? pickState.draftAfterPick
      : `${pickState.draftAfterPick} `
    : `@${atClick} `;
  await box.fill(`${mention}${prompt}`);
  pickState.draftAfterType = await box.inputValue();
  pickState.sendDisabledAfterType = await send.isDisabled();
}

if (process.env.FORGE_PLAN === "1") {
  const plan = page.getByRole("button", { name: /^Plan$/ });
  if (await plan.count()) {
    const pressed = await plan.first().getAttribute("aria-pressed");
    if (pressed !== "true") {
      await plan.first().click().catch(() => undefined);
    }
    await page.evaluate(async () => {
      let sessionId;
      try {
        const s = JSON.parse(localStorage.getItem("grokforge.sessions.v2") || "{}");
        const active = s.activeId && typeof s.activeId === "object" ? s.activeId : {};
        sessionId = Object.values(active).find((id) => typeof id === "string" && id.length >= 8);
      } catch {
        sessionId = undefined;
      }
      await fetch("/api/plan-engagement", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(sessionId ? { engaged: true, sessionId } : { engaged: true }),
      }).catch(() => undefined);
    });
    await page.waitForSelector('[data-plan-arm="armed"]', { timeout: 8000 }).catch(() => undefined);
    const armWait = Date.now() + 8000;
    while (Date.now() < armWait) {
      const engaged = await page.evaluate(async () => {
        try {
          const r = await fetch("/api/state");
          const j = await r.json();
          return j?.planEngagement?.engaged === true;
        } catch {
          return false;
        }
      });
      if (engaged) break;
      await page.waitForTimeout(250);
    }
  }
} else {
  const plan = page.getByRole("button", { name: /^Plan$/ });
  if (await plan.count()) {
    const pressed = await plan.first().getAttribute("aria-pressed");
    if (pressed === "true") {
      await plan.first().click().catch(() => undefined);
      await page.waitForTimeout(250);
    }
  }
}

const box = page.getByLabel("Message to agent");
const emptyBeforeSend = await page
  .locator(".empty-state h1")
  .innerText()
  .catch(() => "");
const enableWait = Date.now() + 20000;
while (Date.now() < enableWait) {
  const cancelBusy = page.getByRole("button", { name: /^Cancel$/ });
  if (await cancelBusy.count()) {
    await cancelBusy.first().click().catch(() => undefined);
    await page.waitForTimeout(400);
  }
  const acceptPlan = page.getByRole("button", { name: "Accept plan", exact: true });
  if (await acceptPlan.count()) {
    await acceptPlan.first().click().catch(() => undefined);
    await page.waitForTimeout(600);
  }
  const disabled = await box.isDisabled().catch(() => true);
  if (!disabled) break;
  await page.waitForTimeout(400);
}
const noSend = process.env.FORGE_NOSEND === "1";
if (!noSend) {
  await box.click({ force: true }).catch(() => undefined);
  await box.click();
  if (!atClick && !slashClick) {
    await box.fill(prompt);
  }
  if (chatMode && process.env.FORGE_ATTACH_FILE) {
    const attachPath = path.resolve(process.env.FORGE_ATTACH_FILE);
    const attachInput = page.locator("#composer-attach");
    if (await attachInput.count()) {
      await attachInput.setInputFiles(attachPath);
      await page.waitForTimeout(700);
    }
  }
}
const sendBtn = page.locator(".composer-wrap").getByRole("button", { name: "Send", exact: true });
const keepIdle =
  noSend ||
  (process.env.FORGE_KEEP_SESSION === "1" &&
    /\bYour turn\b/.test(await page.locator("body").innerText()));
if (!keepIdle) {
  const sendWait = Date.now() + 15000;
  while (Date.now() < sendWait && (await sendBtn.isDisabled())) {
    await page.waitForTimeout(400);
  }
  if (await sendBtn.isDisabled()) {
    await box.press("Enter");
    await page.waitForTimeout(200);
  }
  if (process.env.FORGE_PLAN === "1") {
    await page.evaluate(async () => {
      let sessionId;
      try {
        const s = JSON.parse(localStorage.getItem("grokforge.sessions.v2") || "{}");
        const active = s.activeId && typeof s.activeId === "object" ? s.activeId : {};
        sessionId = Object.values(active).find((id) => typeof id === "string" && id.length >= 8);
      } catch {
        sessionId = undefined;
      }
      await fetch("/api/plan-engagement", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(sessionId ? { engaged: true, sessionId } : { engaged: true }),
      }).catch(() => undefined);
    });
    await page.waitForTimeout(200);
  }
  if (await sendBtn.isEnabled()) {
    if (process.env.FORGE_BUSY_SECOND === "1" || process.env.FORGE_STOP === "1") {
      // Playwright's click waits for the Send node to stay stable; busy chrome
      // replaces it with Cancel and that wait can outlive the whole first run.
      await sendBtn.evaluate((el) => el.click());
      clicks.push({ name: "send", at: new Date().toISOString() });
    } else {
      await sendBtn.click();
    }
  } else {
    const failShot = path.join(outDir, `${tag}-send-disabled.png`);
    await page.screenshot({ path: failShot, fullPage: true });
    throw new Error(`Send stayed disabled after slash arm (${failShot})`);
  }
}

let busySecond = null;
if (!noSend && process.env.FORGE_BUSY_SECOND === "1") {
  const composerCancel = page.locator(".composer-wrap").getByRole("button", { name: /^(Cancel|Cancel run)$/ });
  await composerCancel.first().waitFor({ state: "visible", timeout: 2500 }).catch(() => undefined);
  await page.waitForTimeout(50);
  const snap = async () => {
    const send = page.locator(".composer-wrap").getByRole("button", { name: "Send", exact: true });
    const cancel = page.locator(".composer-wrap").getByRole("button", { name: /^(Cancel|Cancel run)$/ });
    const you = page.locator(".run-prompt");
    return {
      sendCount: await send.count(),
      sendDisabled: (await send.count()) ? await send.first().isDisabled() : null,
      cancelCount: await cancel.count(),
      composerDisabled: await box.isDisabled().catch(() => null),
      composerValue: await box.inputValue().catch(() => ""),
      youCount: await you.count(),
      blockReason: (await page.locator(".composer-block-reason").innerText().catch(() => "")).slice(0, 120),
      bodyHasRunInProgress: /A run is in progress/.test(await page.locator("body").innerText()),
      youHasBusySecond: (await you.allInnerTexts()).some((t) => /BUSY-SECOND-MUST-NOT-SEND/.test(t)),
    };
  };
  const during = await snap();
  const stillBusy = during.cancelCount > 0 && during.sendCount === 0;
  if (stillBusy) {
    await box.click({ force: true }).catch(() => undefined);
    await box.fill("BUSY-SECOND-MUST-NOT-SEND", { force: true }).catch(() => undefined);
    await page.waitForTimeout(200);
    await box.press("Enter").catch(() => undefined);
    clicks.push({ name: "busy-second-enter", at: new Date().toISOString() });
    await page.waitForTimeout(400);
  }
  busySecond = { during, stillBusy, after: await snap() };
}

if (!noSend && process.env.FORGE_STOP === "1") {
  const stopWait = Number(process.env.FORGE_STOP_MS || 2500);
  await page.waitForTimeout(Number.isFinite(stopWait) ? Math.max(400, stopWait) : 2500);
  const stopBtn = page.locator(".composer-wrap").getByRole("button", { name: /^(Cancel|Cancel run)$/ });
  if (await stopBtn.count()) {
    await stopBtn.first().click().catch(() => undefined);
    clicks.push({ name: "Stop", at: new Date().toISOString() });
  }
}

const deadline = Date.now() + 300000;
let outcome = noSend ? "idle" : "timeout";
let midShot = null;
const midMs = Number(process.env.FORGE_MIDSHOT_MS || 0);
const midAt = midMs > 0 ? Date.now() + midMs : 0;
waitTurn: while (!noSend && Date.now() < deadline) {
  if (midAt && !midShot && Date.now() >= midAt) {
    midShot = path.join(outDir, `${tag}-mid.png`);
    await page.screenshot({ path: midShot, fullPage: true }).catch(() => undefined);
  }
  for (const name of process.env.FORGE_DENY === "1"
    ? ["Deny", "Accept plan", "End Plan · no changes proposed", "Keep planning"]
    : ["Allow once", "Accept", "Accept all", "Accept plan", "End Plan · no changes proposed", "Keep planning"]) {
    if (
      name === "Keep planning" &&
      (process.env.FORGE_PLAN_STOP_ON_ACCEPT === "1" ||
        clicks.some((c) => c.name === "Accept plan" || c.name === "End Plan · no changes proposed"))
    ) {
      continue;
    }
    const btn = page.getByRole("button", { name, exact: true });
    if (await btn.count()) {
      await btn.first().click().catch(() => undefined);
      clicks.push({ name, at: new Date().toISOString() });
      await page.waitForTimeout(600);
      if (name === "Accept plan" && process.env.FORGE_PLAN_STOP_ON_ACCEPT === "1") {
        const gone = Date.now() + 15000;
        while (Date.now() < gone && (await page.getByRole("button", { name: "Accept plan", exact: true }).count())) {
          await page.waitForTimeout(400);
        }
        await page.waitForTimeout(400);
        const thought = page.locator(".run-thought[open] summary");
        if (await thought.count()) await thought.first().click().catch(() => undefined);
        const toolsHead = page.locator(".tool-activity-head[aria-expanded='true']");
        if (await toolsHead.count()) await toolsHead.first().click().catch(() => undefined);
        await page.waitForTimeout(300);
        await page.evaluate(() => {
          const thoughtEl = document.querySelector(".run-thought");
          if (thoughtEl && thoughtEl.hasAttribute("open")) thoughtEl.removeAttribute("open");
          const plan = document.querySelector(".plan-section") || document.querySelector(".plan-body");
          const transcript = document.querySelector(".transcript");
          const you = document.querySelector(".run-prompt");
          const strip = document.querySelector(".overview-strip");
          if (!plan || !transcript) return;
          plan.scrollIntoView({ block: "nearest", inline: "nearest" });
          const pr = plan.getBoundingClientRect();
          const yr = you?.getBoundingClientRect();
          const sr = strip?.getBoundingClientRect();
          let need = 0;
          const floor = Math.max(sr ? sr.bottom : 0, yr ? yr.bottom : 0) + 8;
          if (pr.top < floor) need = floor - pr.top;
          const composer = document.querySelector(".composer-wrap")?.getBoundingClientRect();
          if (composer && pr.bottom > composer.top - 8) {
            need = Math.min(need, composer.top - 8 - pr.bottom);
          }
          transcript.scrollTop += need;
        }).catch(() => undefined);
        outcome = "idle";
        break waitTurn;
      }
    }
  }
  const body = await page.locator("body").innerText();
  const waiting = /Waiting for model|Waiting for Grok|Writing…|Thinking/.test(body);
  const idle = /\bYour turn\b/.test(body);
  if (/Run failed/.test(body) && idle && !waiting) {
    outcome = "failed";
    break;
  }
  if (idle && !waiting) {
    outcome = "idle";
    break;
  }
  await page.waitForTimeout(1500);
}

async function waitIdleAgain(ms = 180000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    for (const name of ["Allow once", "Accept", "Accept all"]) {
      const btn = page.getByRole("button", { name, exact: true });
      if (await btn.count()) {
        await btn.first().click().catch(() => undefined);
        clicks.push({ name, at: new Date().toISOString() });
        await page.waitForTimeout(600);
      }
    }
    const t = await page.locator("body").innerText();
    const waiting = /Waiting for model|Waiting for Grok|Writing…|Thinking/.test(t);
    const idle = /\bYour turn\b/.test(t);
    if (/Run failed/.test(t) && idle && !waiting) return "failed";
    if (idle && !waiting) return "idle";
    await page.waitForTimeout(1500);
  }
  return "timeout";
}

if (!noSend && process.env.FORGE_FOLLOWUP) {
  const follow = process.env.FORGE_FOLLOWUP;
  await box.click({ force: true }).catch(() => undefined);
  await box.fill(follow);
  const sendWait = Date.now() + 10000;
  while (Date.now() < sendWait && (await sendBtn.isDisabled())) {
    await page.waitForTimeout(300);
  }
  if (await sendBtn.isEnabled()) {
    await sendBtn.click();
    clicks.push({ name: "follow-up", at: new Date().toISOString() });
    outcome = await waitIdleAgain();
  }
}

if (process.env.FORGE_COPY === "1") {
  const copy = page.getByRole("button", { name: /^(Copy|Copied)$/ });
  if (await copy.count()) {
    await copy.last().click().catch(() => undefined);
    clicks.push({ name: "Copy", at: new Date().toISOString() });
    await page.waitForTimeout(400);
  }
}

if (process.env.FORGE_RETRY === "1") {
  const retry = page.getByRole("button", { name: /^Retry$/ });
  if (await retry.count()) {
    await retry.last().click().catch(() => undefined);
    clicks.push({ name: "Retry", at: new Date().toISOString() });
    outcome = await waitIdleAgain();
  }
}

if (process.env.FORGE_REVERT === "1") {
  const revert = page.getByRole("button", { name: "Revert edit", exact: true });
  if (await revert.count()) {
    await revert.last().click().catch(() => undefined);
    clicks.push({ name: "Revert edit", at: new Date().toISOString() });
    await page.waitForTimeout(800);
  }
}

if (process.env.FORGE_COPY === "1") {
  const copyAfter = page.getByRole("button", { name: /^(Copy|Copied)$/ });
  if (await copyAfter.count()) {
    await copyAfter.last().click().catch(() => undefined);
    clicks.push({ name: "Copy", at: new Date().toISOString() });
    await page.waitForTimeout(400);
  }
}

if (process.env.FORGE_OPEN_ARTIFACT === "1") {
  const openBtn = page.getByRole("button", { name: /^Open$/ });
  if (await openBtn.count()) {
    await openBtn.last().click().catch(() => undefined);
    clicks.push({ name: "Open", at: new Date().toISOString() });
    await page.waitForTimeout(600);
  }
}

if (process.env.FORGE_CHOICE_CLICK === "1") {
  const choice = page.locator(".rich-choices button, .rich-choices-grid button, .rich-actions button");
  if (await choice.count()) {
    await choice.first().click().catch(() => undefined);
    clicks.push({ name: "choice", at: new Date().toISOString() });
    await page.waitForTimeout(400);
  }
}

let exportPath = null;
if (process.env.FORGE_EXPORT === "1") {
  const exportBtn = page.getByRole("button", { name: /^Export$/ });
  if (await exportBtn.count()) {
    const dlWait = page.waitForEvent("download", { timeout: 12000 }).catch(() => null);
    await exportBtn.first().click().catch(() => undefined);
    clicks.push({ name: "Export", at: new Date().toISOString() });
    const dl = await dlWait;
    if (dl) {
      exportPath = path.join(outDir, `${tag}-export.md`);
      await dl.saveAs(exportPath);
    }
    await page.waitForTimeout(400);
  }
}

if (chatMode && process.env.FORGE_RELOAD === "1") {
  await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
  const bootWait = Date.now() + 20000;
  while (Date.now() < bootWait) {
    const t = await page.locator("body").innerText().catch(() => "Starting Forge");
    const chatTabReady = await page.getByRole("radio", { name: /^Chat$/ }).count();
    if (!/Starting Forge/.test(t) && chatTabReady) break;
    await page.waitForTimeout(400);
  }
  const chatTab = page.getByRole("radio", { name: /^Chat$/ });
  if (await chatTab.count()) await chatTab.first().click().catch(() => undefined);
  await page.waitForTimeout(800);
}

const skipDiff = process.env.FORGE_SKIP_DIFF === "1" || chatMode;
const viewDiff = page.locator(".file-changes-actions button", { hasText: /^View diff$/ });
if (!skipDiff && (await viewDiff.count())) {
  await viewDiff.first().click().catch(() => undefined);
  clicks.push({ name: "View diff", at: new Date().toISOString() });
  await page.waitForTimeout(400);
}
async function expandYouPrompt() {
  const more = page.locator(".run-prompt .run-prompt-more");
  if (!(await more.count())) return false;
  const label = ((await more.first().textContent()) || "").trim();
  if (/show less/i.test(label)) return true;
  // .run-prompt-more is a span inside .run-prompt-main; role=button /^Show more$/ never matches.
  await more.first().evaluate((el) => {
    const btn = el.closest("button") || el;
    btn.click();
  });
  clicks.push({ name: "Show more", at: new Date().toISOString() });
  await page.waitForTimeout(400);
  return true;
}
const filesJump = page.getByRole("button", { name: /^files /i });
if (!chatMode && (await filesJump.count())) {
  await filesJump.first().click().catch(() => undefined);
  clicks.push({ name: "FILES", at: new Date().toISOString() });
  await page.waitForTimeout(500);
}
async function revealPlanCard() {
  if (process.env.FORGE_REVEAL_PLAN !== "1") return;
  const thought = page.locator(".run-thought[open] summary");
  if (await thought.count()) await thought.first().click().catch(() => undefined);
  const toolsHead = page.locator(".tool-activity-head[aria-expanded='true']");
  if (await toolsHead.count()) await toolsHead.first().click().catch(() => undefined);
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const thoughtEl = document.querySelector(".run-thought");
    if (thoughtEl) thoughtEl.removeAttribute("open");
    const plan = document.querySelector(".plan-section") || document.querySelector(".plan-body");
    const transcript = document.querySelector(".transcript");
    const you = document.querySelector(".run-prompt");
    const strip = document.querySelector(".overview-strip");
    if (!plan || !transcript) return;
    const floor =
      Math.max(
        strip ? strip.getBoundingClientRect().bottom : 0,
        you ? you.getBoundingClientRect().bottom : 0,
      ) + 8;
    const pr = plan.getBoundingClientRect();
    transcript.scrollTop += pr.top - floor;
  }).catch(() => undefined);
  await page.waitForTimeout(200);
}
await revealPlanCard();
const toolsJump = page.getByRole("button", { name: /^tools /i });
if (!chatMode && process.env.FORGE_PLAN !== "1" && process.env.FORGE_PLAN_STOP_ON_ACCEPT !== "1" && (await toolsJump.count())) {
  await toolsJump.first().click().catch(() => undefined);
  clicks.push({ name: "TOOLS", at: new Date().toISOString() });
  await page.waitForTimeout(400);
}
if (!chatMode && process.env.FORGE_EXPAND_TOOLS !== "0" && process.env.FORGE_PLAN_STOP_ON_ACCEPT !== "1") {
  const head = page.locator(".tool-activity-head");
  if (await head.count()) {
    const expanded = await head.first().getAttribute("aria-expanded");
    if (expanded !== "true") {
      await head.first().click().catch(() => undefined);
      clicks.push({ name: "expand tools", at: new Date().toISOString() });
      await page.waitForTimeout(400);
    }
  }
}
if (process.env.FORGE_REVEAL_PLAN !== "1") {
  const cue = page.locator(".turn-delimiter");
  if (await cue.count()) {
    await cue.first().evaluate((el) => {
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
    }).catch(() => undefined);
  }
}
await revealPlanCard();
if (!chatMode && process.env.FORGE_PLAN !== "1") {
  const planBtn = page.getByRole("button", { name: /^Plan$/ });
  if (await planBtn.count()) {
    const pressed = await planBtn.first().getAttribute("aria-pressed");
    if (pressed === "true") {
      await planBtn.first().click().catch(() => undefined);
      clicks.push({ name: "Plan off", at: new Date().toISOString() });
      await page.waitForTimeout(300);
    }
  }
}
if (process.env.FORGE_EXPAND_YOU === "1") {
  await expandYouPrompt();
}
if (process.env.FORGE_YOU_EXPAND === "1") {
  const clampShot = path.join(outDir, `${tag}-clamp.png`);
  await page.screenshot({ path: clampShot, fullPage: true });
  const expanded = await expandYouPrompt();
  if (!expanded) {
    const youBtn = page.locator(".run-prompt-main");
    if (await youBtn.count()) {
      await youBtn.first().evaluate((el) => el.click());
      clicks.push({ name: "You expand", at: new Date().toISOString() });
      await page.waitForTimeout(400);
    }
  }
}
const shot = path.join(outDir, `${tag}.png`);
await page.screenshot({ path: shot, fullPage: true });
const layout = await page.evaluate(() => {
  const box = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      sel,
      text: (el.textContent || "").trim().slice(0, 80),
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.width),
      h: Math.round(r.height),
      visible: r.width > 0 && r.height > 0,
    };
  };
  const overlaps = (a, b) =>
    a &&
    b &&
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y;
  const contains = (outer, inner) =>
    outer &&
    inner &&
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w + 1 &&
    inner.y + inner.h <= outer.y + outer.h + 1;
  const below = (top, bot) =>
    top && bot && bot.y + 1 >= top.y + top.h;
  const strip = box(".overview-strip");
  const grok = box("[data-code-run-provenance]");
  const you = box(".run-prompt");
  const prov = box(".run-provenance");
  const thought = box(".run-thought");
  const toolsHead = box(".tool-activity-head");
  const composer = box(".composer-wrap");
  const newsess = box(".new-session-btn");
  const newsessEl = document.querySelector(".new-session-btn");
  const ns = newsessEl ? getComputedStyle(newsessEl) : null;
  const banner = document.querySelector(".channel-banner");
  const inline = document.querySelector(".md-inline-code");
  const ic = inline ? getComputedStyle(inline) : null;
  return {
    strip,
    grok,
    you,
    prov,
    thought,
    toolsHead,
    planSection: box(".plan-section"),
    planBody: (() => {
      const el = document.querySelector(".plan-body");
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        sel: ".plan-body",
        text: (el.textContent || "").trim().slice(0, 4000),
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
        visible: r.width > 0 && r.height > 0,
      };
    })(),
    toolRows: [...document.querySelectorAll(".tool-row-head, .tool-row-name-plain, .tool-row")]
      .slice(0, 12)
      .map((el) => (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 160)),
    composer,
    newsess,
    newsessClass: newsessEl?.className ?? null,
    newsessBg: ns?.backgroundImage || ns?.backgroundColor || null,
    newsessShadow: ns?.boxShadow || null,
    navTabs: (() => {
      const msgs = document.querySelector(".nav-tabs button.active") || document.querySelector(".nav-tabs button");
      if (!msgs) return null;
      const s = getComputedStyle(msgs);
      return {
        text: (msgs.textContent || "").trim(),
        bg: s.backgroundColor,
        border: s.border,
        shadow: s.boxShadow,
      };
    })(),
    banner: (banner?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 160),
    errorBanner: (document.querySelector(".banner-error")?.textContent || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160),
    inlineCode: inline
      ? {
          text: (inline.textContent || "").slice(0, 40),
          bg: ic?.backgroundColor,
          border: ic?.border,
          radius: ic?.borderRadius,
          pad: ic?.padding,
        }
      : null,
    fileChangesBox: box(".file-changes"),
    fileChangesHeader: box(".file-changes-header"),
    answered: box(".run-answered"),
    yourTurn: box(".turn-delimiter"),
    piChip: (() => {
      const el = document.querySelector(".project-instructions-status.is-loaded .project-instructions-chip");
      if (!el) return null;
      const s = getComputedStyle(el);
      return {
        text: (el.textContent || "").trim().slice(0, 80),
        bg: s.backgroundColor,
        border: s.border,
        shadow: s.boxShadow,
        pad: s.padding,
      };
    })(),
    atMenu: box(".at-menu"),
    showMore: box(".run-prompt-more"),
    youExpanded: Boolean(document.querySelector(".run-prompt")?.classList.contains("is-expanded")),
    youChevron: box(".run-prompt-chevron"),
    browserWork: box(".browser-work"),
    planDock: box("[data-plan-dock]"),
    mcpServers: box(".mcp-servers"),
    childAgents: box(".child-agents"),
    hooks: box(".hooks"),
    hideDiff: (() => {
      const el = [...document.querySelectorAll("button")].find((b) => /^(Hide diff|View diff)$/.test(b.textContent || ""));
      if (!el) return null;
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        text: (el.textContent || "").trim(),
        className: el.className,
        bg: s.backgroundColor,
        border: s.border,
        radius: s.borderRadius,
        h: Math.round(r.height),
        pad: s.padding,
      };
    })(),
    mode: (document.querySelector(".brand-mode")?.textContent || "").trim(),
    chatRadioChecked:
      document.querySelector('.mode-seg[aria-label="Chat"]')?.getAttribute("aria-checked") || null,
    effortExpert:
      document.querySelector('.effort-chip[aria-label="Expert"]')?.getAttribute("aria-checked") ||
      null,
    emptyHeading: (document.querySelector(".empty-state h1")?.textContent || "").trim(),
    homeName: (document.querySelector(".chat-home-name")?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80),
    openCount: [...document.querySelectorAll("button")].filter((b) => (b.textContent || "").trim() === "Open").length,
    artifactPanel: box(".artifact-panel"),
    artifactBody: (document.querySelector(".artifact-panel-body")?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 800),
    compactAnswer: Boolean(
      document.querySelector(".assistant-answer--compact, .msg-body--artifact-compact"),
    ),
    hiddenBubble: Boolean(document.querySelector(".msg-body[hidden], .assistant-answer[hidden]")),
    richChoices: document.querySelectorAll(
      ".rich-choices button, .rich-choices-grid button, .rich-actions button",
    ).length,
    composerDraft: (document.querySelector("#composer-input")?.value || "").slice(0, 500),
    composerEnabled: !document.querySelector("#composer-input")?.disabled,
    composerSend: [...document.querySelectorAll(".composer-wrap button")].some(
      (b) => (b.textContent || "").trim() === "Send",
    ),
    composerCancel: [...document.querySelectorAll(".composer-wrap button")].some(
      (b) => /^(Cancel|Cancel run)$/.test((b.textContent || "").trim()),
    ),
    copyPresent: [...document.querySelectorAll("button")].some((b) =>
      /^(Copy|Copied)$/.test((b.textContent || "").trim()),
    ),
    copied: [...document.querySelectorAll("button")].some((b) => (b.textContent || "").trim() === "Copied"),
    planArm: Boolean(document.querySelector("[data-plan-arm]")),
    fileChangesChrome: Boolean(document.querySelector(".file-changes")),
    skillsCatalogChrome: Boolean(document.querySelector(".skills-catalog, .skills-palette")),
    grokInsideYou: contains(you, grok),
    grokBelowStrip: below(strip, grok),
    grokCoveredByStrip: overlaps(grok, strip) && !contains(strip, grok),
    provInsideYou: contains(you, prov),
    thoughtBelowYou: below(you, thought),
    thoughtCoveredByYou: overlaps(thought, you) && !contains(you, thought),
    toolsHeadBelowYou: below(you, box(".tool-activity-head")),
    toolsHeadCoveredByYou:
      overlaps(box(".tool-activity-head"), you) &&
      !contains(you, box(".tool-activity-head")),
    fileHeadBelowYou: below(you, box(".file-changes-header")),
    fileHeadCoveredByYou:
      overlaps(box(".file-changes-header"), you) &&
      !contains(you, box(".file-changes-header")),
    fileHeadBelowThought: below(thought, box(".file-changes-header")),
    fileHeadCoveredByThought:
      overlaps(box(".file-changes-header"), thought) &&
      !contains(thought, box(".file-changes-header")),
    answeredCoveredByComposer: overlaps(box(".run-answered"), composer),
    yourTurnCoveredByComposer: overlaps(box(".turn-delimiter"), composer),
    toasts: [...document.querySelectorAll(".toast")].map((el) => (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80)),
    toastCount: document.querySelectorAll(".toast").length,
    toastStack: box(".toast-stack"),
    exportBtn: (() => {
      const el = [...document.querySelectorAll(".composer-wrap button")].find(
        (b) => (b.textContent || "").trim() === "Export",
      );
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    })(),
    exportCoveredByToast: (() => {
      const exp = [...document.querySelectorAll(".composer-wrap button")].find(
        (b) => (b.textContent || "").trim() === "Export",
      );
      const stack = document.querySelector(".toast-stack");
      if (!exp || !stack) return false;
      const a = exp.getBoundingClientRect();
      const b = stack.getBoundingClientRect();
      return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
    })(),
  };
});
const body = (await page.locator("body").innerText()).slice(0, 8000);
const fileChangesRegion = page.getByRole("region", { name: "File changes" });
const fileChanges = (await fileChangesRegion.count()) > 0;
const fileChangesText = fileChanges ? (await fileChangesRegion.innerText()).slice(0, 1200) : "";
const filesLine = (body.match(/\bFILES\b[^\n]*/i) || [""])[0].trim();
const maxDepth = logs.some((l) => /Maximum update depth exceeded/.test(l));
const report = {
  opened,
  outcome,
  clicks,
  prompt,
  followUp: process.env.FORGE_FOLLOWUP || null,
  emptyBeforeSend,
  exportPath,
  chatMode,
  body,
  fileChanges,
  fileChangesText,
  filesLine,
  layout,
  pickState,
  busySecond,
  maxDepth,
  console: logs.slice(0, 40),
  shot,
  midShot,
};
fs.writeFileSync(path.join(outDir, `${tag}.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  outcome,
  clicks: clicks.map((c) => c.name),
  shot,
  fileChanges,
  filesLine,
  pickState,
  busySecond,
  emptyBeforeSend,
  exportPath,
  maxDepth,
  layout,
  fileChangesText: fileChangesText.slice(0, 300),
  bodyTail: body.slice(-1200),
}, null, 2));
if (!cdp) await browser.close();
process.exit(0);
