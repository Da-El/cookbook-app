import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../components/Card/Card';
import { Button } from '../components/Button/Button';
import { Input } from '../components/Input/Input';
import { useAuth } from '../auth/AuthContext';
import styles from './Auth.module.css';

export function Auth() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isSignup = mode === 'signup';

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (isSignup) {
        await register(email, password, displayName);
      } else {
        await login(email, password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.screen}>
      <div className={styles.panel}>
        <div className={styles.brand}>
          <h1 className={styles.title}>Cookbook</h1>
          <p className={styles.tagline}>Follow chefs. Cook from your fridge.</p>
        </div>

        <Card>
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

            <Button type="submit" fullWidth disabled={busy}>
              {busy ? 'Just a moment…' : isSignup ? 'Create account' : 'Sign in'}
            </Button>
          </form>
        </Card>

        <p className={styles.switch}>
          {isSignup ? 'Already have an account? ' : "Don't have an account? "}
          <button
            type="button"
            className={styles.switchLink}
            onClick={() => {
              setMode(isSignup ? 'login' : 'signup');
              setError(null);
            }}
          >
            {isSignup ? 'Sign in' : 'Sign up'}
          </button>
        </p>

        <p className={styles.legal}>
          <Link to="/legal" className={styles.legalLink}>Legal &amp; privacy</Link>
        </p>
      </div>
    </div>
  );
}
