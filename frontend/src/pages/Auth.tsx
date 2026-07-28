import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Card } from '../components/Card/Card';
import { Button } from '../components/Button/Button';
import { Input } from '../components/Input/Input';
import { useAuth } from '../auth/AuthContext';
import { api } from '../api/client';
import styles from './Auth.module.css';

export function Auth() {
  const { login, verifyTwoFactor, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot'>('login');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  // Set once `login` comes back asking for a second factor - while this is
  // non-null the form below shows the code prompt instead of email/password.
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');

  const isSignup = mode === 'signup';
  const isForgot = mode === 'forgot';

  const forgotPassword = useMutation({
    mutationFn: (addr: string) => api.post('/auth/forgot-password', { email: addr }),
    onSuccess: () => setResetSent(true),
  });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (isForgot) {
      forgotPassword.mutate(email);
      return;
    }
    setBusy(true);
    try {
      if (isSignup) {
        await register(email, password, displayName);
      } else {
        const result = await login(email, password);
        if (result.twoFactorRequired) setChallenge(result.challenge);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  async function onVerify(e: FormEvent) {
    e.preventDefault();
    if (!challenge) return;
    setError(null);
    setBusy(true);
    try {
      await verifyTwoFactor(challenge, code.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  function switchMode(next: 'login' | 'signup' | 'forgot') {
    setMode(next);
    setError(null);
    setResetSent(false);
    setChallenge(null);
    setCode('');
  }

  return (
    <div className={styles.screen}>
      <div className={styles.panel}>
        <div className={styles.brand}>
          <h1 className={styles.title}>Cookbook</h1>
          <p className={styles.tagline}>Follow chefs. Cook from your fridge.</p>
        </div>

        <Card>
          {challenge ? (
            <form className={styles.form} onSubmit={onVerify}>
              {error && <p className={styles.error}>{error}</p>}
              <p className={styles.forgotHint}>
                We sent a 6-digit code to your email. It expires in 10 minutes.
              </p>
              <Input
                label="Code"
                inputMode="numeric"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoComplete="one-time-code"
                maxLength={6}
                autoFocus
                required
              />
              <Button type="submit" fullWidth disabled={busy || code.trim().length !== 6}>
                {busy ? 'Checking…' : 'Verify'}
              </Button>
              <button type="button" className={styles.forgotLink} onClick={() => switchMode('login')}>
                Back to sign in
              </button>
            </form>
          ) : isForgot ? (
            resetSent ? (
              <div className={styles.form}>
                <p className={styles.resetSent}>
                  If an account exists for that email, a reset link has been started for it.
                </p>
                <Button type="button" fullWidth onClick={() => switchMode('login')}>
                  Back to sign in
                </Button>
              </div>
            ) : (
              <form className={styles.form} onSubmit={onSubmit}>
                <p className={styles.forgotHint}>
                  Enter your email and we'll get a reset link started.
                </p>
                <Input
                  label="Email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
                <Button type="submit" fullWidth disabled={forgotPassword.isPending}>
                  {forgotPassword.isPending ? 'Just a moment…' : 'Send reset link'}
                </Button>
              </form>
            )
          ) : (
            <form className={styles.form} onSubmit={onSubmit}>
              {error && <p className={styles.error}>{error}</p>}

              {isSignup && (
                <Input
                  label="Your name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  autoComplete="name"
                  placeholder="Chef"
                />
              )}

              <Input
                label="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />

              <Input
                label="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={isSignup ? 'new-password' : 'current-password'}
                minLength={isSignup ? 8 : undefined}
                required
              />

              {!isSignup && (
                <button type="button" className={styles.forgotLink} onClick={() => switchMode('forgot')}>
                  Forgot password?
                </button>
              )}

              <Button type="submit" fullWidth disabled={busy}>
                {busy ? 'Just a moment…' : isSignup ? 'Create account' : 'Sign in'}
              </Button>
            </form>
          )}
        </Card>

        {!isForgot && (
          <p className={styles.switch}>
            {isSignup ? 'Already have an account? ' : "Don't have an account? "}
            <button type="button" className={styles.switchLink} onClick={() => switchMode(isSignup ? 'login' : 'signup')}>
              {isSignup ? 'Sign in' : 'Sign up'}
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
