import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast/ToastContext';
import { ChevronLeft } from '../components/Icon/Icon';
import { EmptyLine } from '../components/Empty/Empty';
import { FlagButton } from '../components/Flag/FlagButton';
import { ContributorBadge, type ContributorTier } from '../components/ContributorBadge/ContributorBadge';
import styles from './MealHistory.module.css';

interface SnapshotIngredient {
  ingredient_id: number | null;
  raw_name: string;
  amount: number | null;
  unit: string | null;
  note: string | null;
  position: number;
}

interface Snapshot {
  name: string;
  cuisine: string;
  meal_type: string;
  time_minutes: number;
  serves: string | null;
  description: string;
  steps: string[];
  photo_url: string | null;
  visibility: string;
  source_url: string | null;
  source_name: string | null;
  ingredients: SnapshotIngredient[];
}

interface CurrentMealShape {
  name: string;
  cuisine: string;
  meal_type: string;
  time_minutes: number;
  serves: string | null;
  description: string;
  steps: string[];
  photo_url: string | null;
  visibility: string;
  source_url?: string | null;
  source_name?: string | null;
  ingredients: { ingredient_id: number | null; name: string; amount: number | null; unit: string | null }[];
}

/** Adapts a live `/meals/:id` response into the same shape a revision's
 * `snapshot` uses, so the two can go through the same diff function - the
 * live meal is effectively "the state after the most recent edit," which
 * has no revision row of its own to hold it. */
function asSnapshot(m: CurrentMealShape): Snapshot {
  return {
    name: m.name, cuisine: m.cuisine, meal_type: m.meal_type, time_minutes: m.time_minutes,
    serves: m.serves, description: m.description, steps: m.steps, photo_url: m.photo_url,
    visibility: m.visibility, source_url: m.source_url ?? null, source_name: m.source_name ?? null,
    ingredients: m.ingredients.map((i, position) => ({
      ingredient_id: i.ingredient_id, raw_name: i.name, amount: i.amount, unit: i.unit, note: null, position,
    })),
  };
}

interface Revision {
  id: number;
  editor_name: string | null;
  /// NULL for a former user whose account was deleted - the byline falls
  /// back to plain text in that case since there's nothing left to link to.
  editor_id: number | null;
  summary: string;
  kind: 'created' | 'edit' | 'revert' | 'deleted' | 'restored';
  created_at: string;
  score: number;
  vote_count: number;
  your_vote: number | null;
  editor_tier: ContributorTier | null;
  snapshot: Snapshot;
}

const SCALAR_FIELDS: [keyof Snapshot, string][] = [
  ['name', 'Name'],
  ['cuisine', 'Cuisine'],
  ['meal_type', 'Meal type'],
  ['time_minutes', 'Time'],
  ['serves', 'Servings'],
  ['description', 'Description'],
  ['source_url', 'Source link'],
  ['source_name', 'Source name'],
];

