import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast/ToastContext';
import { ChevronLeft, CameraIcon, ShareIcon, PlayIcon } from '../components/Icon/Icon';
import { mealBackground, ingredientBackground } from '../lib/imagery';
import { pickImage } from '../lib/photo';
import styles from './MealDetail.module.css';

interface MealIngredient {
  ingredient_id: number;
  name: string;
  category: string;
  qty: string | null;
  in_fridge: boolean;
}

interface MealDetailData {
  id: number;
  name: string;
  author_id: number;
  author_name: string;
  cuisine: string;
  meal_type: string;
  time_minutes: number;
  rating: number;
  rating_count: number;
  photo_url: string | null;
  description: string;
  steps: string[];
  serves: string | null;
  visibility: string;
  ingredients: MealIngredient[];
  is_cooked: boolean;
  is_saved: boolean;
  your_rating: number | null;
}

interface RelatedMeal {
  id: number;
  name: string;
  cuisine: string;
  rating: number;
  photo_url: string | null;
}

interface JournalEntry {
  id: number;
  note: string | null;
  score: number | null;
  cooked_at: string;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function MealDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [showPrompt, setShowPrompt] = useState(params.get('justCooked') === '1');
  const [note, setNote] = useState('');

  const { data: meal, isLoading } = useQuery({
    queryKey: ['meal', id],
    queryFn: () => api.get<MealDetailData>(`/meals/${id}`),
    enabled: Boolean(id),
  });

  const { data: related = [] } = useQuery({
    queryKey: ['meals-related', meal?.cuisine, id],
    queryFn: () =>
      api.get<RelatedMeal[]>(`/meals?cuisine=${encodeURIComponent(meal!.cuisine)}&sort=top`),
    enabled: Boolean(meal),
  });

  const { data: journal = [] } = useQuery({
    queryKey: ['meal-journal', id],
    queryFn: () => api.get<JournalEntry[]>(`/meals/${id}/journal`),
    enabled: Boolean(id),
  });

  const invalidateMeal = () => {
    qc.invalidateQueries({ queryKey: ['meal', id] });
    qc.invalidateQueries({ queryKey: ['cookbook-counts'] });
    qc.invalidateQueries({ queryKey: ['cookbook'] });
  };

  const save = useMutation({
    mutationFn: () => api.post<{ saved: boolean }>(`/meals/${id}/save`),
    onSuccess: (res) => {
      toast(res.saved ? 'Saved to cook' : 'Removed from saved');
      invalidateMeal();
    },
  });

  const cook = useMutation({
    mutationFn: (body: { note?: string; score?: number }) => api.post(`/meals/${id}/cook`, body),
    onSuccess: () => {
      invalidateMeal();
      qc.invalidateQueries({ queryKey: ['meal-journal', id] });
    },
  });

  const rate = useMutation({
    mutationFn: (value: number) => api.post(`/meals/${id}/rate`, { value }),
    onSuccess: invalidateMeal,
  });

  const addMissing = useMutation({
    mutationFn: (ids: number[]) => api.post('/shopping/many', { ingredient_ids: ids }),
    onSuccess: () => {
      toast('Added to shopping list');
      qc.invalidateQueries({ queryKey: ['shopping'] });
      qc.invalidateQueries({ queryKey: ['cookbook-counts'] });
    },
  });

