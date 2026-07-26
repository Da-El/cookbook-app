import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { pickImage } from '../../lib/photo';
import styles from './EditVoting.module.css';

interface EditRow {
  id: number;
  value: unknown;
  author_name: string | null;
  votes: number;
  voted_by_me: boolean;
  is_mine: boolean;
}

const CATEGORIES = ['Vegetable', 'Fruit', 'Herb', 'Aromatic', 'Protein', 'Dairy', 'Grain', 'Pantry'];

function useEdits(ingredientId: number, field: string) {
  const qc = useQueryClient();
  const key = ['ingredient-edits', ingredientId, field];

  const { data: edits = [] } = useQuery({
    queryKey: key,
    queryFn: () => api.get<EditRow[]>(`/ingredients/${ingredientId}/edits/${field}`),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ['ingredient', String(ingredientId)] });
  };

  const submit = useMutation({
    mutationFn: (value: unknown) => api.post(`/ingredients/${ingredientId}/edits`, { field, value }),
    onSuccess: invalidate,
  });

  const vote = useMutation({
    mutationFn: (editId: number) => api.post(`/ingredients/${ingredientId}/edits/${editId}/vote`),
    onSuccess: invalidate,
  });

  const del = useMutation({
    mutationFn: (editId: number) => api.del(`/ingredients/${ingredientId}/edits/${editId}`),
    onSuccess: invalidate,
  });

  return { edits, submit, vote, del };
}

function VoteButton({ row, onVote }: { row: EditRow; onVote: () => void }) {
  return (
    <button className={`${styles.voteBtn} ${row.voted_by_me ? styles.voteBtnOn : ''}`} onClick={onVote}>
      {row.voted_by_me ? '✓' : '△'} {row.votes}
    </button>
  );
}

/** Author-only "withdraw your own submission" control. */
function DeleteButton({ onDelete }: { onDelete: () => void }) {
  return (
    <button
      className={styles.deleteBtn}
      title="Delete your submission"
      aria-label="Delete your submission"
      onClick={(e) => {
        e.stopPropagation();
        onDelete();
      }}
    >
      ×
    </button>
  );
}

