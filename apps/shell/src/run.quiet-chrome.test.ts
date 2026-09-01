import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const css = readFileSync(path.join(root, "styles", "run.css"), "utf8");
const chrome = readFileSync(path.join(root, "styles", "chrome.css"), "utf8");
const dock = readFileSync(path.join(root, "styles", "dock.css"), "utf8");
const settings = readFileSync(path.join(root, "styles", "settings.css"), "utf8");

function ruleBody(selector: string): string {
  const re = new RegExp(
    `${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]+)\\}`,
  );
  const m = css.match(re);
  assert.ok(m?.[1], `missing ${selector} rule`);
  return m[1]!;
}

describe("settled-turn chrome is quiet", () => {
  it("inline code is not a bordered chip", () => {
    const body = ruleBody(".md-inline-code");
    assert.doesNotMatch(body, /border\s*:/);
    assert.doesNotMatch(body, /border-radius/);
    assert.doesNotMatch(body, /background:\s*color-mix/);
    assert.match(body, /background:\s*none/);
  });

  it("tool row status is not shouted uppercase", () => {
    const body = ruleBody(".tool-row-status");
    assert.doesNotMatch(body, /text-transform\s*:\s*uppercase/);
  });

  it("F1 wait heading is not shouted uppercase", () => {
    const body = ruleBody(".thinking-placeholder-head");
    assert.doesNotMatch(body, /text-transform\s*:\s*uppercase/);
  });

  it("session agent badge is not shouted uppercase", () => {
    const body = ruleBody(".badge");
    assert.doesNotMatch(body, /text-transform\s*:\s*uppercase/);
    assert.match(body, /text-transform:\s*none/);
    assert.match(body, /border:\s*none/);
    assert.match(body, /background:\s*none/);
  });

  it("empty composer textarea is not a 14px-padded sausage", () => {
    const m = chrome.match(/\.composer textarea\s*\{([^}]+)\}/);
    assert.ok(m?.[1], "missing .composer textarea");
    assert.match(m[1]!, /padding:\s*8px 16px/);
    assert.doesNotMatch(m[1]!, /padding:\s*14px 20px/);
    assert.match(m[1]!, /min-height:\s*40px/);
  });

  it("disabled Send does not keep the plasma glow", () => {
    const m = chrome.match(
      /\.composer\s*>\s*\.btn\.primary:disabled\s*\{([^}]+)\}/,
    );
    assert.ok(m?.[1], "missing .composer > .btn.primary:disabled");
    assert.match(m[1]!, /box-shadow\s*:\s*none/);
  });

  it("main panel and composer stay in the viewport stack", () => {
    const panel = chrome.match(/\.main-panel\s*\{([^}]+)\}/);
    assert.ok(panel?.[1], "missing .main-panel");
    assert.match(panel[1]!, /min-height\s*:\s*0/);
    const wrap = css.match(/\.composer-wrap\s*\{([^}]+)\}/);
    assert.ok(wrap?.[1], "missing .composer-wrap");
    assert.match(wrap[1]!, /flex-shrink\s*:\s*0/);
    const tr = chrome.match(/\.transcript\s*\{([^}]+)\}/);
    assert.ok(tr?.[1], "missing .transcript");
    assert.match(tr[1]!, /padding:\s*12px 28px 56px/);
    assert.match(tr[1]!, /scroll-padding-bottom:\s*24px/);
  });

  it("toasts sit above the composer so Export stays clickable", () => {
    // Live desktop-chat-export: "Downloaded chat as Markdown" covered Export.
    const m = dock.match(/\.toast-stack\s*\{([^}]+)\}/);
    assert.ok(m?.[1], "missing .toast-stack");
    assert.match(m[1]!, /bottom:\s*calc\(var\(--composer-height/);
    assert.doesNotMatch(m[1]!, /bottom:\s*16px/);
  });

  it("overview strip is opaque so a scrolled prompt does not show through", () => {
    const body = ruleBody(".overview-strip");
    assert.match(body, /background:\s*var\(--bg\)/);
    assert.doesNotMatch(body, /rgba\(255,\s*255,\s*255/);
  });

  it("You-card provenance separates Grok Code from Model with a middot", () => {
    const m = chrome.match(
      /\.run-prompt \.run-provenance > \* \+ \*::before\s*\{([^}]+)\}/,
    );
    assert.ok(m?.[1], "missing You-card provenance separator");
    assert.match(m[1]!, /content:\s*"·"/);
  });

  it("Answered is a compact chip, not the full-width run-status bar", () => {
    const body = ruleBody(".run-answered");
    assert.match(body, /width:\s*max-content/);
    assert.match(body, /display:\s*inline-flex/);
    assert.doesNotMatch(body, /justify-content:\s*space-between/);
  });

  it("File changes path row is not a nested inner card", () => {
    const m = chrome.match(/\.file-changes-path-details\s*\{([^}]+)\}/);
    assert.ok(m?.[1], "missing .file-changes-path-details");
    assert.match(m[1]!, /background:\s*transparent/);
    assert.match(m[1]!, /border:\s*none/);
    assert.match(m[1]!, /padding:\s*0/);
    assert.match(chrome, /\.run-content details\.file-changes-path-details/);
    const head = chrome.match(/\.file-changes-row-head\s*\{([^}]+)\}/);
    assert.ok(head?.[1], "missing .file-changes-row-head");
    assert.match(head[1]!, /position:\s*sticky/);
    assert.match(head[1]!, /top:\s*calc\(var\(--run-file-stick-below\) \+ 24px\)/);
    assert.match(head[1]!, /background:\s*var\(--bg\)/);
  });

  it("File changes View/Hide diff is a text control, not a pill", () => {
    const btn = chrome.match(
      /\.file-changes-actions \.btn\.ghost\s*\{([^}]+)\}/,
    );
    assert.ok(btn?.[1], "missing .file-changes-actions .btn.ghost");
    assert.match(btn[1]!, /border:\s*none/);
    assert.match(btn[1]!, /background:\s*transparent/);
    assert.match(btn[1]!, /min-height:\s*0/);
    const extra = chrome.match(/\.activity-diff-toggle\.btn\.ghost\s*\{([^}]+)\}/);
    assert.ok(extra?.[1], "missing .activity-diff-toggle.btn.ghost");
    assert.match(extra[1]!, /border:\s*none/);
    assert.match(extra[1]!, /background:\s*transparent/);
    assert.match(extra[1]!, /min-height:\s*0/);
  });

  it("File changes diff contains nested overscroll so it does not steal the transcript", () => {
    const m = chrome.match(/\.file-changes-diff\s*\{([^}]+)\}/);
    assert.ok(m?.[1], "missing .file-changes-diff");
    assert.match(m[1]!, /overscroll-behavior:\s*contain/);
    assert.match(m[1]!, /max-width:\s*100%/);
    const line = chrome.match(/\.file-changes-diff \.diff-line\s*\{([^}]+)\}/);
    assert.ok(line?.[1], "missing .file-changes-diff .diff-line");
    assert.match(line[1]!, /white-space:\s*pre-wrap/);
    assert.match(line[1]!, /width:\s*max-content/);
    assert.match(line[1]!, /max-width:\s*100%/);
  });

  it("sidebar Messages/Settings tabs are not filled pills", () => {
    const btn = chrome.match(/\.nav-tabs button\s*\{([^}]+)\}/);
    assert.ok(btn?.[1], "missing .nav-tabs button");
    assert.match(btn[1]!, /background:\s*transparent/);
    assert.match(btn[1]!, /border:\s*none/);
    const active = chrome.match(/\.nav-tabs button\.active\s*\{([^}]+)\}/);
    assert.ok(active?.[1], "missing .nav-tabs button.active");
    assert.match(active[1]!, /background:\s*transparent/);
    assert.doesNotMatch(active[1]!, /background:\s*var\(--bg3\)/);
    assert.doesNotMatch(active[1]!, /border:\s*1px/);
  });

  it("collapsed Git review is a compact fold, not a padded empty card", () => {
    // Live desktop-git-status: Git review 1 / 1 status was a full-width empty well.
    const m = chrome.match(
      /\.git-review:not\(:has\(\.git-review-list\)\)\s*\{([^}]+)\}/,
    );
    assert.ok(m?.[1], "missing collapsed .git-review rule");
    assert.match(m[1]!, /padding:\s*4px 12px/);
    assert.match(m[1]!, /width:\s*max-content/);
    assert.match(m[1]!, /justify-self:\s*start/);
    assert.doesNotMatch(m[1]!, /padding:\s*12px 14px/);
  });

  it("collapsed Thought is a compact fold, not a padded empty card", () => {
    const m = chrome.match(
      /\.run-content details\.run-thought:not\(\[open\]\)\s*\{([^}]+)\}/,
    );
    assert.ok(m?.[1], "missing collapsed .run-thought rule");
    assert.match(m[1]!, /padding:\s*4px 12px/);
    assert.match(m[1]!, /margin:\s*0/);
    assert.match(m[1]!, /position:\s*sticky/);
    assert.match(m[1]!, /top:\s*var\(--run-prompt-stick-below/);
    assert.match(m[1]!, /z-index:\s*4/);
    assert.doesNotMatch(m[1]!, /padding:\s*12px 14px/);
  });

  it("TOOLS jump target clears the sticky You card", () => {
    const body = ruleBody(".tool-activity-head");
    assert.match(body, /scroll-margin-top:\s*var\(--run-prompt-stick-below/);
  });

  it("collapsed Thought paints full width so File changes cannot show beside the chip", () => {
    // Live desktop-d7-parse-recapture: Thought w=82 let open-diff lines sit to the right.
    const m = chrome.match(
      /\.run-content details\.run-thought:not\(\[open\]\)\s*\{([^}]+)\}/,
    );
    assert.ok(m?.[1], "missing collapsed .run-thought rule");
    assert.match(m[1]!, /justify-self:\s*stretch/);
    assert.match(m[1]!, /background:\s*var\(--bg\)/);
    assert.match(m[1]!, /0 14px 0 0 var\(--bg\)/);
    assert.doesNotMatch(m[1]!, /width:\s*max-content/);
    const sum = chrome.match(
      /\.run-content details\.run-thought:not\(\[open\]\) > summary\s*\{([^}]+)\}/,
    );
    assert.ok(sum?.[1], "missing collapsed Thought summary compact width");
    assert.match(sum[1]!, /width:\s*max-content/);
  });

  it("accepted Plan body keeps numbered steps on their own lines", () => {
    // Live desktop-plan-do-plan: plan-body text had 1./2./3. newlines but h=35 mashed them.
    const m = chrome.match(/^\.plan-body\s*\{([^}]+)\}/m);
    assert.ok(m?.[1], "missing dedicated .plan-body rule");
    assert.match(m[1]!, /white-space:\s*pre-wrap/);
    assert.match(m[1]!, /overflow-wrap:\s*anywhere/);
  });

  it("File changes header sticks below the You card", () => {
    const tr = chrome.match(/\.transcript\s*\{([^}]+)\}/);
    assert.ok(tr?.[1], "missing .transcript");
    assert.match(tr[1]!, /--run-prompt-stick-below:\s*88px/);
    const runContent = chrome.match(/\.run-content\s*\{([^}]+)\}/);
    assert.ok(runContent?.[1], "missing .run-content file-stick default");
    assert.match(runContent[1]!, /--run-file-stick-below:\s*var\(--run-prompt-stick-below\)/);
    assert.equal(
      chrome.match(/\.run-content:has\(\.run-thought:not\(\[open\]\)\)\s*\{/),
      null,
      "collapsed Thought must not bump File changes sticky offset",
    );
    const section = chrome.match(/\.file-changes\s*\{([^}]+)\}/);
    assert.ok(section?.[1], "missing .file-changes");
    assert.match(section[1]!, /background:\s*var\(--bg\)/);
    assert.match(section[1]!, /scroll-margin-top:\s*var\(--run-file-stick-below\)/);
    assert.doesNotMatch(section[1]!, /background:\s*var\(--card\)/);
    const hdr = chrome.match(/\.file-changes-header\s*\{([^}]+)\}/);
    assert.ok(hdr?.[1], "missing .file-changes-header");
    assert.match(hdr[1]!, /position:\s*sticky/);
    assert.match(hdr[1]!, /top:\s*var\(--run-file-stick-below\)/);
    assert.match(hdr[1]!, /background:\s*var\(--bg\)/);
    assert.match(hdr[1]!, /z-index:\s*1/);
  });

  it("idle Your turn is a chip in document flow, not a sticky overlay", () => {
    const m = chrome.match(/\.transcript > \.turn-delimiter\s*\{([^}]+)\}/);
    assert.ok(m?.[1], "missing .transcript > .turn-delimiter");
    assert.match(m[1]!, /width:\s*max-content/);
    assert.match(m[1]!, /background:\s*var\(--bg\)/);
    assert.match(m[1]!, /box-shadow:\s*none/);
    assert.doesNotMatch(m[1]!, /position:\s*sticky/);
    assert.doesNotMatch(m[1]!, /align-self:\s*stretch/);
    const line = chrome.match(
      /\.transcript > \.turn-delimiter \.turn-delimiter-line\s*\{([^}]+)\}/,
    );
    assert.ok(line?.[1], "missing Your turn line hide");
    assert.match(line[1]!, /display:\s*none/);
  });

  it("idle Your turn sits at the bottom of the transcript, not in the leftover void", () => {
    const m = chrome.match(/\.transcript\s*>\s*\.turn-delimiter\s*\{([^}]+)\}/);
    assert.ok(m?.[1], "missing .transcript > .turn-delimiter");
    assert.match(m[1]!, /margin-top\s*:\s*auto/);
    assert.match(m[1]!, /flex-shrink\s*:\s*0/);
  });

  it("transcript keeps Your turn above the composer fold", () => {
    const m = chrome.match(/\.transcript\s*\{([^}]+)\}/);
    assert.ok(m?.[1], "missing .transcript");
    assert.match(m[1]!, /scroll-padding-bottom:/);
    assert.match(m[1]!, /padding:\s*12px 28px \d+px/);
  });

  it("You prompt is a sticky card under the overview strip, not strip-colored text", () => {
    const m = chrome.match(/\.run-prompt\s*\{([^}]+)\}/);
    assert.ok(m?.[1], "missing .run-prompt");
    assert.match(m[1]!, /position:\s*sticky/);
    assert.match(m[1]!, /z-index:\s*5/);
    assert.match(m[1]!, /background:\s*var\(--bg\)/);
    assert.match(m[1]!, /border:/);
    assert.match(m[1]!, /0 -16px 0 12px var\(--bg\)/);
    assert.match(m[1]!, /display:\s*flex/);
    assert.match(m[1]!, /flex-direction:\s*column/);
    assert.doesNotMatch(m[1]!, /max-height:\s*2\.75rem/);
    const role = chrome.match(/\.run-prompt-role\s*\{([^}]+)\}/);
    assert.ok(role?.[1], "missing .run-prompt-role");
    assert.match(role[1]!, /text-transform:\s*uppercase/);
    const body = chrome.match(/(?:^|\n)\.run-prompt-body\s*\{([^}]+)\}/);
    assert.ok(body?.[1], "missing .run-prompt-body");
    assert.match(body[1]!, /text-overflow:\s*ellipsis/);
    assert.match(body[1]!, /-webkit-line-clamp:\s*2/);
    assert.match(body[1]!, /white-space:\s*pre-wrap/);
    assert.doesNotMatch(body[1]!, /white-space:\s*nowrap/);
    const more = chrome.match(/\.run-prompt-more\s*\{([^}]+)\}/);
    assert.ok(more?.[1], "missing .run-prompt-more");
    assert.match(more[1]!, /font-size:\s*12px/);
    assert.match(more[1]!, /background:\s*none/);
    assert.match(more[1]!, /border:\s*none/);
    assert.doesNotMatch(more[1]!, /background:\s*var\(--plasma\)/);
    assert.doesNotMatch(chrome, /\.run-prompt-chevron\s*\{/);
    const expanded = chrome.match(/\.run-prompt\.is-expanded \.run-prompt-body\s*\{([^}]+)\}/);
    assert.ok(expanded?.[1], "missing expanded You prompt");
    assert.match(expanded[1]!, /-webkit-line-clamp:\s*unset/);
    assert.match(expanded[1]!, /white-space:\s*pre-wrap/);
    assert.match(expanded[1]!, /overflow:\s*auto/);
    assert.match(expanded[1]!, /max-height:\s*min\(28vh,\s*200px\)/);
    const expandedCard = chrome.match(/\.run-prompt\.is-expanded\s*\{([^}]+)\}/);
    assert.ok(expandedCard?.[1], "missing expanded You card cap");
    assert.match(expandedCard[1]!, /max-height:\s*min\(36vh,\s*280px\)/);
    const mention = chrome.match(/\.run-prompt-mention\s*\{([^}]+)\}/);
    assert.ok(mention?.[1], "missing .run-prompt-mention");
    assert.match(mention[1]!, /background:\s*none/);
    assert.match(mention[1]!, /border:\s*none/);
    assert.doesNotMatch(mention[1]!, /rgba\(92,\s*225,\s*255/);
    const main = chrome.match(/\.run-prompt-main\s*\{([^}]+)\}/);
    assert.ok(main?.[1], "missing .run-prompt-main");
    const stack = chrome.match(/(?:^|\n)\.run-stack\s*\{([^}]+)\}/);
    assert.ok(stack?.[1], "missing .run-stack");
    assert.match(stack[1]!, /max-width:\s*min\(820px,\s*100%\)/);
    assert.match(stack[1]!, /align-items:\s*stretch/);
  });

  it("command palette stacks list above the footer", () => {
    const inner = chrome.match(/\.palette \.overlay-dialog\s*\{([^}]+)\}/);
    assert.ok(inner?.[1], "missing .palette .overlay-dialog");
    assert.match(inner[1]!, /display:\s*flex/);
    assert.match(inner[1]!, /flex-direction:\s*column/);
    const list = chrome.match(/\.palette-list\s*\{([^}]+)\}/);
    assert.ok(list?.[1], "missing .palette-list");
    assert.match(list[1]!, /min-height:\s*0/);
    const foot = chrome.match(/\.palette-footer\s*\{([^}]+)\}/);
    assert.ok(foot?.[1], "missing .palette-footer");
    assert.match(foot[1]!, /flex-shrink:\s*0/);
  });

  it("shell command rows wrap two lines instead of ellipsizing the command", () => {
    const body = ruleBody(".tool-row-head.is-command .tool-row-name-plain");
    assert.match(body, /-webkit-line-clamp:\s*2/);
    assert.match(body, /white-space:\s*normal/);
    assert.doesNotMatch(body, /white-space:\s*nowrap/);
  });

  it("slash Skills palette is a compact dropdown, not a full-width slab", () => {
    const m = chrome.match(/\.skills-palette\s*\{([^}]+)\}/);
    assert.ok(m?.[1], "missing .skills-palette");
    assert.match(m[1]!, /max-width:\s*480px/);
    assert.match(m[1]!, /background:\s*var\(--bg\)/);
    assert.doesNotMatch(m[1]!, /right:\s*100px/);
    assert.doesNotMatch(m[1]!, /backdrop-filter/);
    assert.match(m[1]!, /display:\s*flex/);
    assert.match(m[1]!, /overflow:\s*hidden/);
    assert.match(m[1]!, /height:\s*min\(360px/);
    assert.match(m[1]!, /padding:\s*8px 8px 28px/);
    assert.doesNotMatch(m[1]!, /padding:\s*8px 8px 0/);
    assert.doesNotMatch(m[1]!, /padding:\s*8px 8px 16px/);
    const listBody = chrome.match(/\.skills-palette-list\s*\{([^}]+)\}/);
    assert.ok(listBody?.[1], "missing .skills-palette-list");
    assert.match(listBody[1]!, /overflow:\s*auto/);
    assert.match(listBody[1]!, /flex:\s*1 1 auto/);
    assert.match(listBody[1]!, /padding:\s*0/);
    assert.doesNotMatch(listBody[1]!, /padding:\s*0 0 16px/);
    const compact = chrome.match(/\.skills-palette\.is-compact\s*\{([^}]+)\}/);
    assert.ok(compact?.[1], "missing .skills-palette.is-compact");
    assert.match(compact[1]!, /width:\s*max-content/);
  });

  it("sidebar New session is not a full-width outlined well", () => {
    const body = css.match(/\.btn\.ghost\.new-session-btn\s*\{([^}]+)\}/);
    assert.ok(body?.[1], "missing .btn.ghost.new-session-btn");
    assert.match(body[1]!, /border:\s*none/);
    assert.match(body[1]!, /width:\s*max-content/);
    assert.doesNotMatch(body[1]!, /(?<!max-)width:\s*100%/);
    const hover = css.match(
      /\.btn\.ghost\.new-session-btn:hover:not\(:disabled\)\s*\{([^}]+)\}/,
    );
    assert.ok(hover?.[1], "missing .btn.ghost.new-session-btn hover");
    assert.match(hover[1]!, /border:\s*none/);
    assert.match(hover[1]!, /background:\s*none/);
  });

  it("@file menu is a compact dropdown, not a full-width slab", () => {
    const body = ruleBody(".at-menu");
    assert.match(body, /max-width:\s*420px/);
    assert.match(body, /width:\s*min\(420px/);
    assert.doesNotMatch(body, /right:\s*100px/);
    const btn = ruleBody(".at-menu button");
    assert.match(btn, /text-overflow:\s*ellipsis/);
    assert.match(btn, /white-space:\s*nowrap/);
    assert.match(btn, /min-width:\s*0/);
    assert.match(btn, /flex:\s*1 1 auto/);
    const li = chrome.match(/\.at-menu \[role="option"\]\s*\{([^}]+)\}/);
    assert.ok(li?.[1], "missing .at-menu [role=option]");
    assert.match(li[1]!, /min-width:\s*0/);
  });

  it("loaded Project instructions is quiet meta, not a glowing pill", () => {
    const m = settings.match(
      /\.project-instructions-status\.is-loaded \.project-instructions-chip\s*\{([^}]+)\}/,
    );
    assert.ok(m?.[1], "missing loaded project-instructions chip");
    assert.match(m[1]!, /background:\s*transparent/);
    assert.match(m[1]!, /box-shadow:\s*none/);
    assert.match(m[1]!, /border:\s*none/);
    assert.doesNotMatch(m[1]!, /rgba\(92,\s*225,\s*255/);
  });
});
