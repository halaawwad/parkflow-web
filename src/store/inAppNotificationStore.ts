import { create } from 'zustand';
import type { AppNotification } from '@/types';
import { normalizeNotification } from '@/utils/notifications';

interface InAppNotificationState {
  /** The notification currently shown as an on-screen banner. */
  current?: AppNotification;
  /** Ids already shown, so the API response and the socket echo pop it only once. */
  shown: Set<string>;
  show: (notification?: AppNotification | null) => void;
  dismiss: () => void;
}

/** Holds the latest live notification so the banner can pop over any screen. */
export const useInAppNotificationStore = create<InAppNotificationState>((set, get) => ({
  current: undefined,
  shown: new Set(),
  show: (notification) => {
    const safeNotification = normalizeNotification(notification);
    if (!safeNotification || get().shown.has(safeNotification.id)) return;
    get().shown.add(safeNotification.id);
    set({ current: safeNotification });
  },
  dismiss: () => set({ current: undefined }),
}));
