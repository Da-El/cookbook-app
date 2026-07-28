import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import styles from './EditVoting.module.css';

interface AliasRow {
  id: number;
  name: string;
  author_name: string | null;
  score: number;
  vote_count: number;
  your_vote: number;
  is_mine: boolean;
  in_search: boolean;
}

/**
 * Community alternate names, e.g. "cilantro" for "Coriander, leaves, raw".
 *
 * Deliberately not a `TextEditSection` reuse: an edit picks one winning
 * value and every rival disappears, but "cilantro" and "Chinese parsley"
 * are both correct at once - this list keeps everything that clears the
 * bar rather than crowning one.
 */
export function AliasSection({ ingredientId }: { ingredientId: number }) {
  const qc = useQueryClient();
  const key = ['ingredient-aliases', ingredientId];
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');

  const { data: aliases = [] } = useQuery({
    queryKey: key,
    queryFn: () => api.get<AliasRow[]>(`/ingredients/${ingredientId}/aliases`),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: key });
    // A vote can flip whether an alias counts for search, so anything that
    // searched by name should stop trusting its cached results.
    qc.invalidateQueries({ queryKey: ['search'] });
    qc.invalidateQueries({ queryKey: ['ingredients'] });
  };

  const submit = useMutation({
    mutationFn: (name: string) => api.post(`/ingredients/${ingredientId}/aliases`, { name }),
    onSuccess: invalidate,
  });

  const vote = useMutation({
    mutationFn: ({ aliasId, value }: { aliasId: number; value: 1 | -1 }) =>
      api.post(`/ingredients/${ingredientId}/aliases/${aliasId}/vote`, { value }),
    onSuccess: invalidate,
  });

  const withdraw = useMutation({
    mutationFn: (aliasId: number) => api.del(`/ingredients/${ingredientId}/aliases/${aliasId}`),
    onSuccess: invalidate,
  });

  return (
    <div className={styles.section}>
      <div className={styles.headRow}>
        <span className={styles.headLabel}>Also known as</span>
        <button className={styles.suggestBtn} onClick={() => setOpen((v) => !v)}>
          {open ? 'Cancel' : 'Add a name'}
        </button>
      </div>

      {open && (
        <div className={styles.form}>
          <input
            className={styles.formInput}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="What else is this called?"
            maxLength={80}
          />
          <button
            className={styles.formSubmit}
            onClick={() => {
              const name = draft.trim();
              if (!name) return;
              submit.mutate(name);
              setDraft('');
              setOpen(false);
            }}
          >
            Submit
          </button>
        </div>
      )}

      {aliases.length > 0 && (
        <div className={styles.list}>
          {aliases.map((row) => (
            <div key={row.id} className={`${styles.row} ${row.in_search ? styles.rowWinner : ''}`}>
              <span className={styles.rowValue}>
                {row.name}
                {!row.in_search && (
                  <span className={styles.rowMeta}> — needs {2 - row.score > 0 ? 2 - row.score : 0} more vote{2 - row.score === 1 ? '' : 's'} to show in search</span>
                )}
                {row.author_name && <span className={styles.rowMeta}> · suggested by {row.author_name}</span>}
              </span>
              <div className={styles.voteGroup}>
                <button
                  className={`${styles.voteHalf} ${row.your_vote === 1 ? styles.voteUpOn : ''}`}
                  aria-label="This is right"
                  title="This is right"
                  onClick={() => vote.mutate({ aliasId: row.id, value: 1 })}
                >
                  ▲
                </button>
                <span className={styles.voteScore}>{row.score}</span>
                <button
                  className={`${styles.voteHalf} ${row.your_vote === -1 ? styles.voteDownOn : ''}`}
                  aria-label="That's not right"
                  title="That's not right"
                  onClick={() => vote.mutate({ aliasId: row.id, value: -1 })}
                >
                  ▼
                </button>
              </div>
              {row.is_mine && (
                <button
                  className={styles.deleteBtn}
                  title="Withdraw your suggestion"
                  aria-label="Withdraw your suggestion"
                  onClick={(e) => {
                    e.stopPropagation();
                    withdraw.mutate(row.id);
                  }}
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
