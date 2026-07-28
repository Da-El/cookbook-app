import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast/ToastContext';
import { MealCard, MealGrid } from '../components/MealCard/MealCard';
import { LoadingState, ErrorState } from '../components/PageState/PageState';
import { EmptyLine } from '../components/Empty/Empty';
import { ChevronLeft, CameraIcon } from '../components/Icon/Icon';
import { pickImage } from '../lib/photo';
import styles from './CollectionDetail.module.css';

interface CollectionMeal {
  id: number;
  name: string;
  cuisine: string;
  time_minutes: number;
  rating: number;
  photo_url: string | null;
}

interface CollectionComment {
  id: number;
  user_id: number | null;
  author_name: string;
  body: string;
  created_at: string;
}

function relativeTime(iso: string) {
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days < 1) return 'today';
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
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
  cover_photo_url: string | null;
}

export function CollectionDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();
  const [comment, setComment] = useState('');

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['collection', id],
    queryFn: () => api.get<CollectionDetailData>(`/collections/${id}`),
    enabled: Boolean(id),
    retry: (failureCount, err) => (err instanceof ApiError ? false : failureCount < 2),
  });

  const { data: comments = [] } = useQuery({
    queryKey: ['collection-comments', id],
    queryFn: () => api.get<CollectionComment[]>(`/collections/${id}/comments`),
    enabled: Boolean(id) && Boolean(data),
  });

  const postComment = useMutation({
    mutationFn: () => api.post(`/collections/${id}/comments`, { body: comment.trim() }),
    onSuccess: () => {
      setComment('');
      qc.invalidateQueries({ queryKey: ['collection-comments', id] });
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not post that comment.'),
  });

  const deleteComment = useMutation({
    mutationFn: (commentId: number) => api.del(`/collections/${id}/comments/${commentId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['collection-comments', id] }),
  });

  const removeMeal = useMutation({
    mutationFn: (mealId: number) => api.del(`/collections/${id}/meals/${mealId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['collection', id] }),
  });

  const moveMeal = useMutation({
    mutationFn: ({ mealId, direction }: { mealId: number; direction: 'up' | 'down' }) =>
      api.post(`/collections/${id}/meals/${mealId}/move`, { direction }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['collection', id] }),
  });

  const setVisibility = useMutation({
    mutationFn: (isPublic: boolean) => api.post(`/collections/${id}/visibility`, { is_public: isPublic }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['collection', id] }),
  });

  const setCover = useMutation({
    mutationFn: (photo_url: string | null) => api.post(`/collections/${id}/cover`, { photo_url }),
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
      {data?.cover_photo_url && (
        <div className={styles.coverBanner} style={{ backgroundImage: `url(${data.cover_photo_url})` }}>
          {data.is_mine && (
            <button
              className={styles.coverEditBtn}
              onClick={() => pickImage((url) => setCover.mutate(url))}
              title="Change cover photo"
            >
              <CameraIcon size={15} strokeWidth={1.8} /> Change cover
            </button>
          )}
        </div>
      )}

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
          {!data.cover_photo_url && (
            <button
              className={styles.copyLinkBtn}
              onClick={() => pickImage((url) => setCover.mutate(url))}
            >
              <CameraIcon size={13} strokeWidth={1.8} /> Add cover photo
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
          {data.meals.map((m, i) => (
            <div key={m.id} className={styles.cardWrap}>
              <MealCard meal={m} />
              {data.is_mine && (
                <>
                  <div className={styles.reorderOverlay}>
                    <button
                      className={styles.reorderBtn}
                      disabled={i === 0 || moveMeal.isPending}
                      onClick={(e) => {
                        e.stopPropagation();
                        moveMeal.mutate({ mealId: m.id, direction: 'up' });
                      }}
                      aria-label={`Move ${m.name} earlier in this collection`}
                    >
                      ▲
                    </button>
                    <button
                      className={styles.reorderBtn}
                      disabled={i === data.meals.length - 1 || moveMeal.isPending}
                      onClick={(e) => {
                        e.stopPropagation();
                        moveMeal.mutate({ mealId: m.id, direction: 'down' });
                      }}
                      aria-label={`Move ${m.name} later in this collection`}
                    >
                      ▼
                    </button>
                  </div>
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
                </>
              )}
            </div>
          ))}
        </MealGrid>
      )}

      {data && (
        <section className={styles.section}>
          <h2 className={styles.sectionTopic}>Discussion</h2>
          {user && (
            <div className={styles.editForm}>
              <textarea
                className={styles.editTextarea}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Say something about this collection…"
                rows={3}
                maxLength={1000}
              />
              <button
                className={styles.editSubmit}
                disabled={!comment.trim() || postComment.isPending}
                onClick={() => postComment.mutate()}
              >
                Post
              </button>
            </div>
          )}
          {comments.length === 0 ? (
            <p className={styles.cardSummary}>No comments yet — be the first to say something.</p>
          ) : (
            <div className={styles.editList}>
              {comments.map((c) => (
                <div key={c.id} className={styles.editRow}>
                  <span className={styles.editRowMeta}>
                    {c.author_name} · {relativeTime(c.created_at)}
                  </span>
                  <p className={styles.editRowBody}>{c.body}</p>
                  {user && c.user_id === user.id && (
                    <div className={styles.editRowActions}>
                      <button className={styles.editDeleteBtn} onClick={() => deleteComment.mutate(c.id)}>
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
