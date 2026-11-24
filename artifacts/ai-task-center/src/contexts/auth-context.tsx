import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import {
  getStoredToken, getStoredUser, storeAuth, clearAuth, initAuthTokenGetter,
  apiLogin, apiGoogleLogin, apiGetMe, type AuthUser,
} from "@/lib/auth-api";

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
  const oauthResponse = useRef<{ accessToken: string | null; error: string | null; code: string | null } | null>(null);

  useEffect(() => {
    let cancelled = false;

    const bootstrapAuth = async () => {
      initAuthTokenGetter();

      if (!oauthResponse.current) {
        const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
        const query = new URLSearchParams(window.location.search);
        oauthResponse.current = {
          accessToken: hash.get("access_token"),
          error: hash.get("error") ?? query.get("error"),
          code: query.get("code"),
        };
        if (oauthResponse.current.accessToken || oauthResponse.current.error || oauthResponse.current.code) {
          // Remove tokens and OAuth codes from the address bar, but retain them
          // in a component ref across effect re-entry.
          window.history.replaceState(null, "", window.location.pathname);
        }
      }

      const oauth = oauthResponse.current;
      if (oauth?.accessToken) {
        try {
          const { token: t, user: u } = await apiGoogleLogin(oauth.accessToken);
          if (cancelled) return;
          storeAuth(t, u);
          setToken(t);
          setUser(u);
          setGoogleLoginError(null);
        } catch (err: unknown) {
          if (cancelled) return;
          clearAuth();
          setToken(null);
          setUser(null);
          const reason = err instanceof Error ? err.message : "";
          setGoogleLoginError(
            /not registered|unambiguous|canonical google/i.test(reason)
              ? "Akun Google sudah terverifikasi, tetapi tidak cocok dengan profil Admin DEV."
              : /invalid supabase session|verified google account/i.test(reason)
              ? "Sesi Google tidak dapat diverifikasi oleh AI Task Center. Ulangi login Google."
              : "Sesi Google belum berhasil diteruskan ke AI Task Center. Coba kembali melalui tombol Google."
          );
        } finally {
          if (!cancelled) setLoading(false);
        }
        return;
      }

      if (oauth?.error || oauth?.code) {
        if (!cancelled) {
          clearAuth();
          setToken(null);
          setUser(null);
          setGoogleLoginError(
            oauth.error
              ? "Google membatalkan atau menolak proses masuk. Silakan ulangi melalui tombol Masuk dengan Google."
              : "Google mengembalikan kode login yang tidak didukung. Gunakan kembali tombol Masuk dengan Google."
          );
          setLoading(false);
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
