import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast/ToastContext';
import { ChevronLeft } from '../components/Icon/Icon';
import { EmptyLine } from '../components/Empty/Empty';
import styles from './MealHistory.module.css';

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

  const { data: history, isLoading } = useQuery({
    queryKey: ['meal-revisions', id],
    queryFn: () => api.get<RevisionHistory>(`/meals/${id}/revisions`),
    enabled: Boolean(id),
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
          {history.revisions.map((r) => (
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
                )}
              </div>

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
          ))}
        </div>
      )}
    </div>
  );
}
