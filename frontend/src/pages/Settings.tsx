import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { ChevronLeft } from '../components/Icon/Icon';
import styles from './Settings.module.css';

const DIET_PREFS = ['Vegetarian', 'Vegan', 'Pescatarian', 'Gluten-free', 'Dairy-free', 'Nut-free'];

interface Session {
  id: number;
  device: string;
  created_at: string;
  last_seen_at: string;
  is_current: boolean;
}

function relativeTime(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

interface SettingsProfile {
  display_name: string;
  email: string;
  bio: string | null;
  diet_prefs: string[];
  vis_mine: 'public' | 'private';
  vis_made: 'public' | 'private';
  vis_want: 'public' | 'private';
  vis_fridge: 'public' | 'private';
}

const VIS_ROWS: [keyof Pick<SettingsProfile, 'vis_mine' | 'vis_made' | 'vis_want' | 'vis_fridge'>, string, string][] = [
  ['vis_mine', 'My recipes', 'Meals you’ve published'],
  ['vis_made', 'Meals I’ve made', 'Your public cooking log'],
  ['vis_want', 'Want to make', 'Your saved list'],
  ['vis_fridge', 'My fridge', 'What’s on hand'],
];

export function Settings() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const qc = useQueryClient();

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<SettingsProfile>('/settings'),
  });

  const [displayName, setDisplayName] = useState('');
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSaved, setProfileSaved] = useState(false);

  const [email, setEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [accountError, setAccountError] = useState<string | null>(null);
  const [accountSaved, setAccountSaved] = useState(false);

  const [diet, setDiet] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmLogoutAll, setConfirmLogoutAll] = useState(false);

  const { data: sessions = [] } = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api.get<Session[]>('/auth/sessions'),
  });

  useEffect(() => {
    if (settings) {
      setDisplayName(settings.display_name);
      setEmail(settings.email);
      setDiet(settings.diet_prefs);
    }
  }, [settings]);

  const saveProfile = useMutation({
    mutationFn: () => api.post('/profile', { display_name: displayName.trim() }),
    onSuccess: () => {
      setProfileSaved(true);
      setProfileError(null);
      qc.invalidateQueries({ queryKey: ['settings'] });
      qc.invalidateQueries({ queryKey: ['me'] });
      setTimeout(() => setProfileSaved(false), 2000);
    },
    onError: (e) => setProfileError(e instanceof ApiError ? e.message : 'Could not save that.'),
  });

  const saveAccount = useMutation({
    mutationFn: () =>
      api.post('/auth/account', {
        email: email.trim() !== settings?.email ? email.trim() : undefined,
        current_password: currentPassword || undefined,
        new_password: newPassword || undefined,
      }),
    onSuccess: () => {
      setAccountSaved(true);
      setAccountError(null);
      setCurrentPassword('');
      setNewPassword('');
      qc.invalidateQueries({ queryKey: ['settings'] });
      setTimeout(() => setAccountSaved(false), 2000);
    },
    onError: (e) => setAccountError(e instanceof ApiError ? e.message : 'Could not save that.'),
  });

  const toggleDiet = useMutation({
    mutationFn: (next: string[]) => api.post('/profile', { diet_prefs: next }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });

  const setVisibility = useMutation({
    mutationFn: (patch: Record<string, string>) => api.post('/profile', patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });

  const deleteAccount = useMutation({
    mutationFn: () => api.del('/auth/account'),
    onSuccess: () => {
      logout();
      navigate('/', { replace: true });
    },
  });

  const revokeSession = useMutation({
    mutationFn: (id: number) => api.del(`/auth/sessions/${id}`),
    onSuccess: (_data, id) => {
      const wasCurrent = sessions.find((s) => s.id === id)?.is_current;
      if (wasCurrent) {
        logout();
        navigate('/', { replace: true });
        return;
      }
      qc.invalidateQueries({ queryKey: ['sessions'] });
    },
  });

  const revokeOthers = useMutation({
    mutationFn: () => api.post('/auth/sessions/revoke-others'),
    onSuccess: () => {
      setConfirmLogoutAll(false);
      qc.invalidateQueries({ queryKey: ['sessions'] });
    },
  });

  if (!user || !settings) return null;

  function toggleDietChip(pref: string) {
    const next = diet.includes(pref) ? diet.filter((d) => d !== pref) : [...diet, pref];
    setDiet(next);
    toggleDiet.mutate(next);
  }

  const emailChanged = email.trim() !== settings.email;
  const wantsPasswordChange = newPassword.length > 0;
  const needsCurrentPassword = emailChanged || wantsPasswordChange;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate(-1)} aria-label="Back">
          <ChevronLeft size={18} strokeWidth={2.2} />
        </button>
        <h1 className={styles.title}>Settings</h1>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Profile</div>
        <div className={styles.field}>
          <label className={styles.label}>Display name</label>
          <input className={styles.input} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </div>
        {profileError && <p className={styles.error}>{profileError}</p>}
        {profileSaved && <p className={styles.success}>Saved.</p>}
        <button className={styles.saveBtn} onClick={() => saveProfile.mutate()} disabled={saveProfile.isPending}>
          Save
        </button>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Account</div>
        <div className={styles.field}>
          <label className={styles.label}>Email</label>
          <input className={styles.input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className={styles.field}>
          <label className={styles.label}>New password</label>
          <input
            className={styles.input}
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Leave blank to keep your current password"
            autoComplete="new-password"
          />
        </div>
        {needsCurrentPassword && (
          <div className={styles.field}>
            <label className={styles.label}>Current password</label>
            <input
              className={styles.input}
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Required to change email or password"
              autoComplete="current-password"
            />
          </div>
        )}
        {accountError && <p className={styles.error}>{accountError}</p>}
        {accountSaved && <p className={styles.success}>Saved.</p>}
        <button
          className={styles.saveBtn}
          onClick={() => saveAccount.mutate()}
          disabled={saveAccount.isPending || (needsCurrentPassword && !currentPassword)}
        >
          Save
        </button>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Sessions</div>
        <div className={styles.sessionList}>
          {sessions.map((s) => (
            <div key={s.id} className={styles.sessionRow}>
              <div>
                <div className={styles.visLabel}>
                  {s.device}
                  {s.is_current && <span className={styles.sessionBadge}>This device</span>}
                </div>
                <div className={styles.visSub}>Active {relativeTime(s.last_seen_at)}</div>
              </div>
              <button
                className={styles.sessionRevoke}
                onClick={() => revokeSession.mutate(s.id)}
                disabled={revokeSession.isPending}
              >
                {s.is_current ? 'Log out' : 'Revoke'}
              </button>
            </div>
          ))}
        </div>
        {sessions.length > 1 && (
          !confirmLogoutAll ? (
            <button className={styles.sessionRevokeAll} onClick={() => setConfirmLogoutAll(true)}>
              Log out of all other sessions
            </button>
          ) : (
            <div className={styles.confirmCard}>
              <p className={styles.confirmText}>
                This signs out every session except the one you're using right now.
              </p>
              <div className={styles.confirmRow}>
                <button className={styles.confirmCancel} onClick={() => setConfirmLogoutAll(false)}>
                  Cancel
                </button>
                <button className={styles.confirmDelete} onClick={() => revokeOthers.mutate()}>
                  {revokeOthers.isPending ? 'Logging out…' : 'Log out everywhere else'}
                </button>
              </div>
            </div>
          )
        )}
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Diet preferences</div>
        <div className={styles.chipRow}>
          {DIET_PREFS.map((p) => (
            <button
              key={p}
              className={`${styles.chip} ${diet.includes(p) ? styles.chipActive : ''}`}
              onClick={() => toggleDietChip(p)}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Visibility</div>
        {VIS_ROWS.map(([key, label, sub]) => (
          <div key={key} className={styles.visRow}>
            <div>
              <div className={styles.visLabel}>{label}</div>
              <div className={styles.visSub}>{sub}</div>
            </div>
            <div className={styles.visToggle}>
              <button
                className={settings[key] === 'public' ? styles.visActive : ''}
                onClick={() => setVisibility.mutate({ [key]: 'public' })}
              >
                Public
              </button>
              <button
                className={settings[key] === 'private' ? styles.visActive : ''}
                onClick={() => setVisibility.mutate({ [key]: 'private' })}
              >
                Private
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className={styles.dangerZone}>
        {!confirmDelete ? (
          <button className={styles.deleteBtn} onClick={() => setConfirmDelete(true)}>
            Delete account
          </button>
        ) : (
          <div className={styles.confirmCard}>
            <p className={styles.confirmText}>
              This permanently deletes your account, your recipes, and everything in your cookbook. This can't be undone.
            </p>
            <div className={styles.confirmRow}>
              <button className={styles.confirmCancel} onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
              <button className={styles.confirmDelete} onClick={() => deleteAccount.mutate()}>
                {deleteAccount.isPending ? 'Deleting…' : 'Delete permanently'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
