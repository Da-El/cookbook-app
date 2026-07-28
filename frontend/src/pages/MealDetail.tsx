import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast/ToastContext';
import { ChevronLeft, CameraIcon, ShareIcon, PlayIcon, PencilIcon, ForkIcon, CopyIcon, PrintIcon } from '../components/Icon/Icon';
import { Avatar } from '../components/Avatar/Avatar';
import { LoadingState, ErrorState } from '../components/PageState/PageState';
import { FlagButton } from '../components/Flag/FlagButton';
import { ContributorBadge, type ContributorTier } from '../components/ContributorBadge/ContributorBadge';
import { ReviewReplies } from '../components/ReviewReplies/ReviewReplies';
import { AddToCollection } from '../components/AddToCollection/AddToCollection';
import { mealBackground, ingredientBackground } from '../lib/imagery';
import { pickImage } from '../lib/photo';
import { addRecentlyViewed } from '../lib/recentlyViewed';
import styles from './MealDetail.module.css';

interface MealIngredient {
  // Null for a line an import couldn't match, or one added without a catalog
  // page - it still belongs on the page, it just isn't a link anywhere.
  ingredient_id: number | null;
  name: string;
  category: string;
  amount: number | null;
  unit: string | null;
  qty: string | null;
  in_fridge: boolean;
}

interface NutritionTotals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  sugar: number;
  vit_c_mg: number;
  calcium_mg: number;
  iron_mg: number;
  potassium_mg: number;
  magnesium_mg: number;
  sodium_mg: number;
}

interface MealNutrition {
  per_serving: NutritionTotals;
  total: NutritionTotals;
  servings: number;
  counted: number;
  total_ingredients: number;
}

interface RatingDistribution {
  counts: number[];
  median: number | null;
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
  cook_count: number;
  photo_url: string | null;
  photos: string[];
  description: string;
  steps: string[];
  serves: string | null;
  visibility: string;
  ingredients: MealIngredient[];
  is_cooked: boolean;
  is_saved: boolean;
  your_rating: number | null;
  source_url: string | null;
  source_name: string | null;
  nutrition: MealNutrition;
  rating_distribution: RatingDistribution;
  diet_tags: string[];
  forked_from: { meal_id: number | null; name: string; author_id: number | null; author_name: string } | null;
  can_fork: boolean;
}

/** Mirrors the server's units::format_amount: "2", "1.5", never "2.4999999". */
function formatAmount(v: number): string {
  const r = Math.round(v * 1000) / 1000;
  return Math.abs(r - Math.round(r)) < 0.005 ? String(Math.round(r)) : String(r);
}

interface OccasionTag {
  tag: string;
  label: string;
  votes: number;
  your_vote: boolean;
  applied: boolean;
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

interface MealReview {
  id: number;
  user_id: number;
  author_name: string;
  avatar_theme: 'green' | 'terracotta' | 'navy' | 'plum';
  avatar_photo_url: string | null;
  score: number | null;
  note: string | null;
  cooked_at: string;
  meal_revision_count: number;
  is_current_version: boolean;
  helpful_count: number;
  your_helpful_vote: boolean;
  author_tier: ContributorTier;
  replies: ReviewReply[];
  edited_at: string | null;
}

const REVIEW_SORTS: [string, string][] = [
  ['helpful', 'Most helpful'],
  ['recent', 'Most recent'],
  ['highest', 'Highest rated'],
  ['lowest', 'Lowest rated'],
];

interface ReviewReply {
  id: number;
  review_id: number;
  user_id: number | null;
  author_name: string | null;
  body: string;
  created_at: string;
  parent_reply_id: number | null;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function relativeTime(iso: string) {
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days < 1) return 'today';
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
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
  const [reviewSort, setReviewSort] = useState('helpful');
  const [editingReviewId, setEditingReviewId] = useState<number | null>(null);
  const [editNote, setEditNote] = useState('');
  const [editScore, setEditScore] = useState<number | null>(null);
  // null until the recipe's own serving count is known, so the stepper opens
  // on "however many this recipe actually makes" rather than an arbitrary 4.
  const [cookingFor, setCookingFor] = useState<number | null>(null);

