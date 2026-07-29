import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { IngredientSummary } from '../api/types';
import { SearchIcon } from '../components/Icon/Icon';
import { ingredientBackground } from '../lib/imagery';
import { pickImage } from '../lib/photo';
import styles from './Create.module.css';

export const CUISINES = [
  'Italian', 'Japanese', 'Mexican', 'Chinese', 'Thai', 'American', 'French',
  'Indian', 'Korean', 'Vietnamese', 'Greek', 'Spanish', 'Moroccan', 'Lebanese',
];
export const MEAL_TYPES = ['Breakfast', 'Lunch', 'Dinner', 'Dessert', 'Snack'];

/** `id: null` covers ingredients kept as free text - an imported line that
 *  never matched the catalog, most often. It stays editable and savable; it
 *  just can't be toggled from the search-match list the way a catalog hit can. */
export interface PickedIngredient {
  key: string;
  id: number | null;
  name: string;
  amount: string;
  unit: string;
}

export interface MealFormValue {
  name: string;
  serves: string;
  time: string;
  cuisine: string;
  mealType: string;
  visibility: 'public' | 'personal';
  picked: PickedIngredient[];
  steps: string[];
  description: string;
  photo: string;
  /** Extra gallery photos beyond the cover - shown on the meal's own page only. */
  photos: string[];
}

export function emptyMealForm(): MealFormValue {
  return {
    name: '', serves: '', time: '', cuisine: 'Italian', mealType: 'Dinner',
    visibility: 'public', picked: [], steps: [''], description: '', photo: '', photos: [],
  };
}

let keySeq = 0;
const nextKey = () => `p${Date.now()}_${keySeq++}`;

/** name/amount/unit for the meals API, ready to hand to POST or edit PUT. */
export function toIngredientPayload(picked: PickedIngredient[]) {
  return picked
    .filter((p) => p.name.trim())
    .map((p) => ({
      ingredient_id: p.id ?? undefined,
      name: p.name.trim(),
      amount: p.amount.trim() ? Number(p.amount) : undefined,
      unit: p.unit.trim() || undefined,
    }));
}

/**
 * The name/cuisine/ingredients/steps form shared by Create and Edit.
 *
 * A single controlled `value` object rather than lifted per-field state:
 * Create and Edit each own exactly one piece of state and pass it straight
 * through, so the two screens can't quietly drift out of sync on how a field
 * behaves - which is exactly the kind of gap that made the old qty-only
 * picker mis-attribute quantities to the wrong ingredient (see
 * `toIngredientPayload`: amount/unit now travel as their own fields instead
 * of a single free-text string the server had to guess about).
 */