function truncate(v: unknown, n = 60): string {
  const s = v == null || v === '' ? '(empty)' : String(v);
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/** A readable, field-by-field summary of what changed between two
 * snapshots - not a text diff. Recipe data is structured (steps,
 * ingredients, named fields), and a line-by-line text diff of two JSON
 * blobs would read like noise next to "added 2 ingredients, removed a
 * step." */
function diffSnapshots(before: Snapshot, after: Snapshot): string[] {
  const lines: string[] = [];

  for (const [key, label] of SCALAR_FIELDS) {
    if (before[key] !== after[key]) {
      lines.push(`${label}: ${truncate(before[key])} → ${truncate(after[key])}`);
    }
  }

  if (JSON.stringify(before.steps) !== JSON.stringify(after.steps)) {
    lines.push(`Steps: ${before.steps.length} → ${after.steps.length}`);
  }

  const key = (i: SnapshotIngredient) => (i.ingredient_id != null ? `id:${i.ingredient_id}` : `n:${i.raw_name.toLowerCase()}`);
  const beforeMap = new Map(before.ingredients.map((i) => [key(i), i]));
  const afterMap = new Map(after.ingredients.map((i) => [key(i), i]));

  const added = [...afterMap.entries()].filter(([k]) => !beforeMap.has(k));
  const removed = [...beforeMap.entries()].filter(([k]) => !afterMap.has(k));
  const changed = [...afterMap.entries()].filter(([k, a]) => {
    const b = beforeMap.get(k);
    return b && (b.amount !== a.amount || b.unit !== a.unit || b.raw_name !== a.raw_name || b.note !== a.note);
  });

  if (added.length > 0) lines.push(`Added: ${added.map(([, i]) => i.raw_name).join(', ')}`);
  if (removed.length > 0) lines.push(`Removed: ${removed.map(([, i]) => i.raw_name).join(', ')}`);
  if (changed.length > 0) lines.push(`Changed: ${changed.map(([, i]) => i.raw_name).join(', ')}`);

  if (before.photo_url !== after.photo_url) lines.push('Photo changed');
  if (before.visibility !== after.visibility) lines.push(`Visibility: ${before.visibility} → ${after.visibility}`);

  return lines;
}

interface RevisionHistory {
  meal_name: string;
  author_id: number;
  is_live: boolean;
  revisions: Revision[];
}

const KIND_LABEL: Record<Revision['kind'], string> = {
  created: 'Created',
  edit: 'Edited',
  revert: 'Reverted',
  deleted: 'Deleted',
  restored: 'Restored',
};

function relativeTime(iso: string) {
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days < 1) return 'today';
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

export function MealHistory() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();

  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  function toggleExpanded(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const { data: history, isLoading } = useQuery({
    queryKey: ['meal-revisions', id],
    queryFn: () => api.get<RevisionHistory>(`/meals/${id}/revisions`),
    enabled: Boolean(id),
  });

  // Only needed to diff the newest revision against - "what changed since
  // the most recent edit" has no revision row of its own to hold the after
  // state, since a row only ever records what came *before* an edit.
  const { data: currentMeal } = useQuery({
    queryKey: ['meal-history-current', id],
    queryFn: () => api.get<CurrentMealShape>(`/meals/${id}`),
    enabled: Boolean(id) && Boolean(history?.is_live),
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['meal-revisions', id] });
    qc.invalidateQueries({ queryKey: ['meal', id] });
    qc.invalidateQueries({ queryKey: ['meal-edit', id] });
    qc.invalidateQueries({ queryKey: ['meals'] });
    qc.invalidateQueries({ queryKey: ['cookbook'] });
    qc.invalidateQueries({ queryKey: ['cookbook-counts'] });
  };

  const vote = useMutation({
    mutationFn: (v: { revId: number; value: 1 | -1 }) =>
      api.post(`/meals/${id}/revisions/${v.revId}/vote`, { value: v.value }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meal-revisions', id] }),
  });

  const revert = useMutation({
    mutationFn: (revId: number) => api.post(`/meals/${id}/revisions/${revId}/revert`),
    onSuccess: () => {
      toast('Reverted to that version');
      invalidateAll();
    },
  });

  const restore = useMutation({
    mutationFn: () => api.post(`/meals/${id}/restore`),
    onSuccess: () => {
      toast('Meal restored');
      invalidateAll();
    },
  });

  const isAuthor = history && user && history.author_id === user.id;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate(-1)} aria-label="Back">
          <ChevronLeft size={18} strokeWidth={2.2} />
        </button>
        <div>
          <h1 className={styles.title}>Edit history</h1>
          {history && <p className={styles.subtitle}>{history.meal_name}</p>}
        </div>
      </div>

      <p className={styles.lede}>
        Every change to this recipe, kept — nothing is ever erased. Vote on whether an edit made
        it better or worse; that's separate from rating the dish itself.
      </p>

      {history && !history.is_live && (
        <div className={styles.deletedBanner}>
          <div className={styles.deletedBannerText}>
            This meal is deleted. It's hidden everywhere but still here — nothing was thrown away.
          </div>
          {isAuthor && (
            <button
              className={styles.restoreBtn}
              disabled={restore.isPending}
              onClick={() => restore.mutate()}
            >
              {restore.isPending ? 'Restoring…' : 'Restore this meal'}
            </button>
          )}
        </div>
      )}

      {isLoading ? null : !history || history.revisions.length === 0 ? (
        <div style={{ marginTop: 20 }}>
          <EmptyLine roomy>No edits yet — this is still the original version.</EmptyLine>
        </div>
      ) : (
        <div className={styles.list}>
          {history.revisions.map((r, i) => {
            // r.snapshot is the state right *before* r's own edit; the
            // state right after it is either the next-newer revision's
            // snapshot, or - for the newest row - the live meal itself.
            const after: Snapshot | null = i > 0 ? history.revisions[i - 1].snapshot : currentMeal ? asSnapshot(currentMeal) : null;
            const diff = after ? diffSnapshots(r.snapshot, after) : [];
            const canDiff = after !== null;
            return (
            <div key={r.id} className={styles.row}>
              <div className={styles.rowHead}>
                <span className={`${styles.kindPill} ${styles[`kind_${r.kind}`] ?? ''}`}>
                  {KIND_LABEL[r.kind]}
                </span>
                <span className={styles.time}>{relativeTime(r.created_at)}</span>
              </div>
              <div className={styles.summary}>{r.summary}</div>
              <div className={styles.byline}>
                by{' '}
                {r.editor_id ? (
                  <Link to={`/chefs/${r.editor_id}`} className={styles.editorLink}>
                    {r.editor_name ?? 'a chef'}
                  </Link>
                ) : (
                  r.editor_name ?? 'a former user'
                )}{' '}
                <ContributorBadge tier={r.editor_tier} />
              </div>

              {canDiff && (
                <>
                  <button className={styles.diffToggle} onClick={() => toggleExpanded(r.id)}>
                    {expanded.has(r.id) ? 'Hide changes' : 'View changes'}
                  </button>
                  {expanded.has(r.id) && (
                    <ul className={styles.diffList}>
                      {diff.length === 0 ? (
                        <li className={styles.diffLine}>No tracked fields changed.</li>
                      ) : (
                        diff.map((line, j) => (
                          <li key={j} className={styles.diffLine}>
                            {line}
                          </li>
                        ))
                      )}
                    </ul>
                  )}
                </>
              )}

              <div className={styles.voteRow}>
                <button
                  className={`${styles.voteBtn} ${r.your_vote === 1 ? styles.voteBtnUp : ''}`}
                  onClick={() => vote.mutate({ revId: r.id, value: 1 })}
                  title="This change improved the recipe"
                  aria-label="This change improved the recipe"
                  aria-pressed={r.your_vote === 1}
                >
                  ▲
                </button>
                <span className={styles.score} aria-label={`Score: ${r.score}`}>{r.score}</span>
                <button
                  className={`${styles.voteBtn} ${r.your_vote === -1 ? styles.voteBtnDown : ''}`}
                  onClick={() => vote.mutate({ revId: r.id, value: -1 })}
                  title="This change made it worse"
                  aria-label="This change made it worse"
                  aria-pressed={r.your_vote === -1}
                >
                  ▼
                </button>
                <span className={styles.voteCount}>
                  {r.vote_count} vote{r.vote_count === 1 ? '' : 's'}
                </span>

                {(!user || r.editor_id !== user.id) && <FlagButton contentType="meal_revision" contentId={r.id} />}

                {isAuthor && history!.is_live && r.kind !== 'deleted' && r.kind !== 'restored' && (
                  <button
                    className={styles.revertBtn}
                    disabled={revert.isPending}
                    onClick={() => {
                      if (confirm('Restore the recipe to how it looked right before this change?')) {
                        revert.mutate(r.id);
                      }
                    }}
                  >
                    Revert to before this
                  </button>
                )}
              </div>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
