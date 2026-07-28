import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { useToast } from '../components/Toast/ToastContext';
import { ChevronLeft } from '../components/Icon/Icon';
import { mealFormError, toIngredientPayload, MealForm, type MealFormValue } from './MealForm';
import styles from './Create.module.css';

interface EditableMeal {
  id: number;
  author_id: number;
  name: string;
  cuisine: string;
  meal_type: string;
  time_minutes: number;
  serves: string | null;
  description: string;
  steps: string[];
  photo_url: string | null;
  visibility: string;
  ingredients: { ingredient_id: number | null; name: string; amount: number | null; unit: string | null }[];
}

function toForm(m: EditableMeal): MealFormValue {
  return {
    name: m.name,
    serves: m.serves ?? '',
    time: String(m.time_minutes),
    cuisine: m.cuisine,
    mealType: m.meal_type,
    visibility: m.visibility === 'personal' ? 'personal' : 'public',
    picked: m.ingredients.map((i, idx) => ({
      key: `existing-${idx}`,
      id: i.ingredient_id,
      name: i.name,
      amount: i.amount != null ? String(i.amount) : '',
      unit: i.unit ?? '',
    })),
    steps: m.steps.length > 0 ? m.steps : [''],
    description: m.description,
    photo: m.photo_url ?? '',
  };
}

export function EditMeal() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();

  const [form, setForm] = useState<MealFormValue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const { data: meal, isLoading } = useQuery({
    queryKey: ['meal-edit', id],
    queryFn: () => api.get<EditableMeal>(`/meals/${id}`),
    enabled: Boolean(id),
  });

  // Seeded once when the meal loads; the form is uncontrolled by the query
  // after that, exactly like any other edit form - refetching mid-edit
  // shouldn't stomp on what the user is typing.
  useEffect(() => {
    if (meal && !form) setForm(toForm(meal));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meal]);

  const invalidateAfter = () => {
    qc.invalidateQueries({ queryKey: ['meal', id] });
    qc.invalidateQueries({ queryKey: ['meal-revisions', id] });
    qc.invalidateQueries({ queryKey: ['meals'] });
    qc.invalidateQueries({ queryKey: ['feed'] });
    qc.invalidateQueries({ queryKey: ['cookbook'] });
  };

  const save = useMutation({
    mutationFn: (body: unknown) => api.post(`/meals/${id}`, body),
    onSuccess: () => {
      toast('Changes saved');
      invalidateAfter();
      navigate(`/meals/${id}`, { replace: true });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not save that change.'),
  });

  const remove = useMutation({
    mutationFn: () => api.del(`/meals/${id}`),
    onSuccess: () => {
      toast('Meal deleted');
      invalidateAfter();
      qc.invalidateQueries({ queryKey: ['cookbook-counts'] });
      navigate('/cookbook', { replace: true });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not delete that meal.'),
  });

  if (isLoading || !meal || !form) return null;

  function submit() {
    const f = form!;
    const err = mealFormError(f);
    if (err) return setError(err);
    setError(null);

    const realSteps = f.steps.map((s) => s.trim()).filter(Boolean);
    const minutes = parseInt(f.time, 10);

    save.mutate({
      name: f.name.trim(),
      cuisine: f.cuisine,
      meal_type: f.mealType,
      time_minutes: Number.isFinite(minutes) && minutes > 0 ? minutes : 10 + realSteps.length * 5,
      serves: f.serves.trim() || '4',
      description: f.description.trim(),
      steps: realSteps,
      ingredients: toIngredientPayload(f.picked),
      photo_url: f.photo || null,
      visibility: f.visibility,
    });
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate(-1)} aria-label="Back">
          <ChevronLeft size={18} strokeWidth={2.2} />
        </button>
        <h1 className={styles.title}>Edit meal</h1>
      </div>

      <button
        className={styles.crossLink}
        style={{ marginTop: 10 }}
        onClick={() => navigate(`/meals/${id}/history`)}
      >
        View edit history
      </button>

      <MealForm value={form} onChange={setForm} />

      {error && <p className={styles.error}>{error}</p>}

      <button className={styles.submit} onClick={submit} disabled={save.isPending}>
        {save.isPending ? 'Saving…' : 'Save changes'}
      </button>

      <div className={styles.dupCard} style={{ marginTop: 28, borderColor: '#E0A69A', background: '#FBEFEC' }}>
        <div className={styles.dupTitle}>Delete this meal</div>
        <div className={styles.dupSub}>
          Removed from Browse, search and everyone's Cookbook. Nothing is erased outright — it can
          be restored from the edit history if you change your mind.
        </div>
        {!confirmingDelete ? (
          <button
            className={styles.dupSecondary}
            style={{ width: '100%', marginTop: 12 }}
            onClick={() => setConfirmingDelete(true)}
          >
            Delete meal
          </button>
        ) : (
          <div className={styles.dupRow}>
            <button className={styles.dupSecondary} onClick={() => setConfirmingDelete(false)}>
              Cancel
            </button>
            <button
              className={styles.dupPrimary}
              style={{ background: '#B8433A' }}
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              {remove.isPending ? 'Deleting…' : 'Yes, delete it'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
