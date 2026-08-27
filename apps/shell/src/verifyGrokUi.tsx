import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { RunSurface } from "./RunSurface";
import type { RunProjectionRun } from "./runReducer";
import { Button } from "./ui/Button";
import { Icon } from "./ui/Icon";
import { Paperclip, Send, Settings } from "lucide-react";
import "./fonts";
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
  message: {},
  activities: {},
  decisions: {},
  seenEventSeq: new Set([1]),
  terminalEventSeq: 2,
} as RunProjectionRun;

const streamingRun = {
  ...run,
  runId: "verify-stream",
  state: "running",
  terminalKind: null,
  finalAnswer: null,
  answerVouched: false,
  answer: {
    seg: "Intro while the fence is still open.\n\n```grok-ui\n{ \"version\": 1, \"blocks\": [{ \"type\": \"callout\", \"title\": \"Not yet\"",
  },
  terminalEventSeq: null,
} as RunProjectionRun;

createRoot(document.getElementById("root")!).render(
  createElement(
    "div",
    { style: { padding: 24, display: "grid", gap: 16 } },
    createElement(
      "div",
      { className: "row", style: { display: "flex", gap: 8, flexWrap: "wrap" } },
      createElement(Button, { variant: "primary", id: "verify-primary" }, "Allow once"),
      createElement(Button, { id: "verify-secondary" }, "Always this session"),
      createElement(Button, { variant: "ghost", id: "verify-ghost" }, "Deny"),
      createElement(Button, { variant: "primary", id: "verify-send" },
        createElement(Icon, { icon: Send, size: 15 }),
        " Send",
      ),
      createElement(Button, { variant: "ghost", id: "verify-attach" },
        createElement(Icon, { icon: Paperclip, size: 15 }),
        " Attach",
      ),
      createElement(Button, { variant: "ghost", id: "verify-settings" },
        createElement(Icon, { icon: Settings, size: 15 }),
        " Settings",
      ),
    ),
    createElement(RunSurface, { run, productMode: "chat" }),
    createElement(RunSurface, { run: streamingRun, productMode: "chat" }),
  ),
);
