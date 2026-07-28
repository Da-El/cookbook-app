import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import { useToast } from '../Toast/ToastContext';
import styles from './FlagButton.module.css';

export type FlaggableType =
  | 'meal_revision'
  | 'review'
  | 'ingredient_edit'
  | 'alias'
  | 'substitute'
  | 'guide_edit'
  | 'user_profile';

/**
 * A quiet "send this to a moderator" control, reused everywhere community
 * content can go wrong: reviews, edit history, aliases, substitutes, guide
 * suggestions. Voting already surfaces "most people disagree" - this is for
 * the smaller set of cases that shouldn't wait on a vote count at all.
 */
export function FlagButton({
  contentType,
  contentId,
  label = '⚑ Flag',
  placeholder = "What's wrong with this?",
}: {
  contentType: FlaggableType;
  contentId: number;
  label?: string;
  placeholder?: string;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');

  const submit = useMutation({
    mutationFn: () => api.post('/flags', { content_type: contentType, content_id: contentId, reason: reason.trim() }),
    onSuccess: () => {
      toast('Flagged for review - thanks for looking out.');
      setOpen(false);
      setReason('');
    },
    onError: (e) => {
      toast(e instanceof ApiError ? e.message : 'Could not send that flag.');
    },
  });

  if (!open) {
    return (
      <button type="button" className={styles.trigger} onClick={() => setOpen(true)} aria-label="Flag for moderator review">
        {label}
      </button>
    );
  }

  return (
    <div className={styles.form} onClick={(e) => e.stopPropagation()}>
      <input
        className={styles.input}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={placeholder}
        maxLength={500}
        autoFocus
        onKeyDown={(e) => {
          if (e.key === 'Enter' && reason.trim()) submit.mutate();
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      <button
        type="button"
        className={styles.submit}
        disabled={!reason.trim() || submit.isPending}
        onClick={() => submit.mutate()}
      >
        Send
      </button>
      <button
        type="button"
        className={styles.cancel}
        onClick={() => {
          setOpen(false);
          setReason('');
        }}
      >
        Cancel
      </button>
    </div>
  );
}
