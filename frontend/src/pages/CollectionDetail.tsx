import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { useToast } from '../components/Toast/ToastContext';
import { MealCard, MealGrid } from '../components/MealCard/MealCard';
import { LoadingState, ErrorState } from '../components/PageState/PageState';
import { EmptyLine } from '../components/Empty/Empty';
import { ChevronLeft } from '../components/Icon/Icon';
import styles from './CollectionDetail.module.css';

interface CollectionMeal {
  id: number;
  name: string;
  cuisine: string;
  time_minutes: number;
  rating: number;
  photo_url: string | null;
}

interface CollectionDetailData {
  id: number;
  name: string;
  meals: CollectionMeal[];
  is_public: boolean;
  is_mine: boolean;
  owner_name: string;
  follower_count: number;
  is_following: boolean;
}

export function CollectionDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['collection', id],
    queryFn: () => api.get<CollectionDetailData>(`/collections/${id}`),
    enabled: Boolean(id),
    retry: (failureCount, err) => (err instanceof ApiError ? false : failureCount < 2),
  });

  const removeMeal = useMutation({
    mutationFn: (mealId: number) => api.del(`/collections/${id}/meals/${mealId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['collection', id] }),
  });

  const setVisibility = useMutation({
    mutationFn: (isPublic: boolean) => api.post(`/collections/${id}/visibility`, { is_public: isPublic }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['collection', id] }),
  });

  const follow = useMutation({
    mutationFn: () => api.post<{ following: boolean }>(`/collections/${id}/follow`),
    onSuccess: (res) => {
      toast(res.following ? 'Following this collection' : 'Unfollowed');
      qc.invalidateQueries({ queryKey: ['collection', id] });
      qc.invalidateQueries({ queryKey: ['collections-followed'] });
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not update that.'),
  });

  function copyLink() {
    navigator.clipboard.writeText(`${location.origin}/collections/${id}`);
    toast('Link copied');
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate(-1)} aria-label="Back">
          <ChevronLeft size={18} strokeWidth={2.2} />
        </button>
        <div>
          <h1 className={styles.title}>{data?.name ?? 'Collection'}</h1>
          {data && (
            <p className={styles.subtitle}>
              {data.meals.length} meal{data.meals.length === 1 ? '' : 's'}
              {!data.is_mine && ` · by ${data.owner_name}`}
              {data.follower_count > 0 &&
                ` · ${data.follower_count} follower${data.follower_count === 1 ? '' : 's'}`}
            </p>
          )}
        </div>
      </div>

      {data && !data.is_mine && (
        <button
          className={`${styles.followBtn} ${data.is_following ? styles.followBtnOn : ''}`}
          disabled={follow.isPending}
          onClick={() => follow.mutate()}
        >
          {data.is_following ? 'Following' : 'Follow this collection'}
        </button>
      )}

      {data?.is_mine && (
        <div className={styles.visibilityRow}>
          <button
            className={styles.visibilityBtn}
            disabled={setVisibility.isPending}
            onClick={() => setVisibility.mutate(!data.is_public)}
          >
            {data.is_public
              ? '🌐 Public — any signed-in Cookbook user with the link can view'
              : '🔒 Private — only you can see this'}
          </button>
          {data.is_public && (
            <button className={styles.copyLinkBtn} onClick={copyLink}>
              Copy link
            </button>
          )}
        </div>
      )}

      {isLoading && <LoadingState label="Loading collection…" />}

      {isError && (
        <ErrorState
          title="Couldn't load this collection"
          text="It may have been deleted, or something went wrong."
          actionLabel="Try again"
          onAction={() => refetch()}
        />
      )}

      {data && data.meals.length === 0 && (
        <div style={{ marginTop: 20 }}>
          <EmptyLine roomy>
            Nothing here yet — add a meal from its page with "Add to collection."
          </EmptyLine>
        </div>
      )}

      {data && data.meals.length > 0 && (
        <MealGrid>
          {data.meals.map((m) => (
            <div key={m.id} className={styles.cardWrap}>
              <MealCard meal={m} />
              {data.is_mine && (
                <button
                  className={styles.removeBtn}
                  title="Remove from this collection"
                  aria-label="Remove from this collection"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeMeal.mutate(m.id);
                  }}
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </MealGrid>
      )}
    </div>
  );
}
