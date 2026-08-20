import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AuthUser, Permission } from '@probild/shared';
import { apiGet, setSessionLostHandler } from '@/lib/api';
import { supabase } from '@/lib/supabase';

interface AuthContextValue {
  user: AuthUser | null;
  permissions: Permission[];
  /** False only while the initial session restore is in flight. */
  ready: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
  can: (permission: Permission) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [ready, setReady] = useState(false);
  const queryClient = useQueryClient();

  const loadUser = useCallback(async () => {
    const data = await apiGet<{ user: AuthUser; permissions: Permission[] }>('/auth/me');
    setUser(data.user);
    setPermissions(data.permissions);
  }, []);

  const clearSession = useCallback(() => {
    setUser(null);
    setPermissions([]);
    queryClient.clear();
  }, [queryClient]);

  /*
   * supabase-js restores the session from storage and refreshes it on its own,
   * so the profile is loaded whenever a session appears and dropped when one
   * goes. `onAuthStateChange` fires immediately with the restored session,
   * which is what ends the initial `ready: false`.
   */
  useEffect(() => {
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        loadUser()
          .catch(clearSession)
          .finally(() => setReady(true));
      } else {
        clearSession();
        setReady(true);
      }
    });

    return () => subscription.subscription.unsubscribe();
  }, [loadUser, clearSession]);

  // When the API rejects a token the session is over, whatever Supabase thinks.
  useEffect(() => {
    setSessionLostHandler(() => {
      void supabase.auth.signOut();
      clearSession();
    });
    return () => setSessionLostHandler(null);
  }, [clearSession]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        // Never reveal whether the address exists.
        throw new Error('Incorrect email or password.');
      }
      await loadUser();
    },
    [loadUser],
  );

  const signOut = useCallback(async () => {
    try {
      await supabase.auth.signOut();
    } finally {
      clearSession();
    }
  }, [clearSession]);

  const refreshUser = loadUser;

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      permissions,
      ready,
      signIn,
      signOut,
      refreshUser,
      can: (permission) => permissions.includes(permission),
    }),
    [user, permissions, ready, signIn, signOut, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside <AuthProvider>.');
  }
  return context;
}
