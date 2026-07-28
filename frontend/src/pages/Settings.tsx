import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useColorScheme, type ColorScheme } from '../theme/ColorSchemeContext';
import { ChevronLeft } from '../components/Icon/Icon';
import { RecoveryCodes } from '../components/RecoveryCodes/RecoveryCodes';
import { PasswordStrength } from '../components/PasswordStrength/PasswordStrength';
import styles from './Settings.module.css';

const DIET_PREFS = ['Vegetarian', 'Vegan', 'Pescatarian', 'Gluten-free', 'Dairy-free', 'Nut-free'];
const APPEARANCE_OPTIONS: [ColorScheme, string][] = [
  ['light', 'Light'],
  ['dark', 'Dark'],
  ['system', 'System'],
];

interface Session {
  id: number;
  device: string;
  created_at: string;
  last_seen_at: string;
  is_current: boolean;
}

interface NotificationPref {
  type: string;
  label: string;
  description: string;
  email_enabled: boolean;
}

interface BlockedUser {
  id: number;
  display_name: string;
  created_at: string;
}

interface LoginHistoryRow {
  id: number;
  device: string;
  ip: string | null;
  success: boolean;
  attempted_at: string;
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
  vis_plan: 'public' | 'private';
  two_factor_enabled: boolean;
  unit_system: 'as_written' | 'metric' | 'imperial';
  goal_calories: number | null;
  goal_protein_g: number | null;
  goal_carbs_g: number | null;
  goal_fat_g: number | null;
}

const UNIT_SYSTEMS: ['as_written' | 'metric' | 'imperial', string][] = [
  ['as_written', 'As written'],
  ['metric', 'Metric'],
  ['imperial', 'Imperial'],
];

const VIS_ROWS: [keyof Pick<SettingsProfile, 'vis_mine' | 'vis_made' | 'vis_want' | 'vis_fridge' | 'vis_plan'>, string, string][] = [
  ['vis_mine', 'My recipes', 'Meals you’ve published'],
  ['vis_made', 'Meals I’ve made', 'Your public cooking log'],
  ['vis_want', 'Want to make', 'Your saved list'],
  ['vis_fridge', 'My fridge', 'What’s on hand'],
  ['vis_plan', 'My meal plan', 'What you’re cooking this week — private by default'],
];