  const updatePhoto = useMutation({
    mutationFn: (photo_url: string) => api.post(`/meals/${id}/photo`, { photo_url }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['meal', id] });
      qc.invalidateQueries({ queryKey: ['meals'] });
      qc.invalidateQueries({ queryKey: ['feed'] });
    },
  });

  if (isLoading || !meal) return null;

  const missing = meal.ingredients.filter((i) => !i.in_fridge);
  const haveCount = meal.ingredients.length - missing.length;

  function markCooked() {
    cook.mutate({});
    setShowPrompt(true);
  }

  function saveNote() {
    const trimmed = note.trim();
    if (trimmed) cook.mutate({ note: trimmed });
    setShowPrompt(false);
    setNote('');
    params.delete('justCooked');
    setParams(params, { replace: true });
  }

  function skipNote() {
    setShowPrompt(false);
    setNote('');
    params.delete('justCooked');
    setParams(params, { replace: true });
  }

  return (
    <div className={styles.page}>
      <div className={styles.photoHeader} style={{ background: mealBackground(meal.photo_url, meal.cuisine) }}>
        <div className={styles.scrim} />
        <button className={`${styles.actionBtn} ${styles.back}`} onClick={() => navigate(-1)} aria-label="Back">
          <ChevronLeft size={19} strokeWidth={2.2} />
        </button>
        <div className={styles.rightCluster}>
          {meal.author_id === user?.id && (
            <button
              className={styles.actionBtn}
              title="Add your photo"
              onClick={() => pickImage((url) => updatePhoto.mutate(url))}
            >
              <CameraIcon size={18} strokeWidth={1.8} />
            </button>
          )}
          <button
            className={styles.actionBtn}
            title="Share"
            onClick={() => {
              navigator.clipboard?.writeText(window.location.href);
              toast('Link copied');
            }}
          >
            <ShareIcon size={18} strokeWidth={1.8} />
          </button>
        </div>
        <div className={styles.headerCaption}>
          <div className={styles.eyebrow}>
            <span>{meal.cuisine}</span>
            <span>·</span>
            <span>{meal.meal_type}</span>
          </div>
          <div className={styles.title}>{meal.name}</div>
        </div>
      </div>

      <div className={styles.metaLine}>
        {meal.rating > 0 && (
          <span>
            <span className={styles.metaRating}>★ {meal.rating.toFixed(1)}</span>/10
          </span>
        )}
        {meal.rating_count > 0 && <span>{meal.rating_count} ratings</span>}
        <span>{meal.time_minutes} min</span>
        <span>Serves {meal.serves ?? '4'}</span>
      </div>

      <button className={styles.authorChip} onClick={() => navigate(`/chefs/${meal.author_id}`)}>
        <span
          style={{
            width: 34, height: 34, borderRadius: 11, flex: 'none',
            background: 'linear-gradient(145deg,#3F5D46,#2C4131)', color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 15,
          }}
        >
          {meal.author_name.charAt(0).toUpperCase()}
        </span>
        <span className={styles.authorMeta}>
          <span className={styles.authorLabel}>Author</span>
          <span className={styles.authorName}>{meal.author_name}</span>
        </span>
      </button>

      <p className={styles.description}>{meal.description}</p>

      <div className={styles.ratingCard}>
        <div className={styles.ratingScoreRow}>
          <span className={styles.ratingScore}>{meal.rating > 0 ? meal.rating.toFixed(1) : '—'}</span>
          <span className={styles.ratingOf}>/10 overall · {meal.rating_count} ratings</span>
        </div>
        {meal.your_rating != null && (
          <div className={styles.yourRatingPill}>You: {meal.your_rating}/10</div>
        )}
        <div className={styles.rateLabel}>
          {meal.your_rating != null ? 'Tap to update your rating' : 'Rate this meal (1–10)'}
        </div>
        <div className={styles.rateRow}>
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              className={`${styles.rateBtn} ${meal.your_rating != null && n <= meal.your_rating ? styles.rateBtnOn : ''}`}
              onClick={() => rate.mutate(n)}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.toggleRow}>
        <button
          className={`${styles.toggleBtn} ${meal.is_cooked ? styles.cookedOn : ''}`}
          onClick={() => !meal.is_cooked && markCooked()}
        >
          {meal.is_cooked ? 'Cooked' : 'Mark as cooked'}
        </button>
        <button
          className={`${styles.toggleBtn} ${meal.is_saved ? styles.savedOn : ''}`}
          onClick={() => save.mutate()}
        >
          {meal.is_saved ? 'Saved to cook' : 'Want to make'}
        </button>
      </div>

      {showPrompt && (
        <div className={styles.notePrompt}>
          <div className={styles.notePromptTitle}>Nice — how'd it go?</div>
          <textarea
            className={styles.notePromptArea}
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Any notes for next time? (optional)"
          />
          <div className={styles.notePromptRow}>
            <button className={styles.notePromptSkip} onClick={skipNote}>Skip</button>
            <button className={styles.notePromptSave} onClick={saveNote}>Save note</button>
          </div>
        </div>
      )}

      <div className={styles.sectionHeadRow}>
        <h2 className={styles.sectionTitle}>Ingredients</h2>
        <span className={`${styles.haveCounter} ${missing.length === 0 ? styles.counterOk : styles.counterMissing}`}>
          You have {haveCount} of {meal.ingredients.length}
        </span>
      </div>

      <div className={styles.ingChips}>
        {meal.ingredients.map((i) => (
          <button
            key={i.ingredient_id}
            className={`${styles.ingChip} ${!i.in_fridge ? styles.ingChipMissing : ''}`}
            onClick={() => navigate(`/ingredients/${i.ingredient_id}`)}
          >
            <span
              className={styles.ingChipThumb}
              style={{ background: ingredientBackground(null, i.category) }}
            />
            <span className={styles.ingChipName}>{i.name}</span>
            {i.qty && <span className={styles.ingChipQty}>{i.qty}</span>}
            <span className={`${styles.ingChipMark} ${i.in_fridge ? styles.markHave : styles.markMissing}`}>
              {i.in_fridge ? '✓' : '○'}
            </span>
          </button>
        ))}
      </div>

      {missing.length > 0 && (
        <button
          className={styles.addMissingBtn}
          onClick={() => addMissing.mutate(missing.map((m) => m.ingredient_id))}
        >
          + Add {missing.length} missing to shopping list
        </button>
      )}

      <div className={styles.stepsHeadRow}>
        <h2 className={styles.sectionTitle}>Method</h2>
        <button className={styles.cookModeBtn} onClick={() => navigate(`/meals/${id}/cook`)}>
          <PlayIcon size={14} />
          Cook mode
        </button>
      </div>

      <div className={styles.stepList}>
        {meal.steps.map((s, i) => (
          <div key={i} className={styles.stepRow}>
            <span className={styles.stepNum}>{i + 1}</span>
            <span className={styles.stepText}>{s}</span>
          </div>
        ))}
      </div>

      {related.filter((m) => m.id !== meal.id).length > 0 && (
        <>
          <h2 className={styles.relatedTitle}>More {meal.cuisine}</h2>
          <div className={styles.relatedGrid}>
            {related
              .filter((m) => m.id !== meal.id)
              .slice(0, 4)
              .map((m) => (
                <button key={m.id} className={styles.relatedCard} onClick={() => navigate(`/meals/${m.id}`)}>
                  <div
                    className={styles.relatedPhoto}
                    style={{ background: mealBackground(m.photo_url, m.cuisine) }}
                  />
                  <div className={styles.relatedName}>{m.name}</div>
                  <div className={styles.relatedMeta}>
                    <span>{m.cuisine}</span>
                    {m.rating > 0 && <span style={{ color: 'var(--amber)' }}>★{m.rating.toFixed(1)}</span>}
                  </div>
                </button>
              ))}
          </div>
        </>
      )}

      {journal.length > 0 && (
        <>
          <h2 className={styles.journalTitle}>Your cooking notes</h2>
          {journal.map((j) => (
            <div key={j.id} className={styles.journalEntry}>
              <div className={styles.journalDate}>{formatDate(j.cooked_at)}</div>
              <div className={styles.journalNote}>{j.note}</div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
