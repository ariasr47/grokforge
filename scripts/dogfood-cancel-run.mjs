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
const clicks = [];
for (const name of ["Cancel run", "Cancel", "Keep planning", "Accept plan"]) {
  const b = page.getByRole("button", { name, exact: true });
  if (await b.count()) {
    await b.first().click().catch(() => undefined);
    clicks.push(name);
    await page.waitForTimeout(400);
  }
}
await page.screenshot({ path: "docs/dogfood/forge-cancel-plan.png", fullPage: true });
const body = (await page.locator("body").innerText()).slice(0, 2500);
console.log(JSON.stringify({
  clicks,
  waiting: /Waiting for model|A run is in progress/.test(body),
  // 2819b97 deleted the "Your turn" delimiter — the newest response turn's
  // spine node carries run state now: filled live / amber waiting for a
  // decision / rose failed / done answered.
  turnNode: await page.evaluate(() => {
    const nodes = document.querySelectorAll(".response-turn .node");
    const el = nodes[nodes.length - 1];
    return el ? (el.className.match(/node--(\w+)/) || [])[1] || null : null;
  }),
  planHelper: /Explore and propose/.test(body),
  acceptPlan: await page.getByRole("button", { name: "Accept plan" }).count(),
  bodyTail: body.slice(-800),
}, null, 2));
await browser.close();
