import { create } from "zustand";

export type PeekState = { path: string; content: string } | null;

/** Ctrl+K opens "commands" (the app's own actions); Ctrl+P and Home's field /
 *  All-sessions link open "sessions" (search across every workspace). */
export type PaletteMode = "commands" | "sessions";

interface ChromeState {
  paletteOpen: boolean;
  /** Which list the palette shows. Only meaningful while paletteOpen. */
  paletteMode: PaletteMode;
  /** Pre-filled into the palette's input on open — Task 13's Home field
   *  types straight into the palette rather than a separate, silent field. */
  paletteQuery: string;
  peek: PeekState;
  dragOver: boolean;
  /** Changes dock toggle (Task 9's ThreadHeader "Changes N" chip). Defaults to
   *  true so a run's first changes open the dock automatically. */
  changesOpen: boolean;
  setPaletteOpen: (next: boolean | ((prev: boolean) => boolean)) => void;
  /** Opens the palette in a specific mode with an optional starting query —
   *  the one entry point Ctrl+K, Ctrl+P, and Home's field/All-sessions all
   *  funnel through, so mode and query always land together. */
  openPalette: (mode: PaletteMode, query?: string) => void;
  setPeek: (peek: PeekState) => void;
  setDragOver: (dragOver: boolean) => void;
  setChangesOpen: (next: boolean | ((prev: boolean) => boolean)) => void;
}

export const useChromeStore = create<ChromeState>((set) => ({
  paletteOpen: false,
  paletteMode: "commands",
  paletteQuery: "",
  peek: null,
  dragOver: false,
  changesOpen: true,
  setPaletteOpen: (next) =>
    set((s) => ({
      paletteOpen: typeof next === "function" ? next(s.paletteOpen) : next,
    })),
  openPalette: (mode, query = "") =>
    set({ paletteOpen: true, paletteMode: mode, paletteQuery: query }),
  setPeek: (peek) => set({ peek }),
  setDragOver: (dragOver) => set({ dragOver }),
  setChangesOpen: (next) =>
    set((s) => ({
      changesOpen: typeof next === "function" ? next(s.changesOpen) : next,
    })),
}));