  const { data: meal, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['meal', id],
    queryFn: () => api.get<MealDetailData>(`/meals/${id}`),
    enabled: Boolean(id),
    // A 404 is permanent - retrying it just delays showing the "not found"
    // state for no benefit. Genuine network blips still get a couple of
    // attempts, which the default retry:3 would otherwise also spend on a
    // recipe that was deleted five minutes ago.
    retry: (failureCount, err) => {
      if (err instanceof ApiError) return false;
      return failureCount < 2;
    },
  });

  useEffect(() => {
    if (meal) {
      addRecentlyViewed({
        kind: 'meal',
        id: meal.id,
        name: meal.name,
        subtitle: meal.cuisine,
        photo_url: meal.photo_url,
      });
    }
  }, [meal]);

  const { data: related = [] } = useQuery({
    queryKey: ['meals-related', meal?.cuisine, id],
    queryFn: () =>
      api.get<RelatedMeal[]>(`/meals?cuisine=${encodeURIComponent(meal!.cuisine)}&sort=top`),
    enabled: Boolean(meal),
  });

  const { data: reviews = [] } = useQuery({
    queryKey: ['meal-reviews', id, reviewSort],
    queryFn: () => api.get<MealReview[]>(`/meals/${id}/reviews?sort=${reviewSort}`),
    enabled: Boolean(id),
  });

