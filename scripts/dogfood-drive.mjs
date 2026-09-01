#!/usr/bin/env node
/**
 * Drive the from-source Forge UI (dev channel) for dogfood.
 * Usage: node scripts/dogfood-drive.mjs [url]
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const url = process.argv[2] || "http://localhost:5174/";
const outDir = path.resolve("docs/dogfood");
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.setDefaultTimeout(20000);

const logs = [];
page.on("console", (msg) => logs.push(`${msg.type()}: ${msg.text()}`));
page.on("pageerror", (err) => logs.push(`pageerror: ${err.message}`));

await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);

const shot = path.join(outDir, "session-open.png");
await page.screenshot({ path: shot, fullPage: true });

const text = (await page.locator("body").innerText()).slice(0, 4000);
const buttons = await page.getByRole("button").allTextContents();
const tabs = await page.getByRole("tab").allTextContents().catch(() => []);
const textboxes = await page.getByRole("textbox").allTextContents().catch(() => []);

const report = {
  url,
  title: await page.title(),
  buttons: buttons.slice(0, 40),
  tabs,
  textboxes: textboxes.slice(0, 10),
  bodyPreview: text,
  console: logs.slice(0, 40),
};
fs.writeFileSync(path.join(outDir, "session-open.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ shot, title: report.title, buttons: report.buttons, tabs: report.tabs, console: report.console.slice(0, 15) }, null, 2));

await browser.close();
