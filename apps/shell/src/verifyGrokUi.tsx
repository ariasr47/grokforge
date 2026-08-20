import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { RunSurface } from "./RunSurface";
import type { RunProjectionRun } from "./runReducer";
import "./styles.css";

const dump =
  "Same question as before — here’s a tighter version you can actually cook from. A tabletop grill (shichirin/konro) is the star. Sides should be **make-ahead**, **cold or room-temp**, and good at cutting through fatty grilled meat. ```grok-ui { \"version\": 1, \"blocks\": [ { \"type\": \"callout\", \"tone\": \"info\", \"title\": \"Keep it to 5–6 sides\", \"body\": \"Rice + kimchi + lettuce wraps + one creamy salad + one vinegar salad + grill veggies. That already feels like a restaurant spread.\" }, { \"type\": \"carousel\", \"title\": \"Best sides\", \"items\": [ { \"title\": \"Steamed rice\", \"badge\": \"Essential\", \"body\": \"Short-grain Japanese rice in small bowls.\", \"footer\": \"Cook extra\" }, { \"title\": \"Kimchi\", \"badge\": \"Must-have\", \"body\": \"Napa cabbage kimchi cuts the fat.\", \"footer\": \"Buy good quality\" } ] } ] } ``` ### Put 2–3 sauces on the table\n- **Tare** (sweet soy yakiniku sauce)\n```grok-ui { \"version\": 1, \"blocks\": [ { \"type\": \"tabs\", \"tabs\": [ { \"label\": \"Easy night\", \"body\": \"Rice, kimchi, lettuce wraps.\" }, { \"label\": \"Classic spread\", \"body\": \"Rice, kimchi, namul, potato salad.\" } ] }, { \"type\": \"checklist\", \"title\": \"Shop this\", \"items\": [ { \"text\": \"Short-grain rice\", \"done\": false }, { \"text\": \"Kimchi\", \"done\": false } ] } ] } ``` **Drinks:** beer or unsweetened oolong.";

const run = {
  sessionId: "verify",
  runId: "verify-run",
  connectionGeneration: 1,
  state: "terminal",
  acceptedPrompt: "What are the best sides for yakiniku?",
  admittedAt: "",
  updatedAt: "",
  lastEventSeq: 2,
  policy: { effectiveMode: "review" },
  model: { appliedModel: "grok-4.6" },
  terminalKind: "answered",
  finalAnswer: dump,
  answerVouched: true,
  failure: null,
  reasoning: {},
  answer: {},
  activities: {},
  decisions: {},
  seenEventSeq: new Set([1]),
  terminalEventSeq: 2,
} as RunProjectionRun;

createRoot(document.getElementById("root")!).render(
  createElement(
    "div",
    { style: { padding: 24, display: "grid", gap: 16 } },
    createElement(
      "div",
      { className: "row", style: { display: "flex", gap: 8, flexWrap: "wrap" } },
      createElement("button", { type: "button", className: "btn primary", id: "verify-primary" }, "Allow once"),
      createElement("button", { type: "button", className: "btn", id: "verify-secondary" }, "Always this chat"),
      createElement("button", { type: "button", className: "btn ghost", id: "verify-ghost" }, "Deny"),
    ),
    createElement(RunSurface, { run, productMode: "chat" }),
  ),
);
