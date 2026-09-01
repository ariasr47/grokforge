import { filterSkillCommands, SKILLS_CHECKING, SKILLS_EMPTY, SKILLS_FAILED, SKILLS_NO_MATCHES, SKILLS_RECONNECT, SKILLS_TITLE, type SkillsPaletteProjection } from "./skillsCatalogComposer";

export function SkillsPalette(props: {
  open: boolean;
  projection: SkillsPaletteProjection;
  filter: string;
  activeIndex: number;
  onSelect: (name: string) => void;
  onDismiss: () => void;
}) {
  const { open, projection, filter, activeIndex, onSelect, onDismiss } = props;
  if (!open || projection.state === "absent") return null;

  const rows =
    projection.state === "ready"
      ? filterSkillCommands(projection.commands, filter)
      : [];

  return (
    <div
      className={`skills-palette${projection.state === "ready" ? "" : " is-compact"}`}
      data-skills-palette={projection.state}
      role={projection.state === "ready" ? "listbox" : "status"}
      aria-label={SKILLS_TITLE}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onDismiss();
        }
      }}
    >
      <div className="skills-palette-title">{SKILLS_TITLE}</div>
      {projection.state === "checking" ? (
        <>
          <div className="skills-palette-status">{SKILLS_CHECKING}</div>
          {projection.reconnectHint ? (
            <div className="skills-palette-status">{SKILLS_RECONNECT}</div>
          ) : null}
        </>
      ) : null}
      {projection.state === "empty" ? (
        <div className="skills-palette-status">{SKILLS_EMPTY}</div>
      ) : null}
      {projection.state === "failed" ? (
        <div className="skills-palette-status">{SKILLS_FAILED}</div>
      ) : null}
      {projection.state === "ready" && rows.length === 0 ? (
        <div className="skills-palette-status">{SKILLS_NO_MATCHES}</div>
      ) : null}
      {rows.length > 0 ? (
        <div className="skills-palette-list">
          {rows.map((cmd, i) => (
            <button
              key={cmd.name}
              type="button"
              role="option"
              id={`skills-option-${i}`}
              className="skills-palette-option"
              aria-label={cmd.name}
              aria-selected={i === activeIndex}
              data-active={i === activeIndex ? "true" : undefined}
              onClick={() => onSelect(cmd.name)}
            >
              <span className="skills-palette-name">{cmd.name}</span>
              {cmd.description ? (
                <span className="skills-palette-desc">{cmd.description}</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
