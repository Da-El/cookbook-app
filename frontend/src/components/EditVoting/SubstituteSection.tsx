import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { IngredientSummary } from '../../api/types';
import { FlagButton } from '../Flag/FlagButton';
import styles from './EditVoting.module.css';

interface SubstituteRow {
  id: number;
  substitute_id: number;
  substitute_name: string;
  note: string | null;
  author_name: string | null;
  score: number;
  vote_count: number;
  your_vote: number;
  is_mine: boolean;
}

/**
 * "No X? try Y" - a different ingredient that stands in for this one, with an
 * optional note ("use half as much"). Directional voting, unlike aliases:
 * "that doesn't actually work" needs to be sayable, not just witholdable.
 */
export function SubstituteSection({ ingredientId }: { ingredientId: number }) {
  const qc = useQueryClient();
  const key = ['ingredient-substitutes', ingredientId];
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<IngredientSummary | null>(null);
  const [note, setNote] = useState('');

  const { data: subs = [] } = useQuery({
    queryKey: key,
    queryFn: () => api.get<SubstituteRow[]>(`/ingredients/${ingredientId}/substitutes`),
  });

  const { data: matches = [] } = useQuery({
    queryKey: ['ingredients', query],
    queryFn: () => api.get<IngredientSummary[]>(`/ingredients?search=${encodeURIComponent(query)}`),
    enabled: query.trim().length > 1 && !picked,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: key });

  const submit = useMutation({
    mutationFn: () =>
      api.post(`/ingredients/${ingredientId}/substitutes`, {
        substitute_id: picked!.id,
        note: note.trim() || undefined,
      }),
    onSuccess: invalidate,
  });

  const vote = useMutation({
    mutationFn: ({ subId, value }: { subId: number; value: 1 | -1 }) =>
      api.post(`/ingredients/${ingredientId}/substitutes/${subId}/vote`, { value }),
    onSuccess: invalidate,
  });

  const withdraw = useMutation({
    mutationFn: (subId: number) => api.del(`/ingredients/${ingredientId}/substitutes/${subId}`),
    onSuccess: invalidate,
  });

  function reset() {
    setOpen(false);
    setQuery('');
    setPicked(null);
    setNote('');
  }

  return (
    <div className={styles.section}>
      <div className={styles.headRow}>
        <span className={styles.headLabel}>Substitutes</span>
        <button className={styles.suggestBtn} onClick={() => (open ? reset() : setOpen(true))}>
          {open ? 'Cancel' : 'Suggest a substitute'}
        </button>
      </div>

      {open && (
        <div className={styles.form} style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          {!picked ? (
            <>
              <input
                className={styles.formInput}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search for the substitute ingredient…"
                autoFocus
              />
              {query.trim().length > 1 && matches.length > 0 && (
                <div className={styles.list} style={{ marginTop: 6 }}>
                  {matches
                    .filter((m) => m.id !== ingredientId)
                    .slice(0, 6)
                    .map((m) => (
                      <button
                        key={m.id}
                        className={styles.row}
                        style={{ cursor: 'pointer', textAlign: 'left' }}
                        onClick={() => {
                          setPicked(m);
                          setQuery('');
                        }}
                      >
                        <span className={styles.rowValue}>{m.name}</span>
                      </button>
                    ))}
                </div>
              )}
            </>
          ) : (
            <>
              <div className={styles.row}>
                <span className={styles.rowValue}>{picked.name}</span>
                <button className={styles.deleteBtn} aria-label="Choose a different ingredient" onClick={() => setPicked(null)}>
                  ×
                </button>
              </div>
              <input
                className={styles.formInput}
                style={{ marginTop: 8 }}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={'Optional note, e.g. "use half as much"'}
                maxLength={140}
              />
              <button
                className={styles.formSubmit}
                style={{ marginTop: 8, alignSelf: 'flex-start' }}
                onClick={() => {
                  submit.mutate();
                  reset();
                }}
              >
                Submit
              </button>
            </>
          )}
        </div>
      )}

      {subs.length > 0 && (
        <div className={styles.list}>
          {subs.map((row) => (
            <div key={row.id} className={styles.row}>
              <span className={styles.rowValue}>
                <Link to={`/ingredients/${row.substitute_id}`} className={styles.rowMetaLink} style={{ fontWeight: 700, color: 'var(--ink)' }}>
                  {row.substitute_name}
                </Link>
                {row.note && <span className={styles.rowMeta}> — {row.note}</span>}
                {row.author_name && <span className={styles.rowMeta}> · suggested by {row.author_name}</span>}
              </span>
              <div className={styles.voteGroup}>
                <button
                  className={`${styles.voteHalf} ${row.your_vote === 1 ? styles.voteUpOn : ''}`}
                  aria-label="This works"
                  title="This works"
                  onClick={() => vote.mutate({ subId: row.id, value: 1 })}
                >
                  ▲
                </button>
                <span className={styles.voteScore}>{row.score}</span>
                <button
                  className={`${styles.voteHalf} ${row.your_vote === -1 ? styles.voteDownOn : ''}`}
                  aria-label="This doesn't work"
                  title="This doesn't work"
                  onClick={() => vote.mutate({ subId: row.id, value: -1 })}
                >
                  ▼
                </button>
              </div>
              {row.is_mine ? (
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
              ) : (
                <FlagButton contentType="substitute" contentId={row.id} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
