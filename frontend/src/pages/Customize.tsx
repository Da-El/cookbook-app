import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { ChevronLeft } from '../components/Icon/Icon';
import { pickImage } from '../lib/photo';
import { AVATAR_THEMES, PAGE_THEMES, heroCardBg, heroTextColorsForScheme, type AvatarTheme, type PageTheme } from '../lib/themes';
import type { ProfileTheme } from '../theme/ThemeContext';
import { useColorScheme } from '../theme/ColorSchemeContext';
import styles from './Customize.module.css';

interface FormState {
  cb_title: string;
  cb_bio: string;
  cb_page_theme: PageTheme;
  cb_page_photo_url: string | null;
  cb_hero_theme: PageTheme;
  cb_hero_photo_url: string | null;
  cb_avatar_theme: AvatarTheme;
  cb_avatar_photo_url: string | null;
}

const PAGE_THEME_KEYS = Object.keys(PAGE_THEMES) as PageTheme[];
const AVATAR_THEME_KEYS = Object.keys(AVATAR_THEMES) as AvatarTheme[];

export function Customize() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { resolved: colorScheme } = useColorScheme();

  const { data: initial } = useQuery({
    queryKey: ['profile-theme'],
    queryFn: () => api.get<ProfileTheme>('/profile/theme'),
  });

  const [form, setForm] = useState<FormState | null>(null);

  useEffect(() => {
    if (initial && !form) {
      setForm({
        cb_title: initial.cb_title ?? '',
        cb_bio: initial.cb_bio ?? '',
        cb_page_theme: initial.cb_page_theme,
        cb_page_photo_url: initial.cb_page_photo_url,
        cb_hero_theme: initial.cb_hero_theme,
        cb_hero_photo_url: initial.cb_hero_photo_url,
        cb_avatar_theme: initial.cb_avatar_theme,
        cb_avatar_photo_url: initial.cb_avatar_photo_url,
      });
    }
  }, [initial, form]);

  const save = useMutation({
    mutationFn: (next: FormState) => api.post('/profile/customize', next),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['profile-theme'] }),
  });

  // Every change is live - the design has no separate save step.
  function apply(patch: Partial<FormState>) {
    setForm((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      save.mutate(next);
      return next;
    });
  }

  if (!form || !user) return null;

  const hasHeroPhoto = Boolean(form.cb_hero_photo_url);
  const heroColors = heroTextColorsForScheme(hasHeroPhoto, form.cb_hero_theme, colorScheme === 'dark');
  const heroBg = hasHeroPhoto
    ? `center/cover no-repeat url("${form.cb_hero_photo_url}")`
    : heroCardBg(hasHeroPhoto, form.cb_hero_theme, colorScheme === 'dark');

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate(-1)} aria-label="Back">
          <ChevronLeft size={18} strokeWidth={2.2} />
        </button>
        <h1 className={styles.title}>Customize your Cookbook</h1>
      </div>

      <div className={styles.preview} style={{ background: heroBg }}>
        {hasHeroPhoto && <div className={styles.previewScrim} />}
        <div className={styles.previewEyebrow} style={{ color: heroColors.eyebrow }}>
          {user.display_name}'s kitchen
        </div>
        <div className={styles.previewTitle} style={{ color: heroColors.title }}>
          {form.cb_title.trim() || 'Your Cookbook'}
        </div>
        {form.cb_bio.trim() && (
          <div className={styles.previewBio} style={{ color: heroColors.bio }}>
            {form.cb_bio}
          </div>
        )}
      </div>

      <div className={styles.field}>
        <label className={styles.label}>Cookbook name</label>
        <input
          className={styles.input}
          value={form.cb_title}
          placeholder="Your Cookbook"
          onChange={(e) => setForm({ ...form, cb_title: e.target.value })}
          onBlur={() => apply({ cb_title: form.cb_title })}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label}>Bio</label>
        <input
          className={styles.input}
          value={form.cb_bio}
          placeholder="Add a short line about your cooking…"
          onChange={(e) => setForm({ ...form, cb_bio: e.target.value })}
          onBlur={() => apply({ cb_bio: form.cb_bio })}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label}>Entire background</label>
        <p className={styles.hint}>Applies to the whole app, behind every screen.</p>
        <div className={styles.swatchRow}>
          {PAGE_THEME_KEYS.map((key) => {
            const t = PAGE_THEMES[key];
            const selected = !form.cb_page_photo_url && form.cb_page_theme === key;
            return (
              <button
                key={key}
                title={t.name}
                className={`${styles.swatch} ${selected ? styles.swatchSelected : ''}`}
                style={{ background: t.swatch, ['--ring-color' as string]: t.accent }}
                onClick={() => apply({ cb_page_theme: key, cb_page_photo_url: null })}
              />
            );
          })}
          {form.cb_page_photo_url && (
            <button
              className={`${styles.previewThumb} ${styles.photoActive}`}
              style={{ backgroundImage: `url("${form.cb_page_photo_url}")` }}
              title="Current photo"
            />
          )}
          <button
            className={styles.uploadSwatch}
            title="Upload a photo"
            onClick={() => pickImage((url) => apply({ cb_page_photo_url: url }))}
          >
            <UploadIcon />
          </button>
          {form.cb_page_photo_url && (
            <button className={styles.removePhoto} onClick={() => apply({ cb_page_photo_url: null })}>
              Remove photo
            </button>
          )}
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.label}>Kitchen card</label>
        <p className={styles.hint}>The card above — can differ from the background.</p>
        <div className={styles.swatchRow}>
          {PAGE_THEME_KEYS.map((key) => {
            const t = PAGE_THEMES[key];
            const selected = !form.cb_hero_photo_url && form.cb_hero_theme === key;
            return (
              <button
                key={key}
                title={t.name}
                className={`${styles.swatch} ${selected ? styles.swatchSelected : ''}`}
                style={{ background: t.swatch, ['--ring-color' as string]: t.accent }}
                onClick={() => apply({ cb_hero_theme: key, cb_hero_photo_url: null })}
              />
            );
          })}
          {form.cb_hero_photo_url && (
            <button
              className={`${styles.previewThumb} ${styles.photoActive}`}
              style={{ backgroundImage: `url("${form.cb_hero_photo_url}")` }}
              title="Current photo"
            />
          )}
          <button
            className={styles.uploadSwatch}
            title="Upload a photo"
            onClick={() => pickImage((url) => apply({ cb_hero_photo_url: url }))}
          >
            <UploadIcon />
          </button>
          {form.cb_hero_photo_url && (
            <button className={styles.removePhoto} onClick={() => apply({ cb_hero_photo_url: null })}>
              Remove photo
            </button>
          )}
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.label}>Avatar</label>
        <div className={styles.swatchRow}>
          <span
            className={`${styles.previewThumb} ${styles.previewThumbRound} ${form.cb_avatar_photo_url ? styles.photoActive : ''}`}
            style={
              form.cb_avatar_photo_url
                ? { backgroundImage: `url("${form.cb_avatar_photo_url}")` }
                : { background: AVATAR_THEMES[form.cb_avatar_theme].gradient }
            }
          />
          {AVATAR_THEME_KEYS.map((key) => {
            const selected = !form.cb_avatar_photo_url && form.cb_avatar_theme === key;
            return (
              <button
                key={key}
                title={AVATAR_THEMES[key].name}
                className={`${styles.swatch} ${styles.avatarSwatch} ${selected ? styles.swatchSelected : ''}`}
                style={{ background: AVATAR_THEMES[key].gradient, ['--ring-color' as string]: '#241F1B' }}
                onClick={() => apply({ cb_avatar_theme: key, cb_avatar_photo_url: null })}
              />
            );
          })}
          <button
            className={`${styles.uploadSwatch} ${styles.uploadSwatchRound}`}
            title="Upload a photo"
            onClick={() => pickImage((url) => apply({ cb_avatar_photo_url: url }))}
          >
            <UploadIcon />
          </button>
          {form.cb_avatar_photo_url && (
            <button className={styles.removePhoto} onClick={() => apply({ cb_avatar_photo_url: null })}>
              Remove photo
            </button>
          )}
        </div>
      </div>

      <button className={styles.doneBtn} onClick={() => navigate('/cookbook')}>
        Done
      </button>
    </div>
  );
}

function UploadIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2.2l1.2-2h8.2l1.2 2h2.2A1.5 1.5 0 0 1 21 8.5v10A1.5 1.5 0 0 1 19.5 20h-15A1.5 1.5 0 0 1 3 18.5z" />
      <circle cx="12" cy="13" r="3.6" />
    </svg>
  );
}
