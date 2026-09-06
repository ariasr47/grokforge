import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { applyPrefsToDom, loadPrefs, savePrefs, themeLabel } from "./prefs";

const PREFS_KEY = "grokforge.prefs.v1";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.colorScheme = "";
});

test("fresh profiles apply the locked Voidglass dark default", () => {
  const prefs = loadPrefs();
  assert.equal(prefs.theme, "voidglass");
  assert.equal(themeLabel(prefs.theme), "Voidglass");
  applyPrefsToDom(prefs);
  assert.equal(document.documentElement.dataset.theme, "voidglass");
  assert.equal(document.documentElement.style.colorScheme, "dark");
});

test("legacy dark migrates to Voidglass while an explicit Aeon preference is preserved", () => {
  localStorage.setItem(PREFS_KEY, JSON.stringify({ theme: "dark" }));
  assert.equal(loadPrefs().theme, "voidglass");

  savePrefs({ ...loadPrefs(), theme: "aeon" });
  assert.equal(loadPrefs().theme, "aeon");
  assert.equal(themeLabel(loadPrefs().theme), "Aeon");
});

test("fresh profiles default the background field to a static aurora", () => {
  assert.equal(loadPrefs().field, "aurora");
});

test("a stored prefs blob without a field value migrates to aurora", () => {
  localStorage.setItem(PREFS_KEY, JSON.stringify({ theme: "voidglass" }));
  assert.equal(loadPrefs().field, "aurora");
});

test("an invalid stored field value migrates to aurora", () => {
  localStorage.setItem(PREFS_KEY, JSON.stringify({ field: "nebula" }));
  assert.equal(loadPrefs().field, "aurora");
});

test("an explicit stars preference is preserved", () => {
  savePrefs({ ...loadPrefs(), field: "stars" });
  assert.equal(loadPrefs().field, "stars");
});
