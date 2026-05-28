import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import {
  getStoredToken, getStoredUser, storeAuth, clearAuth, initAuthTokenGetter,
  apiLogin, apiGetMe, type AuthUser,
} from "@/lib/auth-api";

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]       = useState<AuthUser | null>(getStoredUser);
  const [token, setToken]     = useState<string | null>(getStoredToken);
  const [isLoading, setLoading] = useState(true);

  useEffect(() => {
    initAuthTokenGetter();
    if (token) {
      apiGetMe()
        .then((me) => setUser(me))
        .catch(() => {
          clearAuth();
          setUser(null);
          setToken(null);
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { token: t, user: u } = await apiLogin(email, password);
    storeAuth(t, u);
    setToken(t);
    setUser(u);
  }, []);

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
      login, logout, refreshUser,
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
