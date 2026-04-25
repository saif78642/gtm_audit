// Auth API service — handles login, signup, invite keys, and token storage.

const BASE = import.meta.env.DEV 
  ? ((import.meta.env.VITE_WORKER_URL as string | undefined) ?? 'http://localhost:8787')
  : ((import.meta.env.VITE_WORKER_URL as string | undefined) ?? '');

const TOKEN_KEY = 'gtm_auth_token';

// ── Token helpers ─────────────────────────────────────────────────────────────

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  created_at: number;
}

export interface InviteKey {
  invite_key: string;
  created_by: string;
  used_by: string | null;
  used_at: number | null;
  created_at: number;
}

// ── Fetch helper ──────────────────────────────────────────────────────────────

async function authFetch<T>(
  path: string,
  opts?: RequestInit,
  includeAuth = false,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts?.headers as Record<string, string> ?? {}),
  };

  if (includeAuth) {
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error((data as any).error || `HTTP ${res.status}`);
  }

  return data as T;
}

// ── API methods ───────────────────────────────────────────────────────────────

export const authApi = {
  /** Create the very first account (only works when 0 users exist). */
  bootstrap(username: string, email: string, password: string) {
    return authFetch<{ token: string; user: AuthUser }>('/api/auth/bootstrap', {
      method: 'POST',
      body: JSON.stringify({ username, email, password }),
    });
  },

  /** Sign up with an invite key. */
  signup(username: string, email: string, password: string, inviteKey: string) {
    return authFetch<{ token: string; user: AuthUser }>('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ username, email, password, inviteKey }),
    });
  },

  /** Log in with email + password. */
  login(email: string, password: string) {
    return authFetch<{ token: string; user: AuthUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  },

  /** Log out (invalidate current token server-side). */
  logout() {
    return authFetch<{ success: boolean }>('/api/auth/logout', { method: 'POST' }, true);
  },

  /** Get current user info (validate token). */
  getMe() {
    return authFetch<{ user: AuthUser }>('/api/auth/me', { method: 'GET' }, true);
  },

  /** Generate a new invite key. */
  generateInviteKey() {
    return authFetch<{ invite_key: string }>('/api/auth/invite', { method: 'POST' }, true);
  },

  /** List invite keys created by the current user. */
  getInviteKeys() {
    return authFetch<InviteKey[]>('/api/auth/invite-keys', { method: 'GET' }, true);
  },
};
