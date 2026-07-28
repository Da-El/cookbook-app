import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { FlagRow } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast/ToastContext';
import { LoadingState, ErrorState } from '../components/PageState/PageState';
import { EmptyLine } from '../components/Empty/Empty';
import { ChevronLeft } from '../components/Icon/Icon';
import styles from './Admin.module.css';

const TYPE_LABEL: Record<FlagRow['content_type'], string> = {
  meal_revision: 'Recipe edit',
  review: 'Review',
  ingredient_edit: 'Ingredient edit',
  alias: 'Alias',
  substitute: 'Substitute',
  guide_edit: 'Guide edit',
};

function relativeTime(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

/**
 * The other end of every "⚑ Flag" button in the app: one queue, oldest
 * first, where a report and its content sit side by side so a decision
 * doesn't need a second tab. Admin-only - the backend enforces that too,
 * this is just so a non-admin never sees a 403 flash before redirecting.
 */
export function Admin() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();

  const { data: flags, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-flags'],
    queryFn: () => api.get<FlagRow[]>('/admin/flags'),
    enabled: Boolean(user?.is_admin),
  });

  const resolve = useMutation({
    mutationFn: ({ id, resolution }: { id: number; resolution: 'removed' | 'dismissed' }) =>
      api.post(`/admin/flags/${id}/resolve`, { resolution }),
    onSuccess: (_data, v) => {
      toast(v.resolution === 'removed' ? 'Removed and flag closed.' : 'Flag dismissed.');
      qc.invalidateQueries({ queryKey: ['admin-flags'] });
    },
  });

  if (!user?.is_admin) {
    return (
      <div className={styles.page}>
        <ErrorState
          title="Admins only"
          text="This page is for site moderators."
          actionLabel="Go back"
          onAction={() => navigate('/')}
        />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate(-1)} aria-label="Back">
          <ChevronLeft size={18} strokeWidth={2.2} />
        </button>
        <div>
          <h1 className={styles.title}>Moderation queue</h1>
          <p className={styles.subtitle}>
            {flags ? `${flags.length} flag${flags.length === 1 ? '' : 's'} waiting` : 'Flagged content, oldest first'}
          </p>
        </div>
      </div>

      {isLoading && <LoadingState label="Loading the queue…" />}

      {isError && (
        <ErrorState
          title="Couldn't load the queue"
          text="Something went wrong fetching flags."
          actionLabel="Try again"
          onAction={() => refetch()}
        />
      )}

      {flags && flags.length === 0 && (
        <div style={{ marginTop: 20 }}>
          <EmptyLine roomy>Nothing needs a look right now.</EmptyLine>
        </div>
      )}

      {flags && flags.length > 0 && (
        <div className={styles.list}>
          {flags.map((f) => (
            <div key={f.id} className={styles.row}>
              <div className={styles.rowHead}>
                <span className={styles.typePill}>{TYPE_LABEL[f.content_type]}</span>
                <span className={styles.time}>{relativeTime(f.created_at)}</span>
              </div>

              <div className={styles.reason}>&ldquo;{f.reason}&rdquo;</div>
              <div className={styles.byline}>flagged by {f.flagged_by_name ?? 'a former user'}</div>

              <div className={styles.contentPreview}>
                {f.still_exists ? (
                  <>
                    <span className={styles.summary}>{f.summary}</span>
                    {f.link && (
                      <Link to={f.link} className={styles.viewLink} target="_blank" rel="noreferrer">
                        View →
                      </Link>
                    )}
                  </>
                ) : (
                  <span className={styles.gone}>{f.summary}</span>
                )}
              </div>

              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.removeBtn}
                  disabled={resolve.isPending || !f.still_exists}
                  title={!f.still_exists ? 'Already gone - nothing to remove' : undefined}
                  onClick={() => resolve.mutate({ id: f.id, resolution: 'removed' })}
                >
                  Remove
                </button>
                <button
                  type="button"
                  className={styles.dismissBtn}
                  disabled={resolve.isPending}
                  onClick={() => resolve.mutate({ id: f.id, resolution: 'dismissed' })}
                >
                  Dismiss
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
