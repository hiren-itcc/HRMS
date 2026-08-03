'use client';

import type { LoginInput, Permission } from '@hrms/shared';
import type { SessionUser } from '@hrms/types';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authApi } from '@/features/auth/api';
import { setAccessToken } from '@/lib/api-client';
import { clearSessionMarker, setSessionMarker } from '@/lib/session-cookie';

type SessionStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface SessionContextValue {
  user: SessionUser | null;
  status: SessionStatus;
  login: (input: LoginInput) => Promise<void>;
  logout: () => Promise<void>;
  /** Re-fetch /auth/me (e.g. after profile edits). */
  reload: () => Promise<void>;
  can: (permission: Permission) => boolean;
  /** Adopt a session the API already minted — used by the invite flow. */
  adoptSession: (accessToken: string, user: SessionUser) => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

// Module-level single flight: React StrictMode mounts effects twice and the
// refresh endpoint rotates the cookie, so the bootstrap call must run once
// per page load no matter how many times the provider mounts.
let bootstrapPromise: ReturnType<typeof authApi.refresh> | null = null;
function bootstrapRefresh() {
  bootstrapPromise ??= authApi.refresh();
  return bootstrapPromise;
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [status, setStatus] = useState<SessionStatus>('loading');

  // Bootstrap: the httpOnly refresh cookie (if present) is the only way
  // back into a session — the access token never survives a reload.
  useEffect(() => {
    let cancelled = false;
    bootstrapRefresh()
      .then(({ accessToken, user }) => {
        if (cancelled) return;
        setAccessToken(accessToken);
        setUser(user);
        setSessionMarker();
        setStatus('authenticated');
      })
      .catch(() => {
        if (cancelled) return;
        clearSessionMarker();
        setStatus('unauthenticated');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (input: LoginInput) => {
    const { accessToken, user } = await authApi.login(input);
    setAccessToken(accessToken);
    setUser(user);
    setSessionMarker();
    setStatus('authenticated');
  }, []);

  /**
   * Adopts the session the API returns after an invitation is redeemed. The
   * hire is signed in by the act of setting their password — asking them to
   * type it again immediately would be theatre.
   */
  const adoptSession = useCallback((accessToken: string, sessionUser: SessionUser) => {
    setAccessToken(accessToken);
    setUser(sessionUser);
    setSessionMarker();
    setStatus('authenticated');
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout().catch(() => undefined);
    setAccessToken(null);
    setUser(null);
    clearSessionMarker();
    setStatus('unauthenticated');
  }, []);

  const reload = useCallback(async () => {
    setUser(await authApi.me());
  }, []);

  const can = useCallback(
    (permission: Permission) => user?.permissions.includes(permission) ?? false,
    [user],
  );

  const value = useMemo(
    () => ({ user, status, login, logout, reload, can, adoptSession }),
    [user, status, login, logout, reload, can, adoptSession],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within <SessionProvider>');
  return ctx;
}
