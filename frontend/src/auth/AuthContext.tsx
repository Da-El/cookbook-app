import { createContext, useContext, type ReactNode } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { UserProfile } from '../api/types';

interface AuthValue {
  user: UserProfile | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();

  const { data: user, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api.get<UserProfile>('/auth/me');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    retry: false,
  });

  const setUser = (u: UserProfile | null) => qc.setQueryData(['me'], u);

  const loginMut = useMutation({
    mutationFn: (v: { email: string; password: string }) =>
      api.post<UserProfile>('/auth/login', v),
    onSuccess: setUser,
  });

  const registerMut = useMutation({
    mutationFn: (v: { email: string; password: string; display_name: string }) =>
      api.post<UserProfile>('/auth/register', v),
    onSuccess: setUser,
  });

  const value: AuthValue = {
    user: user ?? null,
    loading: isLoading,
    login: async (email, password) => {
      await loginMut.mutateAsync({ email, password });
    },
    register: async (email, password, display_name) => {
      await registerMut.mutateAsync({ email, password, display_name });
    },
    logout: async () => {
      await api.post('/auth/logout');
      setUser(null);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
