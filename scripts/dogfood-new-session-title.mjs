import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://127.0.0.1:5174/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
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
await page.waitForTimeout(1500);
const ns = page.getByRole("button", { name: "New session" });
if (await ns.count()) await ns.last().click();
await page.waitForTimeout(800);
const titles = await page.locator(".session-row").evaluateAll((els) =>
  els.map((el) => (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80)),
);
await page.screenshot({ path: "docs/dogfood/forge-new-session-title.png", fullPage: true });
const newChat = await page.getByText("New chat", { exact: true }).count();
const newSessionRows = await page.locator(".session-row", { hasText: "New session" }).count();
console.log(JSON.stringify({ titles, newChat, newSessionRows }, null, 2));
await browser.close();
