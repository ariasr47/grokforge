import { firstToken, type SkillsCatalogFact } from "./skillsCatalog.js";

export type PromptSkillHandoff = { name: string } | null | undefined;

export type SkillHandoffDecision =
  | { action: "unarmed" }
  | { action: "accept"; name: string }
  | {
      action: "refuse";
      code: "skill_handoff_unavailable";
      error: "Skill no longer available.";
      status: 409;
    };

const REFUSE: Extract<SkillHandoffDecision, { action: "refuse" }> = {
  action: "refuse",
  code: "skill_handoff_unavailable",
  error: "Skill no longer available.",
  status: 409,
};

export function decideSkillHandoff(
  handoff: PromptSkillHandoff,
  catalog: SkillsCatalogFact,
  text: string,
): SkillHandoffDecision {
  if (handoff == null) return { action: "unarmed" };
  if (typeof handoff !== "object" || typeof handoff.name !== "string") {
    return REFUSE;
  }
  if (catalog.disposition !== "ready" || !catalog.commands) {
    return REFUSE;
  }
  const member = catalog.commands.some((c) => c.name === handoff.name);
  if (!member || firstToken(text) !== handoff.name) {
    return REFUSE;
  }
  return { action: "accept", name: handoff.name };
}
