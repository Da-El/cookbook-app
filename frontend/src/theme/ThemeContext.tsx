import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { PAGE_THEMES, type PageTheme } from '../lib/themes';
import { useColorScheme } from './ColorSchemeContext';

export interface ProfileTheme {
  cb_title: string | null;
  cb_bio: string | null;
  cb_page_theme: PageTheme;
  cb_page_photo_url: string | null;
  cb_hero_theme: PageTheme;
  cb_hero_photo_url: string | null;
  cb_avatar_theme: 'green' | 'terracotta' | 'navy' | 'plum';
  cb_avatar_photo_url: string | null;
}

const ThemeContext = createContext<ProfileTheme | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { resolved } = useColorScheme();
  const { data: theme } = useQuery({
    queryKey: ['profile-theme'],
    queryFn: () => api.get<ProfileTheme>('/profile/theme'),
    enabled: Boolean(user),
  });

  useEffect(() => {
    // The five page themes (Cream/Sage/Terracotta/...) are all light
    // backgrounds meant for dark ink text - there's no dark equivalent of
    // "Blush" to switch to, so dark mode shows one consistent dark
    // background instead and leaves this inline override unset entirely,
    // letting the CSS `--bg-page` token (which dark mode does retint) win.
    if (resolved === 'dark') {
      document.body.style.background = '';
      return;
    }
    const pageBg = theme
      ? theme.cb_page_photo_url
        ? `center/cover no-repeat url("${theme.cb_page_photo_url}")`
        : PAGE_THEMES[theme.cb_page_theme].pageBg
      : PAGE_THEMES.cream.pageBg;
    document.body.style.background = pageBg;
  }, [theme, resolved]);

  return <ThemeContext.Provider value={theme ?? null}>{children}</ThemeContext.Provider>;
}

export const useProfileTheme = () => useContext(ThemeContext);
