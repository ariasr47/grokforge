#!/usr/bin/env node
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const url = process.argv[2] || "http://127.0.0.1:5174/";
const workspace = process.argv[3] || "C:\\Dev\\grokforge";
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
const skip = page.getByRole("button", { name: "Skip" });
if (await skip.count()) await skip.first().click().catch(() => undefined);

const codeChoice = page.getByRole("button", { name: "Code — repo agent" });
if (await codeChoice.count()) await codeChoice.first().click().catch(() => undefined);
const codeTab = page.getByRole("button", { name: /^Code$/ });
if (await codeTab.count()) await codeTab.first().click().catch(() => undefined);
await page.waitForTimeout(1500);

const opened = await page.evaluate(async (ws) => {
  const r = await fetch("/api/workspace", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: ws }),
  });
  const text = await r.text();
  return { status: r.status, text: text.slice(0, 500) };
}, workspace);
await page.waitForTimeout(2500);

const composer = page.getByLabel("Message to agent");
await composer.click();
await composer.fill(
  "Do not edit any files. Reply with exactly FORGE-CODE-OK and the workspace folder basename.",
);
await page.getByRole("button", { name: "Send" }).click();

const deadline = Date.now() + 90000;
let outcome = "timeout";
while (Date.now() < deadline) {
  const body = await page.locator("body").innerText();
  const waiting = body.includes("Waiting for model") || body.includes("Waiting for Grok");
  const yourTurn = /\bYour turn\b/.test(body);
  const answerHit = await page.getByText("FORGE-CODE-OK", { exact: false }).count();
  if (!waiting && yourTurn && answerHit >= 2) {
    outcome = "answered";
    break;
  }
  if (!waiting && yourTurn && body.includes("Run failed")) {
    outcome = "failed-chrome";
    break;
  }
  if (body.includes("Allow") && body.includes("Decline")) {
    outcome = "permission-dock";
    break;
  }
  await page.waitForTimeout(2000);
}

const shot = path.join(outDir, "code-turn.png");
await page.screenshot({ path: shot, fullPage: true });
const body = (await page.locator("body").innerText()).slice(0, 6000);
const report = { opened, outcome, body, console: logs.slice(0, 50), shot };
fs.writeFileSync(path.join(outDir, "code-turn.json"), JSON.stringify(report, null, 2));
const banned = {
  thinkingField: /Thinking field/i.test(body),
  shoutedIdle: /type the next message/i.test(body),
};
console.log(JSON.stringify({ outcome, opened, shot, banned, bodyTail: body.slice(-800), console: logs.slice(0, 20) }, null, 2));
await browser.close();
