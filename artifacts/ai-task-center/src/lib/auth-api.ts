import { setAuthTokenGetter } from "@workspace/api-client-react";

const TOKEN_KEY = "ai_task_center_token";
const USER_KEY  = "ai_task_center_user";

export interface AuthUser {
  id: number;
  companyId: string;
  name: string;
  email: string;
  role: string;
  division: string | null;
  phone: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) as AuthUser : null;
  } catch {
    return null;
  }
}

export function storeAuth(token: string, user: AuthUser): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  setAuthTokenGetter(() => localStorage.getItem(TOKEN_KEY));
}

export function clearAuth(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  setAuthTokenGetter(null);
}

export function initAuthTokenGetter(): void {
  const token = getStoredToken();
  if (token) {
    setAuthTokenGetter(() => localStorage.getItem(TOKEN_KEY));
  }
}

async function authFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers as Record<string, string> | undefined ?? {}),
  };
  const res = await fetch(path, { ...options, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as unknown as T;
  return res.json() as Promise<T>;
}

export async function apiLogin(email: string, password: string): Promise<{ token: string; user: AuthUser }> {
  return authFetch("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function apiGetMe(): Promise<AuthUser> {
  return authFetch("/api/auth/me");
}

export async function apiListUsers(): Promise<AuthUser[]> {
  return authFetch("/api/auth/users");
}

export async function apiCreateUser(data: {
  name: string;
  email: string;
  password: string;
  role: string;
  division?: string;
  phone?: string;
}): Promise<AuthUser> {
  return authFetch("/api/auth/users", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function apiUpdateUser(
  id: number,
  data: Partial<{ name: string; role: string; division: string; phone: string; isActive: boolean }>,
): Promise<AuthUser> {
  return authFetch(`/api/auth/users/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function apiDeleteUser(id: number): Promise<void> {
  return authFetch(`/api/auth/users/${id}`, { method: "DELETE" });
}

export async function apiChangePassword(currentPassword: string, newPassword: string): Promise<void> {
  return authFetch("/api/auth/password", {
    method: "PATCH",
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}
