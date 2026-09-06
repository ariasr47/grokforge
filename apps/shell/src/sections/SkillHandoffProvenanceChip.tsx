import type { SkillHandoffProvenance } from "../lib/api";
import { SKILLS_SENT } from "../projections/skillsCatalogComposer";

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
