import { createContext, useContext, type ReactNode } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { UserProfile } from '../api/types';

/// Either a normal login response, or - when the account has 2FA turned
/// on - a challenge to complete with `verifyTwoFactor` instead of a
/// session having been created yet.
type LoginOutcome = { twoFactorRequired: false } | { twoFactorRequired: true; challenge: string };

interface AuthValue {
  user: UserProfile | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<LoginOutcome>;
  verifyTwoFactor: (challenge: string, opts: { code?: string; recoveryCode?: string }) => Promise<void>;
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
      api.post<UserProfile | { two_factor_required: true; challenge: string }>('/auth/login', v),
  });

  const verifyMut = useMutation({
    mutationFn: (v: { challenge: string; code?: string; recovery_code?: string }) =>
      api.post<UserProfile>('/auth/2fa/verify', v),
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
      const res = await loginMut.mutateAsync({ email, password });
      if ('two_factor_required' in res && res.two_factor_required) {
        return { twoFactorRequired: true, challenge: res.challenge };
      }
      setUser(res as UserProfile);
      return { twoFactorRequired: false };
    },
    verifyTwoFactor: async (challenge, { code, recoveryCode }) => {
      await verifyMut.mutateAsync({ challenge, code, recovery_code: recoveryCode });
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
