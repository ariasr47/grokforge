export type Effort = "auto" | "fast" | "expert" | "heavy";

export type EffortBinding = {
  selected: Effort;
  model: string;
  reasoning_effort?: "low" | "medium" | "high";
};

const FAST_MODELS = [
  process.env.GROK_FAST_MODEL?.trim(),
  "grok-4-fast-non-reasoning",
  "grok-4-fast",
].filter(Boolean) as string[];

const HEAVY_MODELS = [
  process.env.GROK_HEAVY_MODEL?.trim(),
  "grok-4",
].filter(Boolean) as string[];

export function resolveEffort(
  effort: Effort,
  defaultModel: string,
): EffortBinding {
  const base = defaultModel.trim() || "grok-4";
  switch (effort) {
    case "fast":
      return {
        selected: effort,
        model: FAST_MODELS[0] || base,
        reasoning_effort: "low",
      };
    case "expert":
      return {
        selected: effort,
        model: base,
        reasoning_effort: "high",
      };
    case "heavy":
      return {
        selected: effort,
        model: HEAVY_MODELS[0] || base,
        reasoning_effort: "high",
      };
    case "auto":
    default:
      return { selected: "auto", model: base };
  }
}

export function isEffort(v: unknown): v is Effort {
  return v === "auto" || v === "fast" || v === "expert" || v === "heavy";
}

/**
 * Ordered model-id fallback chain for a resolved effort binding (AC8 / SPEC §5 "Effort/model
 * fallback"). `binding.model` leads (the resolved choice for the selected effort); the rest are
 * the other known-good host constants, so a rejected model id (e.g. a bad `config.model` reached
 * through `auto`/`expert`) still has somewhere real to fall through to. De-duplicated, order
 * preserved, empty/undefined entries dropped.
 */
export function modelFallbackChain(binding: EffortBinding): string[] {
  const candidates = [binding.model, FAST_MODELS[0], HEAVY_MODELS[0]]
    .map((m) => (typeof m === "string" ? m.trim() : ""))
    .filter(Boolean);
  return [...new Set(candidates)];
}
