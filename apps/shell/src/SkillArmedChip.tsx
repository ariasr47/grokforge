import { SKILLS_ARMED, SKILLS_ARMED_TITLE } from "./skillsCatalogComposer";

export function SkillArmedChip(props: {
  name: string;
  onClear: () => void;
}) {
  const { name, onClear } = props;
  return (
    <span
      className="skill-armed-chip"
      role="status"
      title={SKILLS_ARMED_TITLE(name)}
      data-skill-armed={name}
    >
      <span>{SKILLS_ARMED(name)}</span>
      <button
        type="button"
        className="skill-armed-clear"
        aria-label={`Clear ${name}`}
        onClick={onClear}
      >
        ×
      </button>
    </span>
  );
}
