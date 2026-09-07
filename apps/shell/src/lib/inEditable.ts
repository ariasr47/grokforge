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

/** True when the event target sits inside the action dock (the "Pending
 *  agent actions" region ActionDock.tsx renders). Required, in addition to
 *  `inEditable` being false, before a bare unmodified key (S/Y/N, Digit1-3)
 *  may settle a gate.
 *
 *  `inEditable` alone is not enough: it only rules out text fields, but a
 *  stray keystroke can land on focus that is neither a text field nor the
 *  gate itself — e.g. focus sitting on `document.body`, or on some other
 *  control entirely. Without this second check, that keystroke would still
 *  read as a decision on a permission the operator was never looking at. */
export function dockOwnsFocus(t: EventTarget | null): boolean {
  return Boolean(t instanceof Element && t.closest(".action-dock"));
}
