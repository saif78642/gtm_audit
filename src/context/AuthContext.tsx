import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authApi, type AuthUser, getToken, setToken, clearToken } from '../services/authApi';

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (username: string, email: string, password: string, inviteKey: string) => Promise<void>;
  bootstrap: (username: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Check existing token on mount
  useEffect(() => {
    const token = getToken();
    if (!token) {
      setIsLoading(false);
      return;
    }

    authApi
      .getMe()
      .then(({ user }) => setUser(user))
      .catch(() => {
        clearToken(); // token is invalid/expired
      })
      .finally(() => setIsLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { token, user } = await authApi.login(email, password);
    setToken(token);
    setUser(user);
  }, []);

  const signup = useCallback(
    async (username: string, email: string, password: string, inviteKey: string) => {
      const { token, user } = await authApi.signup(username, email, password, inviteKey);
      setToken(token);
      setUser(user);
    },
    [],
  );

  const bootstrap = useCallback(
    async (username: string, email: string, password: string) => {
      const { token, user } = await authApi.bootstrap(username, email, password);
      setToken(token);
      setUser(user);
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      /* best-effort */
    }
    clearToken();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        login,
        signup,
        bootstrap,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
