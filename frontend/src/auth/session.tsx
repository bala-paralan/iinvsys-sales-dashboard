/**
 * Session state. The token itself lives in api/client.ts; this layer owns the
 * user identity, the login/logout flows, and the 401 redirect — a mid-session
 * expiry routes to the login screen instead of surfacing as a toast on
 * whatever page happened to make the next request (the legacy behaviour).
 */
import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
} from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, hasToken, setToken, setUnauthorizedHandler } from '../api/client';

export interface SessionUser {
  _id: string;
  name: string;
  email: string;
  role: string;
}

interface SessionState {
  user: SessionUser | null;
  /** true while a stored token is being validated on first mount */
  restoring: boolean;
  login: (email: string, password: string) => Promise<void>;
  /** Adopt a session established outside the login form — invite redemption. */
  adopt: (user: { id: string; name: string; email: string; role: string }) => void;
  logout: () => void;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [restoring, setRestoring] = useState<boolean>(hasToken());
  const queryClient = useQueryClient();

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    /* A different account must never see the previous account's cached data —
       the pipeline payload embeds `me.permissions`. */
    queryClient.clear();
  }, [queryClient]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      queryClient.clear();
    });
    return () => setUnauthorizedHandler(null);
  }, [queryClient]);

  /* Restore a stored token by asking the server who it belongs to. */
  useEffect(() => {
    if (!hasToken()) return;
    api<{ user: SessionUser }>('GET', '/auth/me')
      .then((res) => setUser(res.data.user))
      .catch(() => setToken(null))
      .finally(() => setRestoring(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api<{ token: string; user: SessionUser }>('POST', '/auth/login', {
      email, password,
    });
    setToken(res.data.token);
    setUser(res.data.user);
    queryClient.clear();
  }, [queryClient]);

  /* Invite redemption signs the user in without touching /auth/login. The
     token is already set by the caller; this adopts the identity and clears
     any cache belonging to a previous account. */
  const adopt = useCallback((u: { id: string; name: string; email: string; role: string }) => {
    setUser({ _id: u.id, name: u.name, email: u.email, role: u.role });
    setRestoring(false);
    queryClient.clear();
  }, [queryClient]);

  const value = useMemo(
    () => ({ user, restoring, login, adopt, logout }),
    [user, restoring, login, adopt, logout],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}
