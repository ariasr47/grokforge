/**
 * Live browser check: Chat RunSurface must render grok-ui components,
 * not a JSON dump. Starts Vite on 5199 so it does not collide with Tauri.
 */
import { chromium } from "playwright";
import { createServer } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shell = path.join(root, "apps", "shell");
const port = 5199;
const screenshot = path.join(root, "apps", "shell", "verify-grok-ui.png");

const server = await createServer({
  root: shell,
  configFile: path.join(shell, "vite.config.ts"),
  server: { port, strictPort: true, host: "127.0.0.1" },
});
let browser;
try {
  await server.listen();
  const urls = server.resolvedUrls?.local ?? [];
  const base = urls[0] || `http://127.0.0.1:${port}`;
  console.log("vite", base);

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  await page.goto(`${base.replace(/\/$/, "")}/verify-grok-ui.html`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForSelector(".assistant-answer", { timeout: 10_000 });
  await page.waitForSelector("#verify-primary", { timeout: 5_000 });

  const hover = await page.locator("#verify-primary").evaluate((el) => {
    const rest = getComputedStyle(el);
    el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    el.classList.add("force-hover");
    return { restColor: rest.color, restBg: rest.backgroundImage };
  });
  await page.locator("#verify-primary").hover();
  const hovered = await page.locator("#verify-primary").evaluate((el) => {
    const s = getComputedStyle(el);
    return { color: s.color, bgImage: s.backgroundImage, bgColor: s.backgroundColor };
  });

  const report = await page.evaluate(() => {
    const answer = document.querySelector(".assistant-answer");
    const text = answer?.textContent ?? "";
    return {
      hasAnswer: Boolean(answer),
      hasCallout: Boolean(answer?.querySelector(".rich-callout")),
      hasCarousel: Boolean(answer?.querySelector(".rich-carousel")),
      hasTabs: Boolean(answer?.querySelector(".rich-tabs, [role='tablist']")),
      hasChecklist: Boolean(answer?.querySelector(".rich-checklist, .md-task")),
      hasFenceDump: text.includes("```grok-ui"),
      hasVersionJson: text.includes('"version": 1') || text.includes('"version":1'),
      calloutTitle: answer?.querySelector(".rich-callout-title")?.textContent ?? null,
      chatHidesFileChanges: !document.querySelector('[aria-label="File changes"]'),
      chatHidesVerify: !document.querySelector('[aria-label="Verify"]'),
    };
  });

  await page.screenshot({ path: screenshot, fullPage: true });

  const fail = [];
  if (errors.length) fail.push(`page errors: ${errors.join(" | ")}`);
  if (!report.hasAnswer) fail.push("missing .assistant-answer");
  if (!report.hasCallout) fail.push("missing callout");
  if (!report.hasCarousel) fail.push("missing carousel");
  if (report.hasFenceDump) fail.push("still showing ```grok-ui fence");
  if (report.hasVersionJson) fail.push("still showing raw version JSON");
  if (report.calloutTitle !== "Keep it to 5–6 sides") {
    fail.push(`callout title was ${JSON.stringify(report.calloutTitle)}`);
  }
  if (!report.chatHidesFileChanges) fail.push("Chat still shows File changes");
  if (!report.chatHidesVerify) fail.push("Chat still shows Verify");
  const ink = hovered.color.replace(/\s/g, "");
  const darkInk = ink === "rgb(4,16,22)" || ink === "rgba(4,16,22,1)";
  const hasGradient = /gradient/i.test(hovered.bgImage);
  if (!darkInk) fail.push(`primary hover ink was ${hovered.color}, expected #041016`);
  if (!hasGradient) fail.push(`primary hover lost gradient (${hovered.bgImage} / ${hovered.bgColor})`);
  console.log(JSON.stringify({ hover, hovered }, null, 2));

  console.log(JSON.stringify({ report, screenshot, fail }, null, 2));
  if (fail.length) {
    console.error("VERIFY FAILED");
    process.exitCode = 1;
  } else {
    console.log("VERIFY PASS");
  }
} finally {
  await browser?.close().catch(() => undefined);
  await server.close().catch(() => undefined);
}

if (fs.existsSync(screenshot) && !process.exitCode) {
  console.log(`screenshot ${screenshot}`);
}
