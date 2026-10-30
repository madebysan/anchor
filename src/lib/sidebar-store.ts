import { create } from "zustand";

interface SidebarStore {
  /** Bumped to move keyboard focus to the chat input. */
  chatFocusRequest: number;
  /** Put the cursor in the chat input (Ask AI on a selection). */
  focusChat: () => void;
}

export const useSidebarStore = create<SidebarStore>((set) => ({
  chatFocusRequest: 0,
  focusChat: () => set((state) => ({ chatFocusRequest: state.chatFocusRequest + 1 })),
}));
