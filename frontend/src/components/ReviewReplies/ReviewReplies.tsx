import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../Toast/ToastContext';
import { FlagButton } from '../Flag/FlagButton';
import styles from './ReviewReplies.module.css';

interface ReviewReply {
  id: number;
  review_id: number;
  user_id: number | null;
  author_name: string | null;
  body: string;
  created_at: string;
  parent_reply_id: number | null;
}

interface ReplyNode extends ReviewReply {
  children: ReplyNode[];
}

function buildTree(replies: ReviewReply[]): ReplyNode[] {
  const byId = new Map<number, ReplyNode>();
  for (const r of replies) byId.set(r.id, { ...r, children: [] });
  const roots: ReplyNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parent_reply_id != null ? byId.get(node.parent_reply_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

function relativeTime(iso: string) {
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days < 1) return 'today';
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

function ReplyRow({
  node,
  replyingTo,
  onReply,
  onDelete,
  composer,
}: {
  node: ReplyNode;
  replyingTo: number | null;
  onReply: (id: number, name: string) => void;
  onDelete: (id: number) => void;
  composer: React.ReactNode;
}) {
  const { user } = useAuth();

  return (
    <div className={styles.node}>
      <div className={styles.row}>
        <span className={styles.body}>
          {node.user_id ? (
            <Link to={`/chefs/${node.user_id}`} className={styles.author}>
              {node.author_name ?? 'a chef'}
            </Link>
          ) : (
            <span className={styles.author}>{node.author_name ?? 'a former user'}</span>
          )}
          <span className={styles.text}>{node.body}</span>
          <span className={styles.meta}>
            <span className={styles.time}>{relativeTime(node.created_at)}</span>
            {user && (
              <button className={styles.replyTrigger} onClick={() => onReply(node.id, node.author_name ?? 'a chef')}>
                Reply
              </button>
            )}
          </span>
        </span>
        {user && node.user_id === user.id && (
          <button
            className={styles.deleteBtn}
            title="Delete your reply"
            aria-label="Delete your reply"
            onClick={() => onDelete(node.id)}
          >
            ×
          </button>
        )}
        {user && node.user_id !== user.id && <FlagButton contentType="review_reply" contentId={node.id} />}
      </div>

      {replyingTo === node.id && composer}

      {node.children.map((child) => (
        <ReplyRow
          key={child.id}
          node={child}
          replyingTo={replyingTo}
          onReply={onReply}
          onDelete={onDelete}
          composer={composer}
        />
      ))}
    </div>
  );
}

/**
 * Threaded replies under a review - not its own comment section, just enough
 * for "this happened to me too" or "try it with less salt" (and a reply to
 * that reply) to have somewhere to go besides a brand new review. Lives
 * right under the review it belongs to on the meal page.
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
  // null = closed; 0 = replying to the review itself; >0 = replying to that reply id.
  const [replyingTo, setReplyingTo] = useState<number | null>(null);
  const [replyingToName, setReplyingToName] = useState('');
  const [text, setText] = useState('');

  const tree = useMemo(() => buildTree(replies), [replies]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['meal-reviews', String(mealId)] });

  const closeComposer = () => {
    setReplyingTo(null);
    setText('');
  };

  const submit = useMutation({
    mutationFn: () =>
      api.post(`/meals/${mealId}/reviews/${reviewId}/replies`, {
        body: text.trim(),
        parent_reply_id: replyingTo ? replyingTo : null,
      }),
    onSuccess: () => {
      closeComposer();
      invalidate();
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not post that reply.'),
  });

  const remove = useMutation({
    mutationFn: (replyId: number) => api.del(`/meals/${mealId}/reviews/${reviewId}/replies/${replyId}`),
    onSuccess: invalidate,
  });

  const composer = (
    <div className={styles.form}>
      {replyingTo !== null && replyingTo !== 0 && (
        <span className={styles.replyingToPill}>
          Replying to {replyingToName}
          <button className={styles.replyingToClear} onClick={closeComposer} aria-label="Cancel reply">
            ×
          </button>
        </span>
      )}
      <input
        className={styles.input}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Write a reply…"
        maxLength={1000}
        autoFocus
        onKeyDown={(e) => {
          if (e.key === 'Enter' && text.trim()) submit.mutate();
          if (e.key === 'Escape') closeComposer();
        }}
      />
      <button
        className={styles.submitBtn}
        disabled={!text.trim() || submit.isPending}
        onClick={() => submit.mutate()}
      >
        Post
      </button>
      <button className={styles.cancelBtn} onClick={closeComposer}>
        Cancel
      </button>
    </div>
  );

  return (
    <div className={styles.wrap}>
      {tree.length > 0 && (
        <div className={styles.list}>
          {tree.map((node) => (
            <ReplyRow
              key={node.id}
              node={node}
              replyingTo={replyingTo}
              onReply={(id, name) => {
                setReplyingTo(id);
                setReplyingToName(name);
                setText('');
              }}
              onDelete={(id) => remove.mutate(id)}
              composer={composer}
            />
          ))}
        </div>
      )}

      {user && replyingTo === null && (
        <button className={styles.replyTrigger} onClick={() => setReplyingTo(0)}>
          Reply
        </button>
      )}

      {replyingTo === 0 && composer}
    </div>
  );
}
