import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const outDir = path.resolve("docs/dogfood");
fs.mkdirSync(outDir, { recursive: true });
const alarm = "Forge didn't find your earlier conversations.";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://127.0.0.1:5174/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1800);
for (const name of ["Skip", "Code — repo agent"]) {
  const b = page.getByRole("button", { name });
  if (await b.count()) await b.first().click().catch(() => undefined);
}
const codeTab = page.getByRole("button", { name: /^Code$/ });
if (await codeTab.count()) await codeTab.first().click().catch(() => undefined);
await page.evaluate(async () => {
  await fetch("/api/workspace", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: "C:\\Dev\\grokforge" }),
  });
});
await page.waitForTimeout(1200);
const before = await page.getByText(alarm).count();
const start = page.getByRole("button", { name: "Start a new conversation" });
if (await start.count()) await start.first().click();
await page.waitForTimeout(800);
const after = await page.getByText(alarm).count();
// The "Code continuum" heading is gone. A fresh session lands on the home
// hero, whose h1 is a time-of-day greeting — probe the surface and report the
// line, rather than matching copy that changes by the hour.
const homeHero = await page.evaluate(() => {
  const h = document.querySelector(".home-hero h1");
  return h ? (h.textContent || "").trim().slice(0, 80) : null;
});
const composerPh = await page.getByLabel("Message to agent").getAttribute("placeholder");
const sendDisabled = await page.getByRole("button", { name: "Send" }).isDisabled();
const shot = path.join(outDir, "forge-start-new.png");
await page.screenshot({ path: shot, fullPage: false });
const report = { before, after, homeHero, composerPh, sendDisabled, shot };
fs.writeFileSync(path.join(outDir, "STARTNEW.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
