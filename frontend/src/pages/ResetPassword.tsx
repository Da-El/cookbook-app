import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Card } from '../components/Card/Card';
import { Button } from '../components/Button/Button';
import { Input } from '../components/Input/Input';
import { api, ApiError } from '../api/client';
import styles from './Auth.module.css';

/**
 * The other half of Auth.tsx's "Forgot password?" flow - reached via the
 * link a reset request produces, not from in-app navigation, so it has to
 * work whether or not the visitor has a session (App.tsx routes it in both
 * the signed-in and signed-out trees for exactly that reason).
 */
export function ResetPassword() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const reset = useMutation({
    mutationFn: () => api.post('/auth/reset-password', { token, new_password: password }),
    onSuccess: () => setDone(true),
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Something went wrong.'),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    reset.mutate();
  }

  return (
    <div className={styles.screen}>
      <div className={styles.panel}>
        <div className={styles.brand}>
          <h1 className={styles.title}>Cookbook</h1>
          <p className={styles.tagline}>Set a new password</p>
        </div>

        <Card>
          {!token ? (
            <p className={styles.forgotHint}>
              That link is missing its token. Request a new one from the sign-in screen.
            </p>
          ) : done ? (
            <div className={styles.form}>
              <p className={styles.resetSent}>
                Your password has been changed. Every other session has been signed out, so sign in
                again with your new password.
              </p>
              <Button type="button" fullWidth onClick={() => navigate('/', { replace: true })}>
                Go to sign in
              </Button>
            </div>
          ) : (
            <form className={styles.form} onSubmit={onSubmit}>
              {error && <p className={styles.error}>{error}</p>}
              <Input
                label="New password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
              <Button type="submit" fullWidth disabled={reset.isPending}>
                {reset.isPending ? 'Just a moment…' : 'Set new password'}
              </Button>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
