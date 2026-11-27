import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import {
  getStoredToken, getStoredUser, storeAuth, clearAuth, initAuthTokenGetter,
  apiLogin, apiGoogleLogin, apiGetMe, type AuthUser,
} from "@/lib/auth-api";
import { readDevGoogleCallback, isDevGoogleHandoff, devGoogleFailureMessage, devGoogleCallbackErrorMessage, type DevGoogleCallback } from "@/lib/dev-google-handoff";

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  googleLoginError: string | null;
  clearGoogleLoginError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]       = useState<AuthUser | null>(getStoredUser);
  const [token, setToken]     = useState<string | null>(getStoredToken);
  const [isLoading, setLoading] = useState(true);
  const [googleLoginError, setGoogleLoginError] = useState<string | null>(null);
  const devCallback = useRef<DevGoogleCallback | null | undefined>(undefined);
  const devExchange = useRef<ReturnType<typeof apiGoogleLogin> | null>(null);

  useEffect(() => {
    let cancelled = false;

    const bootstrapAuth = async () => {
      initAuthTokenGetter();

      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const handoffEnabled = isDevGoogleHandoff(window.location.hostname, window.location.pathname);
      if (devCallback.current === undefined) {
        devCallback.current = readDevGoogleCallback(window.location.hostname, window.location.pathname, window.location.hash, window.location.search);
      }
      const callback = devCallback.current;
      const supabaseAccessToken = handoffEnabled ? callback?.accessToken : hash.get("access_token");

      if (supabaseAccessToken || (handoffEnabled && callback)) {
        // Strip Supabase tokens from the URL before any asynchronous network
        // request. The access token stays only in this local bootstrap scope.
        window.history.replaceState(null, "", handoffEnabled ? window.location.pathname : window.location.pathname + window.location.search);
        try {
          if (handoffEnabled && callback && (!supabaseAccessToken || callback.error || callback.code)) {
            if (!cancelled) {
              clearAuth(); setToken(null); setUser(null);
              setGoogleLoginError(devGoogleCallbackErrorMessage(callback));
            }
            return;
          }
          if (!supabaseAccessToken) return;
          // Retain only one in-flight exchange across effect re-entry at the DEV callback.
          const { token: t, user: u } = handoffEnabled
            ? await (devExchange.current ??= apiGoogleLogin(supabaseAccessToken))
            : await apiGoogleLogin(supabaseAccessToken);
          if (cancelled) return;
          storeAuth(t, u);
          setToken(t);
          setUser(u);
          if (handoffEnabled) setGoogleLoginError(null);
        } catch (error: unknown) {
          if (cancelled) return;
          clearAuth();
          setToken(null);
          setUser(null);
          if (handoffEnabled) setGoogleLoginError(devGoogleFailureMessage(error));
        } finally {
          // A second scrub after the async exchange protects against
          // browsers restoring the callback fragment during navigation.
          // Keep the first scrub above: never wait for the network to clear it.
          if (window.location.hash.includes("access_token=")) {
            window.history.replaceState(null, "", handoffEnabled ? window.location.pathname : window.location.pathname + window.location.search);
          }
          if (!cancelled) {
            if (handoffEnabled) { devCallback.current = null; devExchange.current = null; }
            setLoading(false);
          }
        }
        return;
      }

      if (token) {
        try {
          const me = await apiGetMe();
          if (!cancelled) setUser(me);
        } catch {
          if (!cancelled) {
            clearAuth();
            setUser(null);
            setToken(null);
          }
        } finally {
          if (!cancelled) setLoading(false);
        }
      } else {
        if (!cancelled) setLoading(false);
      }
    };

    void bootstrapAuth();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { token: t, user: u } = await apiLogin(email, password);
    storeAuth(t, u);
    setToken(t);
    setUser(u);
  }, []);

  const clearGoogleLoginError = useCallback(() => setGoogleLoginError(null), []);

  const logout = useCallback(() => {
    clearAuth();
    setToken(null);
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    const me = await apiGetMe();
    setUser(me);
    const stored = getStoredToken();
    if (stored) {
      localStorage.setItem("ai_task_center_user", JSON.stringify(me));
    }
  }, []);

  return (
    <AuthContext.Provider value={{
      user, token, isLoading,
      isAuthenticated: !!token && !!user,
      login, logout, refreshUser, googleLoginError, clearGoogleLoginError,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
