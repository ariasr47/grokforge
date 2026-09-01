import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const url = "http://127.0.0.1:5174/";
const workspace = "C:\\Dev\\grokforge";
const outDir = path.resolve("docs/dogfood");
const prompt = [
  "Reply with FORGE-YOU-OK and stop. Do not edit files.",
  "Line two of this You-card clamp check continues the prompt.",
  "Line three must appear only after expand.",
  "Line four also after expand.",
].join("\n");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(30000);
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
for (const name of ["Skip", "Code — repo agent"]) {
  const b = page.getByRole("button", { name });
  if (await b.count()) await b.first().click().catch(() => undefined);
}
const codeTab = page.getByRole("button", { name: /^Code$/ });
if (await codeTab.count()) await codeTab.first().click().catch(() => undefined);
await page.evaluate(async (ws) => {
  await fetch("/api/workspace", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: ws }),
  });
}, workspace);
await page.waitForTimeout(1500);
const startNew = page.getByRole("button", { name: "Start a new conversation" });
if (await startNew.count()) await startNew.first().click().catch(() => undefined);
await page.waitForTimeout(800);
const box = page.getByLabel("Message to agent");
await box.fill(prompt);
const send = page.getByRole("button", { name: "Send" });
const sendWait = Date.now() + 15000;
while (Date.now() < sendWait && (await send.isDisabled())) await page.waitForTimeout(300);
if (await send.isEnabled()) await send.click();
else await box.press("Enter");
await page.locator(".run-prompt-main").first().waitFor({ state: "visible", timeout: 20000 });
await page.waitForTimeout(400);
const measure = () =>
  page.evaluate(() => {
    const card = document.querySelector(".run-prompt");
    const body = document.querySelector(".run-prompt-body");
    const r = body?.getBoundingClientRect();
    return {
      expanded: Boolean(card?.classList.contains("is-expanded")),
      aria: document.querySelector(".run-prompt-main")?.getAttribute("aria-expanded"),
      more: (document.querySelector(".run-prompt-more")?.textContent || "").trim(),
      h: Math.round(r?.height || 0),
      text: (body?.textContent || "").slice(0, 280),
    };
  });
const before = await measure();
await page.screenshot({ path: path.join(outDir, "forge-you-clamp.png"), fullPage: true });
await page.locator(".run-prompt-main").first().click();
await page.waitForTimeout(250);
const after = await measure();
await page.screenshot({ path: path.join(outDir, "forge-you-expand.png"), fullPage: true });
fs.writeFileSync(path.join(outDir, "forge-you-expand.json"), JSON.stringify({ before, after }, null, 2));
console.log(JSON.stringify({ before, after }, null, 2));
await browser.close();
