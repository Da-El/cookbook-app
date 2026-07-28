import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { IngredientDetail as Detail, Micros } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast/ToastContext';
import { ChevronLeft } from '../components/Icon/Icon';
import {
  CategoryEditSection,
  DietFlagsEditSection,
  NutritionEditSection,
  PhotoEditSection,
  TextEditSection,
} from '../components/EditVoting/EditVoting';
import { AliasSection } from '../components/EditVoting/AliasSection';
import { SubstituteSection } from '../components/EditVoting/SubstituteSection';
import { LoadingState, ErrorState } from '../components/PageState/PageState';
import { Avatar } from '../components/Avatar/Avatar';
import { ContributorBadge, type ContributorTier } from '../components/ContributorBadge/ContributorBadge';
import { ingredientBackground } from '../lib/imagery';
import styles from './IngredientDetail.module.css';

interface IngredientReview {
  id: number;
  user_id: number;
  author_name: string;
  avatar_theme: 'green' | 'terracotta' | 'navy' | 'plum';
  avatar_photo_url: string | null;
  score: number | null;
  note: string | null;
  created_at: string;
  edited_at: string | null;
  helpful_count: number;
  your_helpful_vote: boolean;
  author_tier: ContributorTier;
}

function relativeTime(iso: string) {
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days < 1) return 'today';
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

// FDA daily values (mg) - drives the %DV bars.
const DV: Record<keyof Micros, { label: string; dv: number }> = {
  vit_c_mg: { label: 'Vitamin C', dv: 90 },
  calcium_mg: { label: 'Calcium', dv: 1300 },
  iron_mg: { label: 'Iron', dv: 18 },
  potassium_mg: { label: 'Potassium', dv: 4700 },
  magnesium_mg: { label: 'Magnesium', dv: 420 },
  sodium_mg: { label: 'Sodium', dv: 2300 },
};

interface UsedInMeal {
  id: number;
  name: string;
  cuisine: string;
  can_make: boolean;
}

