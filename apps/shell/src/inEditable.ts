/** True when the event target is a text-entry element (input/textarea/contentEditable) —
 *  global and Review-surface keyboard shortcuts must not fire while the user is typing
 *  into one. Shared between App.tsx's global tinykeys block and ReviewSurface's own
 *  local keydown handling so both apply the exact same rule. */
export function inEditable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return Boolean(
    el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable),
  );
}
