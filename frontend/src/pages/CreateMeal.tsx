import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { useToast } from '../components/Toast/ToastContext';
import { ChevronLeft } from '../components/Icon/Icon';
import { emptyMealForm, mealFormError, toIngredientPayload, MealForm, type MealFormValue } from './MealForm';
import { RatingInput } from '../components/RatingInput/RatingInput';
import styles from './Create.module.css';

const DRAFT_KEY = 'cb-meal-draft';

interface MealDraft {
  form: MealFormValue;
  rating: number;
  savedAt: string;
}

/** A blank form isn't worth remembering - only draft state once the user has
 * actually put something into it, so a fresh visit never nags with a "resume
 * draft?" prompt for a form nobody touched. */
function hasContent(f: MealFormValue): boolean {
  return Boolean(
    f.name.trim() ||
      f.description.trim() ||
      f.photo ||
      f.picked.length > 0 ||
      f.steps.some((s) => s.trim()),
  );
}

function loadDraft(): MealDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as MealDraft) : null;
  } catch {
    return null;
  }
}

function relativeSavedTime(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function CreateMeal() {
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();

  const [pendingDraft, setPendingDraft] = useState(() => loadDraft());
  const [form, setForm] = useState(emptyMealForm());
  const [rating, setRating] = useState(8);
  const [error, setError] = useState<string | null>(null);

  // Autosave: any real content in the form gets mirrored to localStorage so
  // a closed tab or a crashed browser doesn't lose an in-progress recipe.
  // Clearing the form back to empty clears the saved draft too, rather than
  // leaving a stale one behind that would resurrect itself later.
  useEffect(() => {
    if (pendingDraft) return; // don't overwrite the draft while its prompt is still up
    if (hasContent(form)) {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ form, rating, savedAt: new Date().toISOString() }));
    } else {
      localStorage.removeItem(DRAFT_KEY);
    }
  }, [form, rating, pendingDraft]);

  function resumeDraft() {
    if (!pendingDraft) return;
    setForm(pendingDraft.form);
    setRating(pendingDraft.rating);
    setPendingDraft(null);
  }

  function discardDraft() {
    localStorage.removeItem(DRAFT_KEY);
    setPendingDraft(null);
  }

  const create = useMutation({
    mutationFn: (body: unknown) => api.post<{ id: number }>('/meals', body),
    onSuccess: (res) => {
      localStorage.removeItem(DRAFT_KEY);
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
      photos: form.photos,
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

      {pendingDraft && hasContent(pendingDraft.form) && (
        <div className={styles.draftBanner}>
          <div>
            <div className={styles.draftBannerTitle}>Resume your draft?</div>
            <div className={styles.draftBannerSub}>
              You have an unfinished recipe from {relativeSavedTime(pendingDraft.savedAt)}.
            </div>
          </div>
          <div className={styles.draftBannerActions}>
            <button className={styles.draftDiscard} onClick={discardDraft}>Discard</button>
            <button className={styles.draftResume} onClick={resumeDraft}>Resume</button>
          </div>
        </div>
      )}

      <MealForm value={form} onChange={setForm} />

      <div className={styles.ratingHead}>
        <label className={styles.label} style={{ marginBottom: 0 }}>Your rating</label>
        <span className={styles.ratingValue}>{rating} / 10</span>
      </div>
      <div className={styles.ratingRow}>
        <RatingInput value={rating} onChange={setRating} label="Your rating from 1 to 10" />
      </div>

      {error && <p className={styles.error}>{error}</p>}

      <button className={styles.submit} onClick={submit} disabled={create.isPending}>
        {create.isPending ? 'Publishing…' : 'Publish meal'}
      </button>
    </div>
  );
}
