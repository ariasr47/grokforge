import { create } from "zustand";

interface SessionFlagsState {
  sessionWrite: boolean;
  sessionShell: boolean;
  setSessionWrite: (sessionWrite: boolean) => void;
  setSessionShell: (sessionShell: boolean) => void;
  resetSessionFlags: () => void;
}

export const useSessionFlagsStore = create<SessionFlagsState>((set) => ({
  sessionWrite: false,
  sessionShell: false,
  setSessionWrite: (sessionWrite) => set({ sessionWrite }),
  setSessionShell: (sessionShell) => set({ sessionShell }),
  resetSessionFlags: () => set({ sessionWrite: false, sessionShell: false }),
}));
