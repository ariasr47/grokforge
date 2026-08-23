import { create } from "zustand";

export type PeekState = { path: string; content: string } | null;

interface ChromeState {
  paletteOpen: boolean;
  peek: PeekState;
  dragOver: boolean;
  setPaletteOpen: (next: boolean | ((prev: boolean) => boolean)) => void;
  setPeek: (peek: PeekState) => void;
  setDragOver: (dragOver: boolean) => void;
}

export const useChromeStore = create<ChromeState>((set) => ({
  paletteOpen: false,
  peek: null,
  dragOver: false,
  setPaletteOpen: (next) =>
    set((s) => ({
      paletteOpen: typeof next === "function" ? next(s.paletteOpen) : next,
    })),
  setPeek: (peek) => set({ peek }),
  setDragOver: (dragOver) => set({ dragOver }),
}));
