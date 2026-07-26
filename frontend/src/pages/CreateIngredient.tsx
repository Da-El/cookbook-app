import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { useToast } from '../components/Toast/ToastContext';
import { ChevronLeft } from '../components/Icon/Icon';
import { pickImage } from '../lib/photo';
import styles from './Create.module.css';

const CATEGORIES = ['Vegetable', 'Fruit', 'Herb', 'Aromatic', 'Protein', 'Dairy', 'Grain', 'Pantry'];

interface CloseMatch {
  id: number;
  name: string;
  used_in_meals: number;
}

interface CreateResponse {
  id: number | null;
  close_match: CloseMatch | null;
}

export function CreateIngredient() {
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [params] = useSearchParams();

  const [name, setName] = useState(params.get('name') ?? '');
  const [category, setCategory] = useState('Vegetable');
  const [description, setDescription] = useState('');
  const [photo, setPhoto] = useState('');
  const [servingSize, setServingSize] = useState('');
  const [calories, setCalories] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [rating, setRating] = useState(8);
  const [error, setError] = useState<string | null>(null);
  const [closeMatch, setCloseMatch] = useState<CloseMatch | null>(null);

  const create = useMutation({
    mutationFn: (confirmedNew: boolean) =>
      api.post<CreateResponse>('/ingredients', {
        name: name.trim(),
        category,
        description: description.trim(),
        photo_url: photo || null,
        serving_size: servingSize.trim() || null,
        calories: calories.trim() ? Number(calories) : null,
        protein: protein.trim() ? Number(protein) : null,
        carbs: carbs.trim() ? Number(carbs) : null,
        fat: fat.trim() ? Number(fat) : null,
        rating,
        confirmed_new: confirmedNew,
      }),
    onSuccess: (res) => {
      // A near-duplicate comes back as a warning instead of a new page.
      if (!res.id && res.close_match) {
        setCloseMatch(res.close_match);
        return;
      }
      toast('Published!');
      qc.invalidateQueries({ queryKey: ['ingredients'] });
      if (res.id) navigate(`/ingredients/${res.id}`, { replace: true });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not publish that ingredient.'),
  });

  function submit(confirmedNew = false) {
    setError(null);
    setCloseMatch(null);
    if (!name.trim()) return setError('Please enter an ingredient name.');
    create.mutate(confirmedNew);
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate(-1)} aria-label="Back">
          <ChevronLeft size={18} strokeWidth={2.2} />
        </button>
        <h1 className={styles.title}>New ingredient</h1>
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
        <label className={styles.label}>Name</label>
        <input
          className={styles.input}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setCloseMatch(null);
          }}
          placeholder="e.g. Costco Fuji Apple"
        />
        <p className={styles.helper}>
          Be as specific as you like — brand, variety, even a store-specific product.
        </p>
      </div>

      <div className={styles.field}>
        <label className={styles.label}>Category</label>
        <div className={styles.chipRow}>
          {CATEGORIES.map((c) => (
            <button
              key={c}
              className={`${styles.chip} ${category === c ? styles.chipActive : ''}`}
              onClick={() => setCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.label}>Description</label>
        <textarea
          className={styles.textarea}
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What makes it special?"
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label}>Nutrition facts (optional)</label>
        <div className={styles.nutGrid}>
          <div>
            <label className={styles.nutLabel}>Serving size</label>
            <input
              className={styles.nutInput}
              value={servingSize}
              onChange={(e) => setServingSize(e.target.value)}
              placeholder="e.g. 1 medium (182g)"
            />
          </div>
          <div>
            <label className={styles.nutLabel}>Calories</label>
            <input
              className={styles.nutInput}
              value={calories}
              onChange={(e) => setCalories(e.target.value)}
              placeholder="e.g. 95"
              inputMode="decimal"
            />
          </div>
          <div>
            <label className={styles.nutLabel}>Protein (g)</label>
            <input
              className={styles.nutInput}
              value={protein}
              onChange={(e) => setProtein(e.target.value)}
              placeholder="e.g. 0.5"
              inputMode="decimal"
            />
          </div>
          <div>
            <label className={styles.nutLabel}>Carbs (g)</label>
            <input
              className={styles.nutInput}
              value={carbs}
              onChange={(e) => setCarbs(e.target.value)}
              placeholder="e.g. 25"
              inputMode="decimal"
            />
          </div>
          <div>
            <label className={styles.nutLabel}>Fat (g)</label>
            <input
              className={styles.nutInput}
              value={fat}
              onChange={(e) => setFat(e.target.value)}
              placeholder="e.g. 0.3"
              inputMode="decimal"
            />
          </div>
        </div>
        <p className={styles.footnote}>
          Leave blank and we'll estimate typical values for the category.
        </p>
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

      {closeMatch && (
        <div className={styles.dupCard}>
          <div className={styles.dupTitle}>This looks similar to “{closeMatch.name}”</div>
          <div className={styles.dupSub}>
            {closeMatch.used_in_meals > 0
              ? `Used in ${closeMatch.used_in_meals} meal${closeMatch.used_in_meals === 1 ? '' : 's'} already — likely the one people mean.`
              : 'Not used in any meals yet.'}
          </div>
          <div className={styles.dupRow}>
            <button
              className={styles.dupPrimary}
              onClick={() => navigate(`/ingredients/${closeMatch.id}`)}
            >
              Open existing page
            </button>
            <button className={styles.dupSecondary} onClick={() => submit(true)}>
              Create new anyway
            </button>
          </div>
        </div>
      )}

      {error && <p className={styles.error}>{error}</p>}

      <button className={styles.submit} onClick={() => submit()} disabled={create.isPending}>
        {create.isPending ? 'Publishing…' : 'Publish ingredient'}
      </button>
    </div>
  );
}
