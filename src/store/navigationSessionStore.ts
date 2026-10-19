import { create } from 'zustand';

/** Whether turn-by-turn navigation is running, so app chrome (the tab bar) can step aside. */
export const useNavigationSessionStore = create<{ active: boolean; setActive: (active: boolean) => void }>((set) => ({
  active: false,
  setActive: (active) => set({ active }),
}));