export function IngredientDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const toast = useToast();
  const [note, setNote] = useState('');
  const [score, setScore] = useState<number | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['ingredient', id],
    queryFn: () => api.get<Detail>(`/ingredients/${id}`),
    enabled: Boolean(id),
    // See MealDetail's identical policy: a 404 here is permanent, so retrying
    // it only delays the "not found" state without any chance of succeeding.
    retry: (failureCount, err) => {
      if (err instanceof ApiError) return false;
      return failureCount < 2;
    },
  });

  const { data: usedIn = [] } = useQuery({
    queryKey: ['ingredient-used-in', id],
    queryFn: () => api.get<UsedInMeal[]>(`/ingredients/${id}/used-in`),
    enabled: Boolean(id),
  });

  const { data: reviews = [] } = useQuery({
    queryKey: ['ingredient-reviews', id],
    queryFn: () => api.get<IngredientReview[]>(`/ingredients/${id}/reviews`),
    enabled: Boolean(id),
  });

  const submitReview = useMutation({
    mutationFn: () => api.post(`/ingredients/${id}/reviews`, { score, note: note.trim() || null }),
    onSuccess: () => {
      setNote('');
      qc.invalidateQueries({ queryKey: ['ingredient-reviews', id] });
      qc.invalidateQueries({ queryKey: ['ingredient', id] });
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not save that.'),
  });

  const voteHelpful = useMutation({
    mutationFn: (reviewId: number) => api.post(`/ingredients/${id}/reviews/${reviewId}/helpful`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ingredient-reviews', id] }),
  });

  if (isLoading) return <LoadingState label="Loading ingredient…" />;
  if (isError || !data) {
    const notFound = error instanceof ApiError && error.status === 404;
    return notFound ? (
      <ErrorState
        title="This ingredient isn't here"
        text="It may have been removed, or the link is wrong."
        actionLabel="Back to Browse"
        onAction={() => navigate('/browse')}
      />
    ) : (
      <ErrorState
        title="Couldn't load this ingredient"
        text="The connection may have dropped. Try again."
        actionLabel="Try again"
        onAction={() => refetch()}
      />
    );
  }

  const n = data.nutrition;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate(-1)} aria-label="Back">
          <ChevronLeft size={18} strokeWidth={2.2} />
        </button>
        <button
          className={styles.compareBtn}
          onClick={() => navigate(`/compare?ids=${data.id}`)}
        >
          ⚖ Compare
        </button>
      </div>

      <div className={styles.photo} style={{ background: ingredientBackground(data.photo_url, data.category) }} />

      <h1 className={styles.name}>{data.name}</h1>

      {data.rating_count > 0 && (
        <div className={styles.ratingSummary}>
          <span className={styles.ratingStar}>★ {data.rating.toFixed(1)}</span>
          <span className={styles.ratingCount}>
            {data.rating_count} rating{data.rating_count === 1 ? '' : 's'}
          </span>
        </div>
      )}

      <div className={styles.chips}>
        <span className={styles.tag}>{data.category}</span>
        {data.food_group && <span className={styles.tag}>{data.food_group}</span>}
        {data.food_subgroup && <span className={styles.tag}>{data.food_subgroup}</span>}
        {n && <span className={`${styles.tag} ${styles.source}`}>{n.source}</span>}
      </div>

      {data.diet_flags.length > 0 && (
        <div className={styles.chips} style={{ marginTop: 6 }}>
          {data.diet_flags.map((f) => (
            <span key={f} className={`${styles.tag} ${styles.dietFlag}`}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </span>
          ))}
        </div>
      )}

      {data.description ? (
        <p className={styles.desc}>{data.description}</p>
      ) : (
        <p className={styles.desc} style={{ color: 'var(--muted-2)', fontStyle: 'italic' }}>
          No description yet — be the first to suggest one below.
        </p>
      )}

      {user && (
        <div className={styles.card}>
          <p className={styles.sectionTitle}>Rate it</p>
          <div className={styles.rateRow}>
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n2) => (
              <button
                key={n2}
                className={`${styles.rateBtn} ${score === n2 ? styles.rateBtnOn : ''}`}
                onClick={() => setScore(n2)}
                aria-pressed={score === n2}
                aria-label={`Rate ${n2} out of 10`}
              >
                {n2}
              </button>
            ))}
          </div>
          <textarea
            className={styles.reviewInput}
            placeholder="Add a note about how you use it (optional)…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
          />
          <button
            className={styles.reviewSubmit}
            disabled={(score === null && !note.trim()) || submitReview.isPending}
            onClick={() => submitReview.mutate()}
          >
            {submitReview.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}

      {reviews.length > 0 && (
        <div className={styles.card}>
          <p className={styles.sectionTitle}>Reviews</p>
          <div className={styles.reviewList}>
            {reviews.map((r) => (
              <div key={r.id} className={styles.reviewRow}>
                <Avatar
                  name={r.author_name}
                  photoUrl={r.avatar_photo_url}
                  theme={r.avatar_theme}
                  size="sm"
                  shape="rounded"
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className={styles.reviewHead}>
                    <span className={styles.reviewAuthor}>{r.author_name}</span>
                    <ContributorBadge tier={r.author_tier} />
                    {r.score != null && <span className={styles.reviewStars}>★ {r.score}/10</span>}
                    <span className={styles.reviewWhen}>
                      {relativeTime(r.created_at)}
                      {r.edited_at && ' (edited)'}
                    </span>
                  </div>
                  {r.note && <p className={styles.reviewNote}>{r.note}</p>}
                  <button
                    className={`${styles.helpfulBtn} ${r.your_helpful_vote ? styles.helpfulBtnOn : ''}`}
                    onClick={() => voteHelpful.mutate(r.id)}
                    aria-pressed={r.your_helpful_vote}
                  >
                    👍 Helpful{r.helpful_count > 0 ? ` (${r.helpful_count})` : ''}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={styles.card}>
        <p className={styles.sectionTitle}>Community</p>
        <TextEditSection
          ingredientId={data.id}
          field="description"
          label="Description"
          placeholder="Rewrite the description…"
        />
        <CategoryEditSection ingredientId={data.id} />
        <DietFlagsEditSection ingredientId={data.id} />
        <PhotoEditSection ingredientId={data.id} />
        <NutritionEditSection ingredientId={data.id} />
        <AliasSection ingredientId={data.id} />
        <SubstituteSection ingredientId={data.id} />
      </div>

      {n && (
        <div className={styles.card}>
          <p className={styles.sectionTitle}>Nutrition facts</p>
          <p className={styles.serving}>Per {n.serving_size}</p>

          <div className={styles.macros}>
            <Macro value={n.calories} label="Cal" />
            <Macro value={n.protein} label="Protein" unit="g" />
            <Macro value={n.carbs} label="Carbs" unit="g" />
            <Macro value={n.fat} label="Fat" unit="g" />
            <Macro value={n.fiber} label="Fiber" unit="g" />
            <Macro value={n.sugar} label="Sugars" unit="g" />
          </div>

          <p className={styles.sectionTitle}>Micronutrients</p>
          {(Object.keys(DV) as (keyof Micros)[]).map((key) => {
            const value = n.micros[key];
            if (value === null) return null;
            const { label, dv } = DV[key];
            const pct = Math.min(100, Math.round((value / dv) * 100));
            return (
              <div key={key} className={styles.micro}>
                <div className={styles.microHead}>
                  <span className={styles.microName}>{label}</span>
                  <span className={styles.microVal}>
                    {value} mg · {pct}%
                  </span>
                </div>
                <div className={styles.track}>
                  <div className={styles.fill} style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {usedIn.length > 0 && (
        <>
          <h2 className={styles.usedTitle}>Used in {usedIn.length} meal{usedIn.length === 1 ? '' : 's'}</h2>
          <div className={styles.usedList}>
            {usedIn.map((m) => (
              <button key={m.id} className={styles.usedRow} onClick={() => navigate(`/meals/${m.id}`)}>
                <span
                  className={styles.usedThumb}
                  style={{ background: ingredientBackground(null, data.category) }}
                />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className={styles.usedName} style={{ display: 'block' }}>{m.name}</span>
                  <span style={{ color: 'var(--muted-2)', fontSize: 12.5, fontWeight: 500 }}>{m.cuisine}</span>
                </span>
                {m.can_make && <span className={styles.usedDot} title="You can make this" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Macro({ value, label, unit = '' }: { value: number | null; label: string; unit?: string }) {
  return (
    <div className={styles.macro}>
      <div className={styles.macroValue}>
        {value ?? '—'}
        {value !== null && unit}
      </div>
      <div className={styles.macroLabel}>{label}</div>
    </div>
  );
}
