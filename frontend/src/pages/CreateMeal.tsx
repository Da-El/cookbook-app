import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { useToast } from '../components/Toast/ToastContext';
import { ChevronLeft } from '../components/Icon/Icon';
import { emptyMealForm, mealFormError, toIngredientPayload, MealForm } from './MealForm';
import styles from './Create.module.css';

export function CreateMeal() {
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();

  const [form, setForm] = useState(emptyMealForm());
  const [rating, setRating] = useState(8);
  const [error, setError] = useState<string | null>(null);

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

  function submit() {
    const err = mealFormError(form);
    if (err) return setError(err);
    setError(null);

    const realSteps = form.steps.map((s) => s.trim()).filter(Boolean);
    const minutes = parseInt(form.time, 10);

    create.mutate({
      name: form.name.trim(),
      cuisine: form.cuisine,
      meal_type: form.mealType,
      // Matches the design prototype: estimate from step count when left blank.
      time_minutes: Number.isFinite(minutes) && minutes > 0 ? minutes : 10 + realSteps.length * 5,
      serves: form.serves.trim() || '4',
      description: form.description.trim() || `A homemade ${form.cuisine} dish.`,
      steps: realSteps,
      ingredients: toIngredientPayload(form.picked),
      photo_url: form.photo || null,
      visibility: form.visibility,
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

      <MealForm value={form} onChange={setForm} />

      <div className={styles.ratingHead}>
        <label className={styles.label} style={{ marginBottom: 0 }}>Your rating</label>
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
