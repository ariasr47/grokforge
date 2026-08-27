import type { SkillHandoffProvenance } from "./api";
import { SKILLS_SENT } from "./skillsCatalogComposer";

export function SkillHandoffProvenanceChip(props: {
  provenance?: SkillHandoffProvenance | null;
}) {
  const { provenance } = props;
  if (!provenance || provenance.kind !== "consumed" || !provenance.name) return null;
  return (
    <span
      className="skill-handoff-provenance"
      role="status"
      data-skill-handoff="consumed"
    >
      {SKILLS_SENT(provenance.name)}
    </span>
  );
}
