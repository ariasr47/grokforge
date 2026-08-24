/** Dock / permission chrome copy. Host grants last until the folder changes. */
export const ALWAYS_SESSION_LABEL = "Always this session";
export const ALWAYS_SESSION_HINT =
  "Skips more write and shell cards until you change folder.";
export const SETTLE_CARD_BELOW = "Settle the card below";
export const SETTLE_IN_DOCK = "Settle this in the card below.";

export type LiveRevealPlan = "keep-end" | "show-header" | "skip";

/** At the live end, keep following the bottom. Do not jump to the first tool header. */
export function planLiveActivityReveal(
  atLiveEnd: boolean,
  hasHeader: boolean,
): LiveRevealPlan {
  if (atLiveEnd) return "keep-end";
  if (hasHeader) return "show-header";
  return "skip";
}
