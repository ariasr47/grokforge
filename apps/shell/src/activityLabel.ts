export type ActivityLabelFields = {
  title?: string | null;
  summary?: string | null;
  name?: string | null;
};

function present(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Human-readable tool row label. Never invents a prose headline. */
export function activityHumanLabel(fields: ActivityLabelFields): string | null {
  return present(fields.title) ?? present(fields.summary) ?? present(fields.name);
}
