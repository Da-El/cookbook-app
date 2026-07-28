import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../Toast/ToastContext';
import styles from './ReviewReplies.module.css';

interface ReviewReply {
  id: number;
  review_id: number;
  user_id: number | null;
  author_name: string | null;
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

/**
 * One level of reply under a review - not its own comment section, just
 * enough for "this happened to me too" or "try it with less salt" to have
 * somewhere to go besides a brand new review. Lives right under the review
 * it belongs to on the meal page.
 */
export function ReviewReplies({
  mealId,
  reviewId,
  replies,
}: {
  mealId: number;
  reviewId: number;
  replies: ReviewReply[];
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');

  const invalidate = () => qc.invalidateQueries({ queryKey: ['meal-reviews', String(mealId)] });

  const submit = useMutation({
    mutationFn: () => api.post(`/meals/${mealId}/reviews/${reviewId}/replies`, { body: text.trim() }),
    onSuccess: () => {
      setText('');
      setOpen(false);
      invalidate();
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not post that reply.'),
  });

  const remove = useMutation({
    mutationFn: (replyId: number) => api.del(`/meals/${mealId}/reviews/${reviewId}/replies/${replyId}`),
    onSuccess: invalidate,
  });

  return (
    <div className={styles.wrap}>
      {replies.length > 0 && (
        <div className={styles.list}>
          {replies.map((r) => (
            <div key={r.id} className={styles.row}>
              <span className={styles.body}>
                {r.user_id ? (
                  <Link to={`/chefs/${r.user_id}`} className={styles.author}>
                    {r.author_name ?? 'a chef'}
                  </Link>
                ) : (
                  <span className={styles.author}>{r.author_name ?? 'a former user'}</span>
                )}
                <span className={styles.text}>{r.body}</span>
                <span className={styles.time}>{relativeTime(r.created_at)}</span>
              </span>
              {user && r.user_id === user.id && (
                <button
                  className={styles.deleteBtn}
                  title="Delete your reply"
                  aria-label="Delete your reply"
                  onClick={() => remove.mutate(r.id)}
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {user && !open && (
        <button className={styles.replyTrigger} onClick={() => setOpen(true)}>
          Reply
        </button>
      )}

      {open && (
        <div className={styles.form}>
          <input
            className={styles.input}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Write a reply…"
            maxLength={1000}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && text.trim()) submit.mutate();
              if (e.key === 'Escape') setOpen(false);
            }}
          />
          <button
            className={styles.submitBtn}
            disabled={!text.trim() || submit.isPending}
            onClick={() => submit.mutate()}
          >
            Post
          </button>
          <button className={styles.cancelBtn} onClick={() => setOpen(false)}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
