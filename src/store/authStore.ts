import { create } from 'zustand';
import type { AuthSession, User } from '@/types';
import { secureStorage, STORAGE_KEYS } from '@/services/storage';

/**
 * Auth is deliberately NOT using zustand/persist: the token lives in SecureStore
 * and is written explicitly, so we never risk it leaking into a generic
 * AsyncStorage blob alongside preferences.
 */
interface AuthState {
  session?: AuthSession;
  user?: User;
  /** False until SecureStore has been read on boot — gates the router. */
  hydrated: boolean;

  hydrate: () => Promise<void>;
  signIn: (session: AuthSession, user: User) => Promise<void>;
  setUser: (user: User) => void;
  signOut: () => Promise<void>;
}

interface PersistedAuth {
  session: AuthSession;
  user: User;
}

export const useAuthStore = create<AuthState>()((set) => ({
  session: undefined,
  user: undefined,
  hydrated: false,

  hydrate: async () => {
    try {
      if (__DEV__ && process.env.EXPO_PUBLIC_START_FROM_BEGINNING === 'true') {
        await secureStorage.removeItem(STORAGE_KEYS.authSession).catch(() => undefined);
        set({ session: undefined, user: undefined, hydrated: true });
        return;
      }

      const raw = await secureStorage.getItem(STORAGE_KEYS.authSession);
      if (!raw) {
        set({ hydrated: true });
        return;
      }
      const parsed = JSON.parse(raw) as PersistedAuth;
      // A stored user is a rendering cache; the backend refreshes identity and authorizes every request.
      set({ session: parsed.session, user: parsed.user, hydrated: true });
      const { api } = await import('@/services/http/apiClient');
      try {
        const user = await api<User>('/auth/me');
        // A proxy/invalid response must never erase the cached identity and trigger onboarding.
        if (user && user.id === parsed.session.userId && typeof user.fullName === 'string'
            && useAuthStore.getState().session?.userId === parsed.session.userId) {
          useAuthStore.getState().setUser(user);
        }
      } catch {
        // apiClient clears only the matching session on a confirmed authentication rejection.
        // A timeout, invalid response, or stale request must preserve the cached identity.
      }
      set({ hydrated: true });
    } catch {
      // A corrupt blob must never brick the app — drop it and start signed out.
      await secureStorage.removeItem(STORAGE_KEYS.authSession).catch(() => undefined);
      set({ hydrated: true });
    }
  },

  signIn: async (session, user) => {
    await secureStorage.setItem(STORAGE_KEYS.authSession, JSON.stringify({ session, user }));
    set({ session, user });
  },

  setUser: (user) => {
    set({ user });
    const { session } = useAuthStore.getState();
    if (session) {
      void secureStorage.setItem(STORAGE_KEYS.authSession, JSON.stringify({ session, user }));
    }
  },

  signOut: async () => {
    set({ session: undefined, user: undefined });
    await secureStorage.removeItem(STORAGE_KEYS.authSession);
  },
}));

export const currentUserId = (): string | undefined => useAuthStore.getState().user?.id;
