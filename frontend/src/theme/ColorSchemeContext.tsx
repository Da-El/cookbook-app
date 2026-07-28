import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type ColorScheme = 'light' | 'dark' | 'system';
const STORAGE_KEY = 'cb-color-scheme';

function systemPrefersDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Same resolution `index.html`'s inline script does before React ever
 * mounts, kept in sync here so `<select>`/toggle state and the actual
 * applied theme can't drift apart. */
function resolve(scheme: ColorScheme): 'light' | 'dark' {
  return scheme === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : scheme;
}

interface ColorSchemeValue {
  scheme: ColorScheme;
  resolved: 'light' | 'dark';
  setScheme: (s: ColorScheme) => void;
}

const ColorSchemeContext = createContext<ColorSchemeValue | null>(null);

export function ColorSchemeProvider({ children }: { children: ReactNode }) {
  const [scheme, setSchemeState] = useState<ColorScheme>(
    () => (localStorage.getItem(STORAGE_KEY) as ColorScheme | null) ?? 'system',
  );
  const [resolved, setResolved] = useState<'light' | 'dark'>(() => resolve(scheme));

  const setScheme = (s: ColorScheme) => {
    setSchemeState(s);
    localStorage.setItem(STORAGE_KEY, s);
  };

  useEffect(() => {
    const next = resolve(scheme);
    setResolved(next);
    document.documentElement.dataset.theme = next;
  }, [scheme]);

  // Only matters while `scheme === 'system'` - a manual light/dark pick
  // already has its own fixed `resolved` value the OS can't move.
  useEffect(() => {
    if (scheme !== 'system') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      const next = resolve('system');
      setResolved(next);
      document.documentElement.dataset.theme = next;
    };
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [scheme]);

  return (
    <ColorSchemeContext.Provider value={{ scheme, resolved, setScheme }}>{children}</ColorSchemeContext.Provider>
  );
}

export const useColorScheme = () => {
  const ctx = useContext(ColorSchemeContext);
  if (!ctx) throw new Error('useColorScheme must be used within ColorSchemeProvider');
  return ctx;
};