  const voteHelpful = useMutation({
    mutationFn: (reviewId: number) => api.post(`/meals/${id}/reviews/${reviewId}/helpful`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meal-reviews', id] }),
  });

  const { data: occasions = [] } = useQuery({
    queryKey: ['meal-occasions', id],
    queryFn: () => api.get<OccasionTag[]>(`/meals/${id}/occasions`),
    enabled: Boolean(id),
  });

  const voteOccasion = useMutation({
    mutationFn: (tag: string) => api.post(`/meals/${id}/occasions/${tag}/vote`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meal-occasions', id] }),
  });

  const updateReview = useMutation({
    mutationFn: ({ reviewId, note, score }: { reviewId: number; note: string; score: number | null }) =>
      api.put(`/meals/${id}/reviews/${reviewId}`, { note, score }),
    onSuccess: () => {
      setEditingReviewId(null);
      qc.invalidateQueries({ queryKey: ['meal-reviews', id] });
      invalidateMeal();
    },
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

  const fork = useMutation({
    mutationFn: () => api.post<{ id: number }>(`/meals/${id}/fork`),
    onSuccess: (res) => {
      toast('Forked into your cookbook');
      qc.invalidateQueries({ queryKey: ['cookbook'] });
      navigate(`/meals/${res.id}`);
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not fork that.'),
  });

  const duplicate = useMutation({
    mutationFn: () => api.post<{ id: number }>(`/meals/${id}/duplicate`),
    onSuccess: (res) => {
      toast('Duplicated - editing your copy');
      qc.invalidateQueries({ queryKey: ['cookbook'] });
      qc.invalidateQueries({ queryKey: ['cookbook-counts'] });
      navigate(`/meals/${res.id}/edit`);
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not duplicate that.'),
  });

  if (isLoading) return <LoadingState label="Loading recipe…" />;
  if (isError || !meal) {
    const notFound = error instanceof ApiError && error.status === 404;
    return notFound ? (
      <ErrorState
        title="This recipe isn't here"
        text="It may have been deleted, or the link is wrong."
        actionLabel="Back to Browse"
        onAction={() => navigate('/browse')}
      />
    ) : (
      <ErrorState
        title="Couldn't load this recipe"
        text="The connection may have dropped. Try again."
        actionLabel="Try again"
        onAction={() => refetch()}
      />
    );
  }

  const missing = meal.ingredients.filter((i) => !i.in_fridge);
  const haveCount = meal.ingredients.length - missing.length;
  // Only catalog-linked lines can go on the shopping list - a name with no
  // page has nowhere for "got it" to point.
  const missingLinkedIds = missing
    .map((m) => m.ingredient_id)
    .filter((id): id is number => id != null);

  // Scaling ingredient amounts and scaling nutrition totals are the same
  // multiplication, driven by one number: how many servings the cook wants
  // versus how many the recipe as written makes. Per-serving nutrition never
  // moves - doubling the batch doesn't change what's in one plate of it.
  const recipeServings = meal.nutrition.servings;
  const effectiveServings = cookingFor ?? recipeServings;
  const scale = effectiveServings / recipeServings;

  function scaledQty(i: MealIngredient): string | null {
    if (i.amount == null) return i.qty;
    const scaledAmount = formatAmount(i.amount * scale);
    return i.unit ? `${scaledAmount} ${i.unit}` : scaledAmount;
  }
  const isAuthor = meal.author_id === user?.id;

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
          {isAuthor && (
            <button
              className={styles.actionBtn}
              title="Edit this meal"
              onClick={() => navigate(`/meals/${id}/edit`)}
            >
              <PencilIcon size={17} strokeWidth={1.8} />
            </button>
          )}
          {isAuthor && (
            <button
              className={styles.actionBtn}
              title="Add your photo"
              onClick={() => pickImage((url) => updatePhoto.mutate(url))}
            >
              <CameraIcon size={18} strokeWidth={1.8} />
            </button>
          )}
          {isAuthor && (
            <button
              className={styles.actionBtn}
              title="Duplicate as a new recipe"
              disabled={duplicate.isPending}
              onClick={() => duplicate.mutate()}
            >
              <CopyIcon size={17} strokeWidth={1.8} />
            </button>
          )}
          {meal.can_fork && (
            <button
              className={styles.actionBtn}
              title="Fork into your own cookbook"
              disabled={fork.isPending}
              onClick={() => fork.mutate()}
            >
              <ForkIcon size={17} strokeWidth={1.8} />
            </button>
          )}
          {user && <AddToCollection mealId={meal.id} triggerClassName={styles.actionBtn} />}
          <button className={styles.actionBtn} title="Print this recipe" onClick={() => window.print()}>
            <PrintIcon size={17} strokeWidth={1.8} />
          </button>
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

      {meal.photos.length > 0 && (
        <div className={styles.photoGallery}>
          {meal.photos.map((url, i) => (
            <div
              key={i}
              className={styles.galleryPhoto}
              style={{ background: `center/cover no-repeat url("${url}")` }}
            />
          ))}
        </div>
      )}

      <div className={styles.metaLine}>
        {meal.rating > 0 && (
          <span>
            <span className={styles.metaRating}>★ {meal.rating.toFixed(1)}</span>/10
          </span>
        )}
        {meal.rating_count > 0 && <span>{meal.rating_count} ratings</span>}
        {meal.cook_count > 0 && (
          <span title={`Cooked by ${meal.cook_count} chef${meal.cook_count === 1 ? '' : 's'}`}>
            🍳 {meal.cook_count} cooked
          </span>
        )}
        <span>{meal.time_minutes} min</span>
        <span>Serves {meal.serves ?? '4'}</span>
      </div>

      {meal.diet_tags.length > 0 && (
        <div className={styles.dietRow}>
          {meal.diet_tags.map((t) => (
            <span key={t} className={styles.dietBadge}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </span>
          ))}
        </div>
      )}

      {occasions.length > 0 && (user ? true : occasions.some((o) => o.applied)) && (
        <div className={styles.dietRow}>
          {occasions
            .filter((o) => user || o.applied)
            .map((o) => (
              <button
                key={o.tag}
                className={`${styles.occasionChip} ${o.applied ? styles.occasionChipApplied : ''} ${o.your_vote ? styles.occasionChipVoted : ''}`}
                onClick={() => user && voteOccasion.mutate(o.tag)}
                disabled={!user}
                title={user ? (o.your_vote ? 'Remove your vote' : 'Vote for this occasion') : undefined}
              >
                {o.label}
                {o.votes > 0 ? ` (${o.votes})` : ''}
              </button>
            ))}
        </div>
      )}

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

      {meal.source_url && (
        <a
          className={styles.sourceLink}
          href={meal.source_url}
          target="_blank"
          rel="noreferrer noopener"
        >
          Imported from {meal.source_name ?? meal.source_url}
        </a>
      )}

      {meal.forked_from && (
        <button
          className={styles.sourceLink}
          onClick={() => meal.forked_from!.meal_id && navigate(`/meals/${meal.forked_from!.meal_id}`)}
          disabled={!meal.forked_from.meal_id}
        >
          Forked from {meal.forked_from.name}
          {meal.forked_from.author_name ? ` by ${meal.forked_from.author_name}` : ''}
        </button>
      )}

      <button className={styles.historyLink} onClick={() => navigate(`/meals/${id}/history`)}>
        View edit history
      </button>

      <div className={styles.ratingCard}>
        <div className={styles.ratingScoreRow}>
          <span className={styles.ratingScore}>{meal.rating > 0 ? meal.rating.toFixed(1) : '—'}</span>
          <span className={styles.ratingOf}>/10 overall · {meal.rating_count} ratings</span>
        </div>

        {meal.rating_count >= 3 && (
          <>
            {/* The mean and median only pull apart on a genuinely split
                verdict - a straightforward average doesn't need a second
                number stealing its thunder. */}
            {meal.rating_distribution.median != null &&
              Math.abs(meal.rating_distribution.median - meal.rating) >= 1 && (
                <div className={styles.medianNote}>
                  Median {meal.rating_distribution.median.toFixed(1)} — opinions here are split
                  rather than clustered.
                </div>
              )}
            <div className={styles.histogram}>
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
                const count = meal.rating_distribution.counts[n] ?? 0;
                const max = Math.max(...meal.rating_distribution.counts.slice(1), 1);
                return (
                  <div key={n} className={styles.histBar} title={`${count} rated this ${n}/10`}>
                    <div className={styles.histFill} style={{ height: `${(count / max) * 100}%` }} />
                    <span className={styles.histLabel}>{n}</span>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {meal.your_rating != null && (
          <div className={styles.yourRatingPill}>You: {meal.your_rating}/10</div>
        )}
        <div className={styles.rateLabel}>
          {meal.your_rating != null ? 'Tap to update your rating' : 'Rate this meal (1–10)'}
        </div>
        <div className={styles.rateRow} role="group" aria-label="Rate this meal from 1 to 10">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              className={`${styles.rateBtn} ${meal.your_rating != null && n <= meal.your_rating ? styles.rateBtnOn : ''}`}
              onClick={() => rate.mutate(n)}
              aria-label={`Rate ${n} out of 10`}
              aria-pressed={meal.your_rating === n}
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

      <div className={styles.servingStepper}>
        <span className={styles.servingLabel}>Cooking for</span>
        <button
          className={styles.servingBtn}
          disabled={effectiveServings <= 1}
          onClick={() => setCookingFor(Math.max(1, effectiveServings - 1))}
          aria-label="Fewer servings"
        >
          −
        </button>
        <span className={styles.servingCount}>{effectiveServings}</span>
        <button
          className={styles.servingBtn}
          onClick={() => setCookingFor(effectiveServings + 1)}
          aria-label="More servings"
        >
          +
        </button>
        {cookingFor != null && cookingFor !== recipeServings && (
          <button className={styles.servingReset} onClick={() => setCookingFor(null)}>
            Reset to {recipeServings}
          </button>
        )}
      </div>

      <div className={styles.ingChips}>
        {meal.ingredients.map((i, idx) => {
          const linked = i.ingredient_id != null;
          return (
            <button
              key={i.ingredient_id ?? `unlinked-${idx}`}
              className={`${styles.ingChip} ${!i.in_fridge ? styles.ingChipMissing : ''}`}
              onClick={() => linked && navigate(`/ingredients/${i.ingredient_id}`)}
              title={linked ? undefined : 'Not linked to a catalog page'}
              style={linked ? undefined : { cursor: 'default' }}
            >
              <span
                className={styles.ingChipThumb}
                style={{ background: ingredientBackground(null, i.category) }}
              />
              <span className={styles.ingChipName}>{i.name}</span>
              {scaledQty(i) && <span className={styles.ingChipQty}>{scaledQty(i)}</span>}
              <span className={`${styles.ingChipMark} ${i.in_fridge ? styles.markHave : styles.markMissing}`}>
                {i.in_fridge ? '✓' : '○'}
              </span>
            </button>
          );
        })}
      </div>

      {missingLinkedIds.length > 0 && (
        <button
          className={styles.addMissingBtn}
          onClick={() => addMissing.mutate(missingLinkedIds)}
        >
          + Add {missingLinkedIds.length} missing to shopping list
        </button>
      )}

      {meal.nutrition.counted > 0 && (
        <div className={styles.nutritionCard}>
          <div className={styles.sectionHeadRow}>
            <h2 className={styles.sectionTitle}>Nutrition</h2>
            <span className={styles.nutriPer}>per serving</span>
          </div>

          {meal.nutrition.counted < meal.nutrition.total_ingredients && (
            <p className={styles.nutriCoverage}>
              Counted {meal.nutrition.counted} of {meal.nutrition.total_ingredients} ingredients —
              the rest are measured by volume or count, which can't be converted to weight without
              guessing, so they're left out rather than estimated.
            </p>
          )}

          <div className={styles.nutriGrid}>
            <div className={styles.nutriStat}>
              <span className={styles.nutriValue}>{Math.round(meal.nutrition.per_serving.calories)}</span>
              <span className={styles.nutriLabel}>Calories</span>
            </div>
            <div className={styles.nutriStat}>
              <span className={styles.nutriValue}>{formatAmount(meal.nutrition.per_serving.protein)}g</span>
              <span className={styles.nutriLabel}>Protein</span>
            </div>
            <div className={styles.nutriStat}>
              <span className={styles.nutriValue}>{formatAmount(meal.nutrition.per_serving.carbs)}g</span>
              <span className={styles.nutriLabel}>Carbs</span>
            </div>
            <div className={styles.nutriStat}>
              <span className={styles.nutriValue}>{formatAmount(meal.nutrition.per_serving.fat)}g</span>
              <span className={styles.nutriLabel}>Fat</span>
            </div>
            <div className={styles.nutriStat}>
              <span className={styles.nutriValue}>{formatAmount(meal.nutrition.per_serving.fiber)}g</span>
              <span className={styles.nutriLabel}>Fiber</span>
            </div>
            <div className={styles.nutriStat}>
              <span className={styles.nutriValue}>{formatAmount(meal.nutrition.per_serving.sugar)}g</span>
              <span className={styles.nutriLabel}>Sugar</span>
            </div>
          </div>

          {effectiveServings !== recipeServings && (
            <p className={styles.nutriCoverage} style={{ marginTop: 10, marginBottom: 0 }}>
              Whole batch at {effectiveServings} {effectiveServings === 1 ? 'serving' : 'servings'}:{' '}
              {Math.round(meal.nutrition.per_serving.calories * effectiveServings)} calories total.
            </p>
          )}
        </div>
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
        <div className={styles.noPrint}>
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
        </div>
      )}

      {reviews.length > 0 && (
        <div className={styles.noPrint}>
          <div className={styles.sectionHeadRow}>
            <h2 className={styles.sectionTitle}>Reviews</h2>
            <span className={styles.reviewCount}>{reviews.length}</span>
            <select
              className={styles.reviewSortSelect}
              value={reviewSort}
              onChange={(e) => setReviewSort(e.target.value)}
              aria-label="Sort reviews"
            >
              {REVIEW_SORTS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.reviewList}>
            {reviews.map((r) => (
              <div key={r.id} className={styles.reviewRow}>
                <button
                  className={styles.reviewAuthorBtn}
                  onClick={() => navigate(`/chefs/${r.user_id}`)}
                  aria-label={`View ${r.author_name}'s profile`}
                >
                  <Avatar
                    name={r.author_name}
                    photoUrl={r.avatar_photo_url}
                    theme={r.avatar_theme}
                    size="sm"
                    shape="rounded"
                  />
                </button>
                <span className={styles.reviewBody}>
                  <span className={styles.reviewHead}>
                    <button className={styles.reviewAuthorName} onClick={() => navigate(`/chefs/${r.user_id}`)}>
                      {r.author_name}
                    </button>
                    <ContributorBadge tier={r.author_tier} />
                    {r.score != null && <span className={styles.reviewStars}>★ {r.score}/10</span>}
                    <span className={styles.reviewWhen}>
                      {relativeTime(r.cooked_at)}
                      {r.edited_at && ' (edited)'}
                    </span>
                  </span>
                  {editingReviewId === r.id ? (
                    <span className={styles.reviewEditForm}>
                      <textarea
                        className={styles.reviewEditTextarea}
                        value={editNote}
                        onChange={(e) => setEditNote(e.target.value)}
                        maxLength={4000}
                        rows={3}
                      />
                      <span className={styles.reviewEditScoreRow}>
                        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                          <button
                            key={n}
                            type="button"
                            className={`${styles.editScoreBtn} ${editScore === n ? styles.editScoreBtnOn : ''}`}
                            onClick={() => setEditScore(n)}
                            aria-pressed={editScore === n}
                            aria-label={`Rate ${n} out of 10`}
                          >
                            {n}
                          </button>
                        ))}
                      </span>
                      <span className={styles.reviewEditActions}>
                        <button
                          className={styles.reviewEditSave}
                          disabled={!editNote.trim() || updateReview.isPending}
                          onClick={() =>
                            updateReview.mutate({ reviewId: r.id, note: editNote.trim(), score: editScore })
                          }
                        >
                          Save
                        </button>
                        <button className={styles.reviewEditCancel} onClick={() => setEditingReviewId(null)}>
                          Cancel
                        </button>
                      </span>
                    </span>
                  ) : (
                    <span className={styles.reviewNote}>{r.note}</span>
                  )}
                  {!r.is_current_version && (
                    <span className={styles.reviewStale}>Written about an earlier version of this recipe</span>
                  )}
                  <span className={styles.reviewActions}>
                    <button
                      className={`${styles.helpfulBtn} ${r.your_helpful_vote ? styles.helpfulBtnOn : ''}`}
                      onClick={() => voteHelpful.mutate(r.id)}
                      aria-pressed={r.your_helpful_vote}
                      aria-label={r.your_helpful_vote ? 'Remove helpful vote' : 'Mark this review as helpful'}
                    >
                      👍 Helpful{r.helpful_count > 0 ? ` (${r.helpful_count})` : ''}
                    </button>
                    {user && r.user_id === user.id && editingReviewId !== r.id && (
                      <button
                        className={styles.helpfulBtn}
                        onClick={() => {
                          setEditingReviewId(r.id);
                          setEditNote(r.note ?? '');
                          setEditScore(r.score);
                        }}
                      >
                        Edit
                      </button>
                    )}
                    {user && r.user_id !== user.id && <FlagButton contentType="review" contentId={r.id} />}
                  </span>
                  <ReviewReplies mealId={meal.id} reviewId={r.id} replies={r.replies} />
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {journal.length > 0 && (
        <div className={styles.noPrint}>
          <h2 className={styles.journalTitle}>Your cooking notes</h2>
          {journal.map((j) => (
            <div key={j.id} className={styles.journalEntry}>
              <div className={styles.journalDate}>{formatDate(j.cooked_at)}</div>
              <div className={styles.journalNote}>{j.note}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
