import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseMarkdownBlocks } from "./markdownParse.js";
import { liftUnfencedRichUi } from "./richUi.js";

/** Exact Chat dump the operator pasted (same-line grok-ui fences mid-prose). */
const DUMP =
  "Same question as before — here’s a tighter version you can actually cook from. A tabletop grill (shichirin/konro) is the star. Sides should be **make-ahead**, **cold or room-temp**, and good at cutting through fatty grilled meat. ```grok-ui { \"version\": 1, \"blocks\": [ { \"type\": \"callout\", \"tone\": \"info\", \"title\": \"Keep it to 5–6 sides\", \"body\": \"Rice + kimchi + lettuce wraps + one creamy salad + one vinegar salad + grill veggies. That already feels like a restaurant spread.\" }, { \"type\": \"carousel\", \"title\": \"Best sides\", \"items\": [ { \"title\": \"Steamed rice\", \"badge\": \"Essential\", \"body\": \"Short-grain Japanese rice in small bowls. This is the real side dish. Optional nori or furikake.\", \"footer\": \"Cook extra\" }, { \"title\": \"Kimchi\", \"badge\": \"Must-have\", \"body\": \"Napa cabbage kimchi cuts the fat. Jarred is fine. Serve cold in a small dish.\", \"footer\": \"Buy good quality\" }, { \"title\": \"Lettuce wraps\", \"badge\": \"Restaurant-style\", \"body\": \"Butter or green-leaf lettuce, plus shiso if you find it. Wrap meat with sauce, garlic, or kimchi.\", \"footer\": \"Wash and dry leaves ahead\" }, { \"title\": \"Namul (3 bowls)\", \"badge\": \"Make-ahead\", \"body\": \"Spinach sesame, garlic bean sprouts, and salted cucumber. All can be done the day before.\", \"footer\": \"Tastes better cold\" }, { \"title\": \"Japanese potato salad\", \"badge\": \"Crowd-pleaser\", \"body\": \"Mashed potato, Kewpie mayo, cucumber, carrot, a little onion. Creamy against smoky meat.\", \"footer\": \"Chill 1 hour\" }, { \"title\": \"Cucumber sunomono\", \"badge\": \"5 minutes\", \"body\": \"Thin cucumber, rice vinegar, pinch of sugar and salt, optional wakame. Resets the palate.\", \"footer\": \"Salt cukes first\" }, { \"title\": \"Negi salad\", \"badge\": \"Pile on meat\", \"body\": \"Lots of sliced green onion with sesame oil, soy, vinegar, chili. Soak in ice water so it stays crisp.\", \"footer\": \"Yakiniku-shop classic\" }, { \"title\": \"Same-grill veggies\", \"badge\": \"No extra work\", \"body\": \"Shiitake, shishito, thick onion, corn, garlic cloves, enoki, asparagus. Oil lightly; salt at the table.\", \"footer\": \"Cook with the meat\" } ] } ] } ``` ### Put 2–3 sauces on the table - **Tare** (sweet soy yakiniku sauce) - **Goma dare** (creamy sesame) - **Salt + lemon** (best for good beef) - Optional: ponzu, chili oil, yuzu kosho, raw garlic slices ```grok-ui { \"version\": 1, \"blocks\": [ { \"type\": \"tabs\", \"tabs\": [ { \"label\": \"Easy night\", \"body\": \"Rice, kimchi, lettuce wraps, cucumber sunomono, plus onion/shiitake on the grill.\" }, { \"label\": \"Classic spread\", \"body\": \"Rice, kimchi, lettuce/shiso, namul, potato salad, sunomono or negi salad, grill veggies.\" }, { \"label\": \"Feast\", \"body\": \"Classic plus edamame, pickled daikon, a simple miso soup, and fruit (orange or melon) at the end.\" } ] }, { \"type\": \"checklist\", \"title\": \"Shop this\", \"items\": [ { \"text\": \"Short-grain rice (~1 cup uncooked per 2 people)\", \"done\": false }, { \"text\": \"Kimchi\", \"done\": false }, { \"text\": \"Lettuce + optional shiso\", \"done\": false }, { \"text\": \"Cucumbers, spinach, bean sprouts, green onions\", \"done\": false }, { \"text\": \"Potatoes, Kewpie mayo, carrot\", \"done\": false }, { \"text\": \"Shiitake, shishito, onion, corn, garlic\", \"done\": false }, { \"text\": \"Frozen edamame\", \"done\": false }, { \"text\": \"Rice vinegar, soy, sesame oil, sesame seeds\", \"done\": false }, { \"text\": \"Yakiniku sauce + sesame sauce\", \"done\": false }, { \"text\": \"Lemon; optional nori\", \"done\": false } ] } ] } ``` **Drinks:** beer, highball, lemon sour, or unsweetened oolong/mugicha.";

describe("yakiniku Chat dump", () => {
  it("lifts both same-line grok-ui fences out of the prose", () => {
    const lifted = liftUnfencedRichUi(DUMP);
    assert.equal((lifted.match(/```grok-ui\n/g) || []).length, 2);
    assert.ok(!lifted.includes("```grok-ui {"));
  });

  it("parses callout, carousel, tabs, and checklist as rich blocks", () => {
    const blocks = parseMarkdownBlocks(DUMP);
    const rich = blocks.filter((b) => b.type === "rich");
    assert.equal(rich.length, 2);
    assert.ok(!blocks.some((b) => b.type === "p" && b.text.includes('"version"')));
    assert.ok(!blocks.some((b) => b.type === "code" && b.lang.startsWith("grok-ui")));
  });
});