export function MealForm({
  value,
  onChange,
}: {
  value: MealFormValue;
  onChange: (next: MealFormValue) => void;
}) {
  const [ingQuery, setIngQuery] = useState('');
  const set = <K extends keyof MealFormValue>(k: K, v: MealFormValue[K]) =>
    onChange({ ...value, [k]: v });

  const { data: matches = [] } = useQuery({
    queryKey: ['ingredients', ingQuery],
    queryFn: () => api.get<IngredientSummary[]>(`/ingredients?search=${encodeURIComponent(ingQuery)}`),
    enabled: ingQuery.trim().length > 0,
  });

  function togglePick(i: IngredientSummary) {
    const already = value.picked.some((p) => p.id === i.id);
    set(
      'picked',
      already
        ? value.picked.filter((p) => p.id !== i.id)
        : [...value.picked, { key: nextKey(), id: i.id, name: i.name, amount: '', unit: '' }],
    );
  }

  function patchPicked(key: string, patch: Partial<PickedIngredient>) {
    set('picked', value.picked.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  }

  function removePicked(key: string) {
    set('picked', value.picked.filter((p) => p.key !== key));
  }

  return (
    <>
      {value.photo ? (
        <button
          className={styles.photoFilled}
          style={{ background: `center/cover no-repeat url("${value.photo}")` }}
          onClick={() => pickImage((url) => set('photo', url))}
        >
          <span className={styles.photoBadge}>Change photo</span>
        </button>
      ) : (
        <button className={styles.photoDrop} onClick={() => pickImage((url) => set('photo', url))}>
          <span>Take or upload a photo</span>
        </button>
      )}

      <div className={styles.field}>
        <div className={styles.pickerHead}>
          <label className={styles.label} style={{ marginBottom: 0 }}>More photos</label>
          <span className={styles.pickerCount}>{value.photos.length} added</span>
        </div>
        <div className={styles.galleryRow}>
          {value.photos.map((url, i) => (
            <div key={i} className={styles.galleryThumb} style={{ background: `center/cover no-repeat url("${url}")` }}>
              <button
                className={styles.galleryRemove}
                onClick={() => set('photos', value.photos.filter((_, j) => j !== i))}
                aria-label={`Remove photo ${i + 1}`}
              >
                ×
              </button>
            </div>
          ))}
          <button
            className={styles.galleryAdd}
            onClick={() => pickImage((url) => set('photos', [...value.photos, url]))}
          >
            + Add
          </button>
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.label}>Meal name</label>
        <input
          className={styles.input}
          value={value.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="e.g. Roasted Tomato Soup"
        />
      </div>

      <div className={`${styles.field} ${styles.twoCol}`}>
        <div>
          <label className={styles.label}>Serves</label>
          <input
            className={`${styles.input} ${styles.inputSm}`}
            value={value.serves}
            onChange={(e) => set('serves', e.target.value)}
            placeholder="4"
            inputMode="numeric"
          />
        </div>
        <div>
          <label className={styles.label}>Total time (min)</label>
          <input
            className={`${styles.input} ${styles.inputSm}`}
            value={value.time}
            onChange={(e) => set('time', e.target.value)}
            placeholder="e.g. 30"
            inputMode="numeric"
          />
        </div>
      </div>

      {/* A single-select field with 14 known options doesn't need to spend
          four wrapped rows of chips showing every choice at once - the
          native picker (the OS's own wheel/dropdown) shows the full list on
          tap and collapses to one row otherwise, the same trade every
          mobile form makes for a bounded, unambiguous choice. */}
      <div className={styles.field}>
        <label className={styles.label} htmlFor="meal-cuisine">Cuisine</label>
        <select
          id="meal-cuisine"
          className={styles.select}
          value={value.cuisine}
          onChange={(e) => set('cuisine', e.target.value)}
        >
          {CUISINES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="meal-type">Meal type</label>
        <select
          id="meal-type"
          className={styles.select}
          value={value.mealType}
          onChange={(e) => set('mealType', e.target.value)}
        >
          {MEAL_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label className={styles.label}>Visibility</label>
        <div className={styles.segToggle}>
          <button
            className={value.visibility === 'public' ? styles.segActive : ''}
            onClick={() => set('visibility', 'public')}
          >
            Public
          </button>
          <button
            className={value.visibility === 'personal' ? styles.segActive : ''}
            onClick={() => set('visibility', 'personal')}
          >
            Personal
          </button>
        </div>
        <p className={styles.visHint}>
          {value.visibility === 'public'
            ? 'Anyone can discover this meal in Browse & search.'
            : 'Stays private in your Cookbook only — won’t appear in Browse or search.'}
        </p>
      </div>

      <div className={styles.pickerHead}>
        <label className={styles.label} style={{ marginBottom: 0 }}>Ingredients</label>
        <span className={styles.pickerCount}>{value.picked.length} selected</span>
      </div>

      {value.picked.length === 0 ? (
        <p className={styles.helper} style={{ marginTop: 0, marginBottom: 10 }}>
          No ingredients added yet — search below.
        </p>
      ) : (
        <div className={styles.selectedList}>
          {value.picked.map((p) => (
            <div key={p.key} className={styles.selectedRow}>
              <span className={styles.selectedName} title={p.id == null ? 'Not linked to a catalog page' : undefined}>
                {p.name || '(unnamed)'}
                {p.id == null && ' ·'}
              </span>
              <input
                className={styles.qtyInput}
                style={{ width: 64 }}
                value={p.amount}
                placeholder="amt"
                inputMode="decimal"
                onChange={(e) => patchPicked(p.key, { amount: e.target.value })}
              />
              <input
                className={styles.qtyInput}
                style={{ width: 64 }}
                value={p.unit}
                placeholder="unit"
                onChange={(e) => patchPicked(p.key, { unit: e.target.value })}
              />
              <button
                className={styles.removeCircle}
                onClick={() => removePicked(p.key)}
                aria-label={`Remove ${p.name}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className={styles.searchBox}>
        <SearchIcon size={18} strokeWidth={2} />
        <input
          className={styles.searchInput}
          value={ingQuery}
          onChange={(e) => setIngQuery(e.target.value)}
          placeholder="Search ingredients to add…"
        />
      </div>

      {ingQuery.trim() && (
        <div className={styles.matchList}>
          {matches.slice(0, 6).map((m) => {
            const on = value.picked.some((p) => p.id === m.id);
            return (
              <div key={m.id} className={styles.matchRow}>
                <span
                  className={styles.matchThumb}
                  style={{ background: ingredientBackground(null, m.category) }}
                />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className={styles.matchName} style={{ display: 'block' }}>{m.name}</span>
                  <span className={styles.matchCat} style={{ display: 'block' }}>{m.category}</span>
                </span>
                <button
                  className={`${styles.matchBtn} ${on ? styles.matchBtnOn : ''}`}
                  onClick={() => togglePick(m)}
                >
                  {on ? 'Remove' : 'Add'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      <button
        className={styles.crossLink}
        onClick={() =>
          set('picked', [...value.picked, { key: nextKey(), id: null, name: '', amount: '', unit: '' }])
        }
      >
        + Add without a catalog page
      </button>

      <div className={styles.field}>
        <label className={styles.label}>Cooking steps</label>
        <div className={styles.steps}>
          {value.steps.map((s, i) => (
            <div key={i} className={styles.step}>
              <span className={styles.stepNum}>{i + 1}</span>
              <textarea
                className={styles.stepInput}
                rows={2}
                value={s}
                placeholder="Describe this step…"
                onChange={(e) =>
                  set('steps', value.steps.map((x, j) => (j === i ? e.target.value : x)))
                }
              />
              <span className={styles.stepMoveCol}>
                <button
                  className={styles.stepMove}
                  disabled={i === 0}
                  aria-label={`Move step ${i + 1} up`}
                  onClick={() => {
                    const next = [...value.steps];
                    [next[i - 1], next[i]] = [next[i], next[i - 1]];
                    set('steps', next);
                  }}
                >
                  ↑
                </button>
                <button
                  className={styles.stepMove}
                  disabled={i === value.steps.length - 1}
                  aria-label={`Move step ${i + 1} down`}
                  onClick={() => {
                    const next = [...value.steps];
                    [next[i], next[i + 1]] = [next[i + 1], next[i]];
                    set('steps', next);
                  }}
                >
                  ↓
                </button>
              </span>
              {value.steps.length > 1 && (
                <button
                  className={styles.stepRemove}
                  onClick={() => set('steps', value.steps.filter((_, j) => j !== i))}
                  aria-label={`Remove step ${i + 1}`}
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
        <button className={styles.addStep} onClick={() => set('steps', [...value.steps, ''])}>
          + Add step
        </button>
      </div>

      <div className={styles.field}>
        <label className={styles.label}>Description</label>
        <textarea
          className={styles.textarea}
          rows={3}
          value={value.description}
          onChange={(e) => set('description', e.target.value)}
          placeholder="Tell the story of this dish…"
        />
      </div>
    </>
  );
}

/** True when the required parts of the form are filled in. */
export function mealFormError(value: MealFormValue): string | null {
  if (!value.name.trim()) return 'Please name your meal.';
  if (value.picked.filter((p) => p.name.trim()).length === 0) return 'Add at least one ingredient.';
  if (value.steps.map((s) => s.trim()).filter(Boolean).length === 0) return 'Add at least one cooking step.';
  return null;
}
