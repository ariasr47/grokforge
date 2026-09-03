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

  const total = projection.state === "ready" ? projection.commands.length : 0;
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
      <div className="mh">
        <span>{SKILLS_TITLE}</span>
        {/* Task 14: the `.menu` header's "N of M match" — only meaningful
         *  once there is a real total to narrow from. */}
        {projection.state === "ready" ? (
          <span className="count">
            {rows.length} of {total} match
          </span>
        ) : null}
      </div>
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
              className={`mi${i === activeIndex ? " on" : ""}`}
              aria-label={cmd.name}
              aria-selected={i === activeIndex}
              onClick={() => onSelect(cmd.name)}
            >
              <span className="k">{cmd.name}</span>
              {cmd.description ? <span className="d">{cmd.description}</span> : null}
              {/* Every row here is sourced from the vendor engine's own
               *  skills catalog (SkillsCatalogFact) — never Forge's own
               *  palette actions — so "vendor" is always determinable. */}
              <span className="src">vendor</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
