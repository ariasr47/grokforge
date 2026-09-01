#!/usr/bin/env node
/**
 * Review-mode edit through the action dock.
 * Writes docs/dogfood/PROBE.md — delete after the loop if you want.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const url = process.argv[2] || "http://127.0.0.1:5174/";
const workspace = process.argv[3] || "C:\\Dev\\grokforge";
const probeRel = "docs/dogfood/PROBE.md";
const probeAbs = path.resolve(probeRel);
const outDir = path.resolve("docs/dogfood");
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.setDefaultTimeout(30000);
const logs = [];
page.on("console", (msg) => logs.push(`${msg.type()}: ${msg.text()}`));
page.on("pageerror", (err) => logs.push(`pageerror: ${err.message}`));

await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
for (const name of ["Skip", "Code — repo agent"]) {
  const b = page.getByRole("button", { name });
  if (await b.count()) await b.first().click().catch(() => undefined);
}
const codeTab = page.getByRole("button", { name: /^Code$/ });
if (await codeTab.count()) await codeTab.first().click().catch(() => undefined);
await page.waitForTimeout(800);

const opened = await page.evaluate(async (ws) => {
  const r = await fetch("/api/workspace", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: ws }),
  });
  return { status: r.status, text: (await r.text()).slice(0, 400) };
}, workspace);
await page.waitForTimeout(2500);

await page.getByLabel("Message to agent").fill(
  `In Review mode, create the file ${probeRel} containing exactly the line:\nPROBE-OK\nDo not edit any other file. After writing, stop.`,
);
await page.getByRole("button", { name: "Send" }).click();

const clicks = [];
const deadline = Date.now() + 150000;
let outcome = "timeout";
while (Date.now() < deadline) {
  for (const name of ["Allow once", "Accept", "Accept all"]) {
    const btn = page.getByRole("button", { name, exact: true });
    if (await btn.count()) {
      await btn.first().click().catch(() => undefined);
      clicks.push({ name, at: Date.now() });
      await page.waitForTimeout(800);
    }
  }
  const body = await page.locator("body").innerText();
  const waiting = /Waiting for model|Waiting for Grok|Writing…|Thinking/.test(body);
  const idle = /YOUR TURN|Your turn/.test(body);
  const failed = /Run failed|Couldn't load/.test(body);
  if (failed && idle) {
    outcome = "failed-chrome";
    break;
  }
  if (idle && !waiting && fs.existsSync(probeAbs)) {
    outcome = "wrote";
    break;
  }
  if (idle && !waiting && clicks.length > 0) {
    outcome = "idle-after-dock";
    break;
  }
  await page.waitForTimeout(1500);
}

const shot = path.join(outDir, "edit-turn.png");
await page.screenshot({ path: shot, fullPage: true });
const body = (await page.locator("body").innerText()).slice(0, 7000);
const onDisk = fs.existsSync(probeAbs)
  ? fs.readFileSync(probeAbs, "utf8").slice(0, 200)
  : null;
const report = { opened, outcome, clicks, onDisk, body, console: logs.slice(0, 40), shot };
fs.writeFileSync(path.join(outDir, "edit-turn.json"), JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    {
      outcome,
      clicks,
      onDisk,
      shot,
      bodyTail: body.slice(-900),
    },
    null,
    2,
  ),
);
await browser.close();