/** Suggest-and-vote for a plain-text field (description or freeform values). */
export function TextEditSection({
  ingredientId,
  field,
  label,
  placeholder,
}: {
  ingredientId: number;
  field: 'description';
  label: string;
  placeholder: string;
}) {
  const { edits, submit, vote, del } = useEdits(ingredientId, field);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');

  return (
    <div className={styles.section}>
      <div className={styles.headRow}>
        <span className={styles.headLabel}>{label}</span>
        <button className={styles.suggestBtn} onClick={() => setOpen((v) => !v)}>
          {open ? 'Cancel' : 'Suggest an edit'}
        </button>
      </div>

      {open && (
        <div className={styles.form}>
          <input
            className={styles.formInput}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={placeholder}
          />
          <button
            className={styles.formSubmit}
            onClick={() => {
              if (!draft.trim()) return;
              submit.mutate(draft.trim());
              setDraft('');
              setOpen(false);
            }}
          >
            Submit
          </button>
        </div>
      )}

      {edits.length > 0 && (
        <div className={styles.list}>
          {edits.map((row, i) => (
            <div key={row.id} className={`${styles.row} ${i === 0 ? styles.rowWinner : ''}`}>
              <span className={styles.rowValue}>
                {String(row.value)}
                {row.author_name && <span className={styles.rowMeta}> — {row.author_name}</span>}
              </span>
              <VoteButton row={row} onVote={() => vote.mutate(row.id)} />
              {row.is_mine && <DeleteButton onDelete={() => del.mutate(row.id)} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Suggest-and-vote for category, as a chip picker instead of free text. */
export function CategoryEditSection({ ingredientId }: { ingredientId: number }) {
  const { edits, submit, vote, del } = useEdits(ingredientId, 'category');
  const [open, setOpen] = useState(false);

  return (
    <div className={styles.section}>
      <div className={styles.headRow}>
        <span className={styles.headLabel}>Category</span>
        <button className={styles.suggestBtn} onClick={() => setOpen((v) => !v)}>
          {open ? 'Cancel' : 'Suggest a change'}
        </button>
      </div>

      {open && (
        <div className={styles.chipForm}>
          {CATEGORIES.map((c) => (
            <button
              key={c}
              className={styles.chip}
              onClick={() => {
                submit.mutate(c);
                setOpen(false);
              }}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {edits.length > 0 && (
        <div className={styles.list}>
          {edits.map((row, i) => (
            <div key={row.id} className={`${styles.row} ${i === 0 ? styles.rowWinner : ''}`}>
              <span className={styles.rowValue}>{String(row.value)}</span>
              <VoteButton row={row} onVote={() => vote.mutate(row.id)} />
              {row.is_mine && <DeleteButton onDelete={() => del.mutate(row.id)} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface NutritionValue {
  serving_size?: string;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
}

function describeNutrition(v: NutritionValue): string {
  const parts = [
    v.calories != null ? `${v.calories} cal` : null,
    v.protein != null ? `${v.protein}g protein` : null,
    v.serving_size ?? null,
  ].filter(Boolean);
  return parts.join(' · ') || 'Updated values';
}

/** Suggest-and-vote for the macro nutrition facts. */
export function NutritionEditSection({ ingredientId }: { ingredientId: number }) {
  const { edits, submit, vote, del } = useEdits(ingredientId, 'nutrition');
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ serving_size: '', calories: '', protein: '', carbs: '', fat: '' });

  return (
    <div className={styles.section}>
      <div className={styles.headRow}>
        <span className={styles.headLabel}>Nutrition facts</span>
        <button className={styles.suggestBtn} onClick={() => setOpen((v) => !v)}>
          {open ? 'Cancel' : 'Suggest new values'}
        </button>
      </div>

      {open && (
        <>
          <div className={styles.form} style={{ flexWrap: 'wrap' }}>
            <input
              className={styles.formInput}
              style={{ minWidth: 140 }}
              placeholder="Serving size"
              value={draft.serving_size}
              onChange={(e) => setDraft({ ...draft, serving_size: e.target.value })}
            />
            <input
              className={styles.formInput}
              style={{ minWidth: 90 }}
              placeholder="Calories"
              inputMode="decimal"
              value={draft.calories}
              onChange={(e) => setDraft({ ...draft, calories: e.target.value })}
            />
            <input
              className={styles.formInput}
              style={{ minWidth: 90 }}
              placeholder="Protein (g)"
              inputMode="decimal"
              value={draft.protein}
              onChange={(e) => setDraft({ ...draft, protein: e.target.value })}
            />
            <input
              className={styles.formInput}
              style={{ minWidth: 90 }}
              placeholder="Carbs (g)"
              inputMode="decimal"
              value={draft.carbs}
              onChange={(e) => setDraft({ ...draft, carbs: e.target.value })}
            />
            <input
              className={styles.formInput}
              style={{ minWidth: 90 }}
              placeholder="Fat (g)"
              inputMode="decimal"
              value={draft.fat}
              onChange={(e) => setDraft({ ...draft, fat: e.target.value })}
            />
          </div>
          <button
            className={styles.formSubmit}
            style={{ marginTop: 8 }}
            onClick={() => {
              submit.mutate({
                serving_size: draft.serving_size.trim() || undefined,
                calories: draft.calories.trim() ? Number(draft.calories) : undefined,
                protein: draft.protein.trim() ? Number(draft.protein) : undefined,
                carbs: draft.carbs.trim() ? Number(draft.carbs) : undefined,
                fat: draft.fat.trim() ? Number(draft.fat) : undefined,
              });
              setDraft({ serving_size: '', calories: '', protein: '', carbs: '', fat: '' });
              setOpen(false);
            }}
          >
            Submit
          </button>
        </>
      )}

      {edits.length > 0 && (
        <div className={styles.list}>
          {edits.map((row, i) => (
            <div key={row.id} className={`${styles.row} ${i === 0 ? styles.rowWinner : ''}`}>
              <span className={styles.rowValue}>{describeNutrition(row.value as NutritionValue)}</span>
              <VoteButton row={row} onVote={() => vote.mutate(row.id)} />
              {row.is_mine && <DeleteButton onDelete={() => del.mutate(row.id)} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Community photo submissions + voting. Winning photo becomes the ingredient's photo. */
export function PhotoEditSection({ ingredientId }: { ingredientId: number }) {
  const { edits, submit, vote, del } = useEdits(ingredientId, 'photo');

  return (
    <div className={styles.section}>
      <div className={styles.headRow}>
        <span className={styles.headLabel}>Community photos</span>
        <button className={styles.suggestBtn} onClick={() => pickImage((url) => submit.mutate(url))}>
          Submit a photo
        </button>
      </div>

      {edits.length > 0 && (
        <div className={styles.photoGrid}>
          {edits.map((row, i) => (
            <div key={row.id} className={styles.photoTileWrap}>
              <button
                className={`${styles.photoTile} ${i === 0 ? styles.photoTileWinner : ''}`}
                style={{ backgroundImage: `url("${String(row.value)}")` }}
                onClick={() => vote.mutate(row.id)}
                title={row.voted_by_me ? 'Remove your vote' : 'Vote for this photo'}
              >
                <span className={styles.photoVotes}>{row.voted_by_me ? '✓ ' : ''}{row.votes}</span>
              </button>
              {row.is_mine && <DeleteButton onDelete={() => del.mutate(row.id)} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
