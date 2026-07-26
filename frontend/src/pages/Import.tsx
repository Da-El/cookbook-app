import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { DraftIngredient, ImportResponse, RecipeDraft } from '../api/types';
import { ChevronLeft } from '../components/Icon/Icon';
import { Segmented } from '../components/Segmented/Segmented';
import { useToast } from '../components/Toast/ToastContext';
import styles from './Import.module.css';

type Mode = 'url' | 'paste';

const CUISINES = ['Italian', 'Japanese', 'Mexican', 'Chinese', 'Thai', 'American', 'Other'];
const MEAL_TYPES = ['Breakfast', 'Lunch', 'Dinner', 'Dessert', 'Snack'];

export function Import() {
  const navigate = useNavigate();
  const toast = useToast();

  const [mode, setMode] = useState<Mode>('url');
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [result, setResult] = useState<ImportResponse | null>(null);
  const [draft, setDraft] = useState<RecipeDraft | null>(null);
  const [cuisine, setCuisine] = useState('Other');
  const [mealType, setMealType] = useState('Dinner');
  const [minutes, setMinutes] = useState('30');

  const { data: caps } = useQuery({
    queryKey: ['import-capabilities'],
    queryFn: () => api.get<{ url_import: boolean; ai_import: boolean }>('/import/capabilities'),
  });

  const receive = (r: ImportResponse) => {
    setResult(r);
    setDraft(r.draft);
    setError(null);
    if (r.draft.total_minutes) setMinutes(String(r.draft.total_minutes));
  };

  const runImport = useMutation({
    mutationFn: () =>
      mode === 'url'
        ? api.post<ImportResponse>('/import/url', { url: url.trim() })
        : api.post<ImportResponse>('/import/text', { text }),
    onSuccess: receive,
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not read that.'),
  });

  const save = useMutation({
    mutationFn: () => {
      if (!draft) throw new Error('nothing to save');
      return api.post<{ id: number }>('/meals', {
        name: draft.title.trim(),
        cuisine,
        meal_type: mealType,
        time_minutes: Number(minutes) || 30,
        serves: draft.servings ?? undefined,
        description: draft.description,
        steps: draft.steps,
        photo_url: draft.image_url ?? undefined,
        // Imported recipes stay private by default: they're someone else's
        // work, and republishing them is the user's call, not a side effect.
        visibility: 'personal',
        source_url: draft.source_url ?? undefined,
        source_name: draft.source_name ?? undefined,
        import_id: result?.import_id,
        ingredients: draft.ingredients.map((i) => ({
          ingredient_id: i.matched_ingredient_id ?? undefined,
          name: i.name,
          amount: i.amount ?? undefined,
          unit: i.unit ?? undefined,
          note: i.note ?? undefined,
        })),
      });
    },
    onSuccess: (r) => {
      toast('Saved to your cookbook');
      navigate(`/meals/${r.id}`);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not save that.'),
  });

  const patchIngredient = (idx: number, patch: Partial<DraftIngredient>) => {
    setDraft((d) =>
      d ? { ...d, ingredients: d.ingredients.map((it, i) => (i === idx ? { ...it, ...patch } : it)) } : d,
    );
  };

  const removeIngredient = (idx: number) =>
    setDraft((d) => (d ? { ...d, ingredients: d.ingredients.filter((_, i) => i !== idx) } : d));

  const patchStep = (idx: number, value: string) =>
    setDraft((d) => (d ? { ...d, steps: d.steps.map((s, i) => (i === idx ? value : s)) } : d));

  const removeStep = (idx: number) =>
    setDraft((d) => (d ? { ...d, steps: d.steps.filter((_, i) => i !== idx) } : d));

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate(-1)} aria-label="Back">
          <ChevronLeft size={18} strokeWidth={2.2} />
        </button>
        <h1 className={styles.title}>Import a recipe</h1>
      </div>

      {!draft && (
        <>
          <div className={styles.modeRow}>
            <Segmented
              value={mode}
              fill
              onChange={(m) => {
                setMode(m);
                setError(null);
              }}
              options={[
                { value: 'url', label: 'From a link' },
                { value: 'paste', label: 'Paste text' },
              ]}
            />
          </div>

          {mode === 'url' ? (
            <>
              <p className={styles.lede}>
                Paste a recipe page's address. Sites that publish structured recipe data are read
                automatically.
              </p>
              <input
                className={styles.input}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/recipes/tomato-soup"
                inputMode="url"
                autoCapitalize="off"
                autoCorrect="off"
                onKeyDown={(e) => e.key === 'Enter' && url.trim() && runImport.mutate()}
              />
              <p className={styles.hint}>
                Some big recipe sites block automated readers. If a link is refused, open it, copy
                the recipe, and use <strong>Paste text</strong> instead.
              </p>
            </>
          ) : (
            <>
              <p className={styles.lede}>
                Paste anything — a recipe from a blog, a screenshot's text, a note. Ingredient lines
                and steps are worked out from the layout.
              </p>
              <textarea
                className={styles.textarea}
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={12}
                placeholder={
                  'Tomato Pasta\n\nIngredients\n400 g spaghetti\n2 cloves garlic\n1 can chopped tomatoes\n\nMethod\n1. Boil the pasta.\n2. Fry the garlic.'
                }
              />
              {caps && !caps.ai_import && (
                <p className={styles.hint}>
                  Reading messy or handwritten recipes needs the AI importer, which isn't switched
                  on yet. Until then this uses layout rules — check the result before saving.
                </p>
              )}
            </>
          )}

          {error && <p className={styles.error}>{error}</p>}

          <button
            className={styles.primary}
            disabled={runImport.isPending || (mode === 'url' ? !url.trim() : !text.trim())}
            onClick={() => runImport.mutate()}
          >
            {runImport.isPending ? 'Reading…' : 'Read recipe'}
          </button>
        </>
      )}

      {draft && result && (
        <>
          <div className={styles.banner}>
            Found <strong>{draft.ingredients.length}</strong> ingredients and{' '}
            <strong>{draft.steps.length}</strong> steps.{' '}
            {result.total_count > 0 && (
              <>
                {result.matched_count} of {result.total_count} matched a catalog page — the rest are
                kept as written.
              </>
            )}
          </div>

          <label className={styles.label}>Name</label>
          <input
            className={styles.input}
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />

          <div className={styles.metaRow}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <label className={styles.label}>Cuisine</label>
              <select className={styles.select} value={cuisine} onChange={(e) => setCuisine(e.target.value)}>
                {CUISINES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <label className={styles.label}>Meal</label>
              <select className={styles.select} value={mealType} onChange={(e) => setMealType(e.target.value)}>
                {MEAL_TYPES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
            <div style={{ width: 92 }}>
              <label className={styles.label}>Minutes</label>
              <input
                className={styles.input}
                value={minutes}
                inputMode="numeric"
                onChange={(e) => setMinutes(e.target.value.replace(/\D/g, ''))}
              />
            </div>
          </div>

          <label className={styles.label}>Ingredients</label>
          <div className={styles.list}>
            {draft.ingredients.map((ing, i) => (
              <div key={i} className={styles.ingRow}>
                <input
                  className={styles.amt}
                  value={ing.amount ?? ''}
                  placeholder="—"
                  inputMode="decimal"
                  onChange={(e) =>
                    patchIngredient(i, {
                      amount: e.target.value === '' ? null : Number(e.target.value),
                    })
                  }
                />
                <input
                  className={styles.unit}
                  value={ing.unit ?? ''}
                  placeholder="unit"
                  onChange={(e) => patchIngredient(i, { unit: e.target.value || null })}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <input
                    className={styles.name}
                    value={ing.name}
                    onChange={(e) => patchIngredient(i, { name: e.target.value })}
                  />
                  <div className={styles.ingMeta}>
                    {ing.matched_name ? (
                      <span className={styles.matched}>✓ {ing.matched_name}</span>
                    ) : (
                      <span className={styles.unmatched}>kept as written</span>
                    )}
                    {ing.note && <span className={styles.noteChip}>{ing.note}</span>}
                  </div>
                </div>
                <button className={styles.rowX} onClick={() => removeIngredient(i)} aria-label="Remove">
                  ×
                </button>
              </div>
            ))}
          </div>

          <label className={styles.label}>Steps</label>
          <div className={styles.list}>
            {draft.steps.map((s, i) => (
              <div key={i} className={styles.stepRow}>
                <span className={styles.stepNum}>{i + 1}</span>
                <textarea
                  className={styles.stepText}
                  value={s}
                  rows={2}
                  onChange={(e) => patchStep(i, e.target.value)}
                />
                <button className={styles.rowX} onClick={() => removeStep(i)} aria-label="Remove">
                  ×
                </button>
              </div>
            ))}
          </div>

          {draft.source_name && (
            <p className={styles.hint}>
              From <strong>{draft.source_name}</strong>. Saved privately to your cookbook with a link
              back to the original.
            </p>
          )}

          {error && <p className={styles.error}>{error}</p>}

          <div className={styles.actions}>
            <button
              className={styles.secondary}
              onClick={() => {
                setDraft(null);
                setResult(null);
                setError(null);
              }}
            >
              Start over
            </button>
            <button
              className={styles.primary}
              disabled={save.isPending || !draft.title.trim()}
              onClick={() => save.mutate()}
            >
              {save.isPending ? 'Saving…' : 'Save to cookbook'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
