import { create } from "zustand";

export type PeekState = { path: string; content: string } | null;

interface ChromeState {
  paletteOpen: boolean;
  peek: PeekState;
  dragOver: boolean;
  /** Changes dock toggle (Task 9's ThreadHeader "Changes N" chip). Defaults to
   *  true so a run's first changes open the dock automatically. */
  changesOpen: boolean;
  setPaletteOpen: (next: boolean | ((prev: boolean) => boolean)) => void;
  setPeek: (peek: PeekState) => void;
  setDragOver: (dragOver: boolean) => void;
  setChangesOpen: (next: boolean | ((prev: boolean) => boolean)) => void;
}

export const useChromeStore = create<ChromeState>((set) => ({
  paletteOpen: false,
  peek: null,
  dragOver: false,
  changesOpen: true,
  setPaletteOpen: (next) =>
    set((s) => ({
      paletteOpen: typeof next === "function" ? next(s.paletteOpen) : next,
    })),
  setPeek: (peek) => set({ peek }),
  setDragOver: (dragOver) => set({ dragOver }),
  setChangesOpen: (next) =>
    set((s) => ({
      changesOpen: typeof next === "function" ? next(s.changesOpen) : next,
    })),
}));
