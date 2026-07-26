import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { IngredientSummary } from '../api/types';
import { useToast } from '../components/Toast/ToastContext';
import { ChevronLeft, SearchIcon } from '../components/Icon/Icon';
import { ingredientBackground } from '../lib/imagery';
import { pickImage } from '../lib/photo';
import styles from './Create.module.css';

const CUISINES = [
  'Italian', 'Japanese', 'Mexican', 'Chinese', 'Thai', 'American', 'French',
  'Indian', 'Korean', 'Vietnamese', 'Greek', 'Spanish', 'Moroccan', 'Lebanese',
];
const MEAL_TYPES = ['Breakfast', 'Lunch', 'Dinner', 'Dessert', 'Snack'];

interface Picked {
  id: number;
  name: string;
  qty: string;
}

export function CreateMeal() {
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();

  const [name, setName] = useState('');
  const [serves, setServes] = useState('');
  const [time, setTime] = useState('');
  const [cuisine, setCuisine] = useState('Italian');
  const [mealType, setMealType] = useState('Dinner');
  const [visibility, setVisibility] = useState<'public' | 'personal'>('public');
  const [picked, setPicked] = useState<Picked[]>([]);
  const [ingQuery, setIngQuery] = useState('');
  const [steps, setSteps] = useState<string[]>(['']);
  const [description, setDescription] = useState('');
  const [rating, setRating] = useState(8);
  const [photo, setPhoto] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: matches = [] } = useQuery({
    queryKey: ['ingredients', ingQuery],
    queryFn: () => api.get<IngredientSummary[]>(`/ingredients?search=${encodeURIComponent(ingQuery)}`),
    enabled: ingQuery.trim().length > 0,
  });

  const create = useMutation({
    mutationFn: (body: unknown) => api.post<{ id: number }>('/meals', body),
    onSuccess: (res) => {
      toast('Published!');
      qc.invalidateQueries({ queryKey: ['cookbook-counts'] });
      qc.invalidateQueries({ queryKey: ['meals'] });
      qc.invalidateQueries({ queryKey: ['feed'] });
      navigate(`/meals/${res.id}`, { replace: true });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not publish that meal.'),
  });

  function togglePick(i: IngredientSummary) {
    setPicked((prev) =>
      prev.some((p) => p.id === i.id)
        ? prev.filter((p) => p.id !== i.id)
        : [...prev, { id: i.id, name: i.name, qty: '' }],
    );
  }

  function submit() {
    setError(null);
    const trimmed = name.trim();
    const realSteps = steps.map((s) => s.trim()).filter(Boolean);
    const minutes = parseInt(time, 10);

    if (!trimmed) return setError('Please name your meal.');
    if (picked.length === 0) return setError('Add at least one ingredient.');
    if (realSteps.length === 0) return setError('Add at least one cooking step.');

    create.mutate({
      name: trimmed,
      cuisine,
      meal_type: mealType,
      // The prototype estimates from step count when the field is left blank.
      time_minutes: Number.isFinite(minutes) && minutes > 0 ? minutes : 10 + realSteps.length * 5,
      serves: serves.trim() || '4',
      description: description.trim() || `A homemade ${cuisine} dish.`,
      steps: realSteps,
      ingredients: picked.map((p) => ({ ingredient_id: p.id, qty: p.qty.trim() || null })),
      photo_url: photo || null,
      visibility,
      rating,
    });
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate(-1)} aria-label="Back">
          <ChevronLeft size={18} strokeWidth={2.2} />
        </button>
        <h1 className={styles.title}>New meal</h1>
      </div>

      {photo ? (
        <button
          className={styles.photoFilled}
          style={{ background: `center/cover no-repeat url("${photo}")` }}
          onClick={() => pickImage(setPhoto)}
        >
          <span className={styles.photoBadge}>Change photo</span>
        </button>
      ) : (
        <button className={styles.photoDrop} onClick={() => pickImage(setPhoto)}>
          <span>Take or upload a photo</span>
        </button>
      )}

      <div className={styles.field}>
        <label className={styles.label}>Meal name</label>
        <input
          className={styles.input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Roasted Tomato Soup"
        />
      </div>

      <div className={`${styles.field} ${styles.twoCol}`}>
        <div>
          <label className={styles.label}>Serves</label>
          <input
            className={`${styles.input} ${styles.inputSm}`}
            value={serves}
            onChange={(e) => setServes(e.target.value)}
            placeholder="4"
            inputMode="numeric"
          />
        </div>
        <div>
          <label className={styles.label}>Total time (min)</label>
          <input
            className={`${styles.input} ${styles.inputSm}`}
            value={time}
            onChange={(e) => setTime(e.target.value)}
            placeholder="e.g. 30"
            inputMode="numeric"
          />
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.label}>Cuisine</label>
        <div className={styles.chipRow}>
          {CUISINES.map((c) => (
            <button
              key={c}
              className={`${styles.chip} ${cuisine === c ? styles.chipActive : ''}`}
              onClick={() => setCuisine(c)}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.label}>Meal type</label>
        <div className={styles.chipRow}>
          {MEAL_TYPES.map((t) => (
            <button
              key={t}
              className={`${styles.chip} ${mealType === t ? styles.chipActive : ''}`}
              onClick={() => setMealType(t)}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.label}>Visibility</label>
        <div className={styles.segToggle}>
          <button
            className={visibility === 'public' ? styles.segActive : ''}
            onClick={() => setVisibility('public')}
          >
            Public
          </button>
          <button
            className={visibility === 'personal' ? styles.segActive : ''}
            onClick={() => setVisibility('personal')}
          >
            Personal
          </button>
        </div>
        <p className={styles.visHint}>
          {visibility === 'public'
            ? 'Anyone can discover this meal in Browse & search.'
            : 'Stays private in your Cookbook only — won’t appear in Browse or search.'}
        </p>
      </div>

      <div className={styles.pickerHead}>
        <label className={styles.label} style={{ marginBottom: 0 }}>Ingredients</label>
        <span className={styles.pickerCount}>{picked.length} selected</span>
      </div>

      {picked.length === 0 ? (
        <p className={styles.helper} style={{ marginTop: 0, marginBottom: 10 }}>
          No ingredients added yet — search below.
        </p>
      ) : (
        <div className={styles.selectedList}>
          {picked.map((p) => (
            <div key={p.id} className={styles.selectedRow}>
              <span className={styles.selectedName}>{p.name}</span>
              <input
                className={styles.qtyInput}
                value={p.qty}
                placeholder="qty e.g. 200g"
                onChange={(e) =>
                  setPicked((prev) =>
                    prev.map((x) => (x.id === p.id ? { ...x, qty: e.target.value } : x)),
                  )
                }
              />
              <button
                className={styles.removeCircle}
                onClick={() => setPicked((prev) => prev.filter((x) => x.id !== p.id))}
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
            const on = picked.some((p) => p.id === m.id);
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

      <button className={styles.crossLink} onClick={() => navigate('/create/ingredient')}>
        + Missing one? Create an ingredient page
      </button>

      <div className={styles.field}>
        <label className={styles.label}>Cooking steps</label>
        <div className={styles.steps}>
          {steps.map((s, i) => (
            <div key={i} className={styles.step}>
              <span className={styles.stepNum}>{i + 1}</span>
              <textarea
                className={styles.stepInput}
                rows={2}
                value={s}
                placeholder="Describe this step…"
                onChange={(e) =>
                  setSteps((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))
                }
              />
              {steps.length > 1 && (
                <button
                  className={styles.stepRemove}
                  onClick={() => setSteps((prev) => prev.filter((_, j) => j !== i))}
                  aria-label={`Remove step ${i + 1}`}
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
        <button className={styles.addStep} onClick={() => setSteps((p) => [...p, ''])}>
          + Add step
        </button>
      </div>

      <div className={styles.field}>
        <label className={styles.label}>Description</label>
        <textarea
          className={styles.textarea}
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Tell the story of this dish…"
        />
      </div>

      <div className={styles.ratingHead}>
        <label className={styles.label} style={{ marginBottom: 0 }}>Rating</label>
        <span className={styles.ratingValue}>{rating} / 10</span>
      </div>
      <div className={styles.ratingRow}>
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            className={`${styles.rateBtn} ${n <= rating ? styles.rateBtnOn : ''}`}
            onClick={() => setRating(n)}
          >
            {n}
          </button>
        ))}
      </div>

      {error && <p className={styles.error}>{error}</p>}

      <button className={styles.submit} onClick={submit} disabled={create.isPending}>
        {create.isPending ? 'Publishing…' : 'Publish meal'}
      </button>
    </div>
  );
}
