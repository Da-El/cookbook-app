import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast/ToastContext';
import { ChefList, ChefRow, type Chef } from '../components/ChefRow/ChefRow';
import { LoadingState, ErrorState } from '../components/PageState/PageState';
import { EmptyLine } from '../components/Empty/Empty';
import { ChevronLeft } from '../components/Icon/Icon';
import styles from './Leaderboard.module.css';

type Kind = 'followers' | 'following';

/** Followers and Following are the same list shape with a different query
 * and a different empty-state line, so one component covers both routes
 * rather than duplicating the fetch/render/mutate wiring twice. */
export function ChefConnections({ kind }: { kind: Kind }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { user: viewer } = useAuth();

  const { data: chef } = useQuery({
    queryKey: ['chef', id],
    queryFn: () => api.get<{ display_name: string }>(`/chefs/${id}`),
    enabled: Boolean(id),
  });

  const { data: rows, isLoading, isError, refetch } = useQuery({
    queryKey: [`chef-${kind}-list`, id],
    queryFn: () => api.get<Chef[]>(`/chefs/${id}/${kind}`),
    enabled: Boolean(id),
  });

  const follow = useMutation({
    mutationFn: (c: Chef) => api.post<{ following: boolean }>(`/chefs/${c.id}/follow`),
    onSuccess: (res, c) => {
      toast(res.following ? `Following ${c.display_name}` : `Unfollowed ${c.display_name}`);
      qc.invalidateQueries({ queryKey: [`chef-${kind}-list`, id] });
      qc.invalidateQueries({ queryKey: ['chef', id] });
      qc.invalidateQueries({ queryKey: ['chefs-suggested'] });
      qc.invalidateQueries({ queryKey: ['chefs-following'] });
      qc.invalidateQueries({ queryKey: ['feed'] });
    },
    onError: () => toast("Couldn't update that follow."),
  });

  const title = kind === 'followers' ? 'Followers' : 'Following';
  const name = chef?.display_name ?? 'This chef';
  const emptyText =
    kind === 'followers' ? `${name} doesn't have any followers yet.` : `${name} isn't following anyone yet.`;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate(-1)} aria-label="Back">
          <ChevronLeft size={18} strokeWidth={2.2} />
        </button>
        <div>
          <h1 className={styles.title}>{title}</h1>
          {chef && <p className={styles.subtitle}>{chef.display_name}</p>}
        </div>
      </div>

      {isLoading && <LoadingState label="Loading…" />}

      {isError && (
        <ErrorState
          title="Couldn't load this list"
          text="Something went wrong."
          actionLabel="Try again"
          onAction={() => refetch()}
        />
      )}

      {rows && rows.length === 0 && (
        <div style={{ marginTop: 20 }}>
          <EmptyLine roomy>{emptyText}</EmptyLine>
        </div>
      )}

      {rows && rows.length > 0 && (
        <ChefList>
          {rows.map((c) => (
            <ChefRow
              key={c.id}
              chef={c}
              onToggleFollow={(x) => follow.mutate(x)}
              isViewer={c.id === viewer?.id}
            />
          ))}
        </ChefList>
      )}
    </div>
  );
}