export function Settings() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { scheme, setScheme } = useColorScheme();
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
  const [revealedCodes, setRevealedCodes] = useState<string[] | null>(null);

  const [exporting, setExporting] = useState(false);

  async function exportData() {
    setExporting(true);
    try {
      const data = await api.get('/account/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cookbook-data-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  const [goalCalories, setGoalCalories] = useState('');
  const [goalProtein, setGoalProtein] = useState('');
  const [goalCarbs, setGoalCarbs] = useState('');
  const [goalFat, setGoalFat] = useState('');

  const { data: sessions = [] } = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api.get<Session[]>('/auth/sessions'),
  });

  const { data: loginHistory = [] } = useQuery({
    queryKey: ['login-history'],
    queryFn: () => api.get<LoginHistoryRow[]>('/auth/login-history'),
  });

  const { data: blockedUsers = [] } = useQuery({
    queryKey: ['chefs-blocked'],
    queryFn: () => api.get<BlockedUser[]>('/chefs/blocked'),
  });

  const { data: notificationPrefs = [] } = useQuery({
    queryKey: ['notification-prefs'],
    queryFn: () => api.get<NotificationPref[]>('/settings/notification-prefs'),
  });

  useEffect(() => {
    if (settings) {
      setDisplayName(settings.display_name);
      setEmail(settings.email);
      setDiet(settings.diet_prefs);
      setGoalCalories(settings.goal_calories?.toString() ?? '');
      setGoalProtein(settings.goal_protein_g?.toString() ?? '');
      setGoalCarbs(settings.goal_carbs_g?.toString() ?? '');
      setGoalFat(settings.goal_fat_g?.toString() ?? '');
    }
  }, [settings]);

  const saveGoals = useMutation({
    mutationFn: () =>
      api.post('/profile', {
        // An empty field means "clear this goal" - sent as 0, the sentinel
        // the backend maps to NULL, since a bare omitted/null field there
        // means "leave it as it was," not "clear it."
        goal_calories: goalCalories.trim() ? Number(goalCalories) : 0,
        goal_protein_g: goalProtein.trim() ? Number(goalProtein) : 0,
        goal_carbs_g: goalCarbs.trim() ? Number(goalCarbs) : 0,
        goal_fat_g: goalFat.trim() ? Number(goalFat) : 0,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });

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

  const toggleTwoFactor = useMutation({
    mutationFn: (enabled: boolean) =>
      api.post<{ recovery_codes?: string[] }>(`/auth/2fa/${enabled ? 'enable' : 'disable'}`),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      if (res.recovery_codes) setRevealedCodes(res.recovery_codes);
    },
  });

  const regenerateRecovery = useMutation({
    mutationFn: () => api.post<{ recovery_codes: string[] }>('/auth/2fa/recovery-codes/regenerate'),
    onSuccess: (res) => setRevealedCodes(res.recovery_codes),
  });

  const toggleNotifPref = useMutation({
    mutationFn: ({ type, enabled }: { type: string; enabled: boolean }) =>
      api.put(`/settings/notification-prefs/${type}`, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notification-prefs'] }),
  });

  const setVisibility = useMutation({
    mutationFn: (patch: Record<string, string>) => api.post('/profile', patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });

  const setUnitSystem = useMutation({
    mutationFn: (unit_system: string) => api.post('/profile', { unit_system }),
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

  const unblock = useMutation({
    mutationFn: (id: number) => api.post<{ blocked: boolean }>(`/chefs/${id}/block`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['chefs-blocked'] }),
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
        <div className={styles.sectionTitle}>Appearance</div>
        <div className={styles.visRow}>
          <div>
            <div className={styles.visLabel}>Theme</div>
            <div className={styles.visSub}>
              {scheme === 'system' ? "Matches your device's setting." : `Always ${scheme}.`}
            </div>
          </div>
          <div className={styles.visToggle}>
            {APPEARANCE_OPTIONS.map(([value, label]) => (
              <button
                key={value}
                className={scheme === value ? styles.visActive : ''}
                onClick={() => setScheme(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {user.is_admin && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Moderation</div>
          <button className={styles.saveBtn} onClick={() => navigate('/admin')}>
            Open moderation queue
          </button>
        </div>
      )}

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
          <PasswordStrength password={newPassword} />
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

      {blockedUsers.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Blocked accounts</div>
          <div className={styles.sessionList}>
            {blockedUsers.map((b) => (
              <div key={b.id} className={styles.sessionRow}>
                <button
                  className={styles.visLabel}
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}
                  onClick={() => navigate(`/chefs/${b.id}`)}
                >
                  {b.display_name}
                </button>
                <button
                  className={styles.sessionRevoke}
                  onClick={() => unblock.mutate(b.id)}
                  disabled={unblock.isPending}
                >
                  Unblock
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {settings && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Two-factor authentication</div>
          <div className={styles.visRow}>
            <div>
              <div className={styles.visLabel}>Email code at sign-in</div>
              <div className={styles.visSub}>
                {settings.two_factor_enabled
                  ? "We'll email a 6-digit code every time you sign in."
                  : 'Add a second step at sign-in beyond just your password.'}
              </div>
            </div>
            <button
              className={`${styles.twoFactorToggle} ${settings.two_factor_enabled ? styles.twoFactorToggleOn : ''}`}
              disabled={toggleTwoFactor.isPending}
              onClick={() => toggleTwoFactor.mutate(!settings.two_factor_enabled)}
            >
              {settings.two_factor_enabled ? 'On' : 'Off'}
            </button>
          </div>
          {settings.two_factor_enabled && (
            <div className={styles.visRow}>
              <div>
                <div className={styles.visLabel}>Recovery codes</div>
                <div className={styles.visSub}>
                  For when you can't receive the emailed code. Regenerating replaces your
                  existing codes - old ones stop working.
                </div>
              </div>
              <button
                className={styles.sessionRevoke}
                disabled={regenerateRecovery.isPending}
                onClick={() => regenerateRecovery.mutate()}
              >
                Regenerate
              </button>
            </div>
          )}
        </div>
      )}

      {revealedCodes && (
        <RecoveryCodes codes={revealedCodes} onClose={() => setRevealedCodes(null)} />
      )}

      {loginHistory.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Recent sign-in activity</div>
          <p className={styles.securityHint}>
            Every sign-in attempt on this account, successful or not - if something here doesn't
            look like you, change your password above and sign out of other sessions.
          </p>
          <div className={styles.sessionList}>
            {loginHistory.map((h) => (
              <div key={h.id} className={styles.sessionRow}>
                <div>
                  <div className={styles.visLabel}>
                    {h.device}
                    {!h.success && <span className={styles.failedBadge}>Failed</span>}
                  </div>
                  <div className={styles.visSub}>
                    {relativeTime(h.attempted_at)}
                    {h.ip ? ` · ${h.ip}` : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {notificationPrefs.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Email notifications</div>
          <p className={styles.securityHint}>
            Everything still shows up in your Activity tab either way - this just controls what
            also gets emailed to you.
          </p>
          {notificationPrefs.map((p) => (
            <div key={p.type} className={styles.visRow}>
              <div>
                <div className={styles.visLabel}>{p.label}</div>
                <div className={styles.visSub}>{p.description}</div>
              </div>
              <button
                className={`${styles.twoFactorToggle} ${p.email_enabled ? styles.twoFactorToggleOn : ''}`}
                disabled={toggleNotifPref.isPending}
                onClick={() => toggleNotifPref.mutate({ type: p.type, enabled: !p.email_enabled })}
              >
                {p.email_enabled ? 'On' : 'Off'}
              </button>
            </div>
          ))}
        </div>
      )}

      {settings && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Measurement units</div>
          <div className={styles.visRow}>
            <div>
              <div className={styles.visLabel}>Grocery list totals</div>
              <div className={styles.visSub}>
                {settings.unit_system === 'as_written'
                  ? 'Shown in whichever unit each recipe used most.'
                  : `Always converted to ${settings.unit_system}.`}
              </div>
            </div>
            <div className={styles.visToggle}>
              {UNIT_SYSTEMS.map(([value, label]) => (
                <button
                  key={value}
                  className={settings.unit_system === value ? styles.visActive : ''}
                  onClick={() => setUnitSystem.mutate(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Daily nutrition goals</div>
        <p className={styles.securityHint}>
          Optional — set any of these to see a "Today" progress view on your feed, based on
          what you've marked cooked. Leave a field blank to turn that goal off.
        </p>
        <div className={styles.goalGrid}>
          <div className={styles.field}>
            <label className={styles.label}>Calories</label>
            <input
              className={styles.input}
              type="number"
              min={0}
              value={goalCalories}
              onChange={(e) => setGoalCalories(e.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Protein (g)</label>
            <input
              className={styles.input}
              type="number"
              min={0}
              value={goalProtein}
              onChange={(e) => setGoalProtein(e.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Carbs (g)</label>
            <input
              className={styles.input}
              type="number"
              min={0}
              value={goalCarbs}
              onChange={(e) => setGoalCarbs(e.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Fat (g)</label>
            <input
              className={styles.input}
              type="number"
              min={0}
              value={goalFat}
              onChange={(e) => setGoalFat(e.target.value)}
            />
          </div>
        </div>
        <button className={styles.saveBtn} onClick={() => saveGoals.mutate()} disabled={saveGoals.isPending}>
          Save
        </button>
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

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Your data</div>
        <p className={styles.securityHint}>
          Download everything you've published, reviewed, rated, and saved as a JSON file.
        </p>
        <button className={styles.saveBtn} onClick={() => exportData()} disabled={exporting}>
          {exporting ? 'Preparing…' : 'Export my data'}
        </button>
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
