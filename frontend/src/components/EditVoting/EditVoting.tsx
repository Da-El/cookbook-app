import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { pickImage } from '../../lib/photo';
import { FlagButton } from '../Flag/FlagButton';
import { ContributorBadge, type ContributorTier } from '../ContributorBadge/ContributorBadge';
import styles from './EditVoting.module.css';

interface EditRow {
  id: number;
  value: unknown;
  author_name: string | null;
  /// NULL for a former user whose account was deleted.
  author_id: number | null;
  votes: number;
  voted_by_me: boolean;
  is_mine: boolean;
  author_tier: ContributorTier | null;
}

const CATEGORIES = ['Vegetable', 'Fruit', 'Herb', 'Aromatic', 'Protein', 'Dairy', 'Grain', 'Pantry'];
// Lowercase-hyphenated, matching backend/src/diet.rs's ALL_DIET_FLAGS exactly
// (the wire value); the label shown to people is Title Case.
const DIET_FLAGS: [string, string][] = [
  ['vegetarian', 'Vegetarian'],
  ['vegan', 'Vegan'],
  ['pescatarian', 'Pescatarian'],
  ['gluten-free', 'Gluten-free'],
  ['dairy-free', 'Dairy-free'],
  ['nut-free', 'Nut-free'],
];

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
    <button
      className={`${styles.voteBtn} ${row.voted_by_me ? styles.voteBtnOn : ''}`}
      onClick={onVote}
      aria-pressed={row.voted_by_me}
      aria-label={row.voted_by_me ? `Remove your vote (${row.votes} votes)` : `Vote for this (${row.votes} votes)`}
    >
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
  currentValue,
}: {
  ingredientId: number;
  field: 'description';
  label: string;
  placeholder: string;
  /** What's live right now - shown once above the proposals so a voter can
   * judge "is this actually better?" without scrolling up to compare
   * against the description already on the page. Every pending proposal
   * competes against this same value, not against each other. */
  currentValue?: string | null;
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
          {currentValue && (
            <p className={styles.currentValueHint}>Current: {currentValue}</p>
          )}
          {edits.map((row, i) => (
            <div key={row.id} className={`${styles.row} ${i === 0 ? styles.rowWinner : ''}`}>
              <span className={styles.rowValue}>
                {String(row.value)}
                {row.author_name && (
                  <span className={styles.rowMeta}>
                    {' '}
                    —{' '}
                    {row.author_id ? (
                      <Link to={`/chefs/${row.author_id}`} className={styles.rowMetaLink}>
                        {row.author_name}
                      </Link>
                    ) : (
                      row.author_name
                    )}{' '}
                    <ContributorBadge tier={row.author_tier} />
                  </span>
                )}
              </span>
              <VoteButton row={row} onVote={() => vote.mutate(row.id)} />
              {row.is_mine ? (
                <DeleteButton onDelete={() => del.mutate(row.id)} />
              ) : (
                <FlagButton contentType="ingredient_edit" contentId={row.id} />
              )}
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
              {row.is_mine ? (
                <DeleteButton onDelete={() => del.mutate(row.id)} />
              ) : (
                <FlagButton contentType="ingredient_edit" contentId={row.id} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function describeDietFlags(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return 'No diet tags';
  const labels = new Map(DIET_FLAGS);
  return value.map((v) => labels.get(String(v)) ?? String(v)).join(', ');
}

/**
 * Suggest-and-vote for diet compatibility - unlike Category (pick one), this
 * proposes a whole tag set at once, since "vegan" and "gluten-free" are
 * independent claims that both need to be right together, not two separate
 * single-value edits racing each other.
 */
export function DietFlagsEditSection({ ingredientId }: { ingredientId: number }) {
  const { edits, submit, vote, del } = useEdits(ingredientId, 'diet_flags');
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);

  function toggle(flag: string) {
    setDraft((d) => (d.includes(flag) ? d.filter((f) => f !== flag) : [...d, flag]));
  }

  return (
    <div className={styles.section}>
      <div className={styles.headRow}>
        <span className={styles.headLabel}>Diet</span>
        <button
          className={styles.suggestBtn}
          onClick={() => {
            setOpen((v) => !v);
            setDraft([]);
          }}
        >
          {open ? 'Cancel' : 'Suggest tags'}
        </button>
      </div>

      {open && (
        <div className={styles.form}>
          <div className={styles.chipForm}>
            {DIET_FLAGS.map(([flag, label]) => (
              <button
                key={flag}
                className={`${styles.chip} ${draft.includes(flag) ? styles.chipOn : ''}`}
                aria-pressed={draft.includes(flag)}
                onClick={() => toggle(flag)}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            className={styles.formSubmit}
            style={{ marginTop: 8 }}
            onClick={() => {
              submit.mutate(draft);
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
              <span className={styles.rowValue}>{describeDietFlags(row.value)}</span>
              <VoteButton row={row} onVote={() => vote.mutate(row.id)} />
              {row.is_mine ? (
                <DeleteButton onDelete={() => del.mutate(row.id)} />
              ) : (
                <FlagButton contentType="ingredient_edit" contentId={row.id} />
              )}
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
              {row.is_mine ? (
                <DeleteButton onDelete={() => del.mutate(row.id)} />
              ) : (
                <FlagButton contentType="ingredient_edit" contentId={row.id} />
              )}
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
              {row.is_mine ? (
                <DeleteButton onDelete={() => del.mutate(row.id)} />
              ) : (
                <FlagButton contentType="ingredient_edit" contentId={row.id} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
