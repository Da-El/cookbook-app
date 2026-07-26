import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { IngredientSummary } from '../api/types';
import { useIsDesktop } from '../hooks/useMediaQuery';
import { Segmented } from '../components/Segmented/Segmented';
import { MealCard, MealGrid, type MealCardData } from '../components/MealCard/MealCard';
import { EmptyLine } from '../components/Empty/Empty';
import { SearchIcon } from '../components/Icon/Icon';
import { ingredientBackground } from '../lib/imagery';
import styles from './Browse.module.css';

const MEAL_TYPES = ['All', 'Breakfast', 'Lunch', 'Dinner', 'Dessert', 'Snack'];
const ING_CATEGORIES = ['All', 'Vegetable', 'Fruit', 'Herb', 'Aromatic', 'Protein', 'Dairy', 'Grain', 'Pantry'];
const SORTS: [string, string][] = [
  ['top', 'Top rated'],
  ['canmake', 'Can make'],
  ['fastest', 'Fastest'],
];

interface MealRow extends MealCardData {
  author_name: string;
  meal_type: string;
}

export function Browse() {
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const [params] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [tab, setTab] = useState<'meals' | 'ingredients'>('meals');
  // Each tab keeps its own filter so switching doesn't strand an invalid value.
  const [mealType, setMealType] = useState('All');
  const [category, setCategory] = useState('All');
  const [sort, setSort] = useState('top');

  const { data: meals = [], isLoading: mealsLoading } = useQuery({
    queryKey: ['meals', search, mealType, sort],
    queryFn: () => {
      const q = new URLSearchParams();
      if (search) q.set('search', search);
      if (mealType !== 'All') q.set('meal_type', mealType);
      q.set('sort', sort);
      return api.get<MealRow[]>(`/meals?${q}`);
    },
    enabled: tab === 'meals',
  });

  const { data: ingredients = [], isLoading: ingLoading } = useQuery({
    queryKey: ['ingredients', search, category],
    queryFn: () => {
      const q = new URLSearchParams();
      if (search) q.set('search', search);
      if (category !== 'All') q.set('category', category);
      return api.get<IngredientSummary[]>(`/ingredients?${q}`);
    },
    enabled: tab === 'ingredients',
  });

  const toggle = (
    <div className={styles.toggleWrap}>
      <Segmented
        value={tab}
        onChange={setTab}
        fill={!isDesktop}
        square={!isDesktop}
        dark
        options={[
          { value: 'meals', label: 'Meals' },
          { value: 'ingredients', label: 'Ingredients' },
        ]}
      />
    </div>
  );

  const chips = tab === 'meals' ? MEAL_TYPES : ING_CATEGORIES;
  const active = tab === 'meals' ? mealType : category;
  const setActive = tab === 'meals' ? setMealType : setCategory;

  return (
    <div className={styles.page}>
      {isDesktop ? (
        <div className={styles.headRow}>
          <h1 className={styles.title}>Browse</h1>
          {toggle}
        </div>
      ) : (
        <>
          <h1 className={styles.title} style={{ marginTop: 6 }}>Browse</h1>
          <div className={styles.search}>
            <SearchIcon size={18} strokeWidth={2} />
            <input
              className={styles.searchInput}
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {toggle}
        </>
      )}

      <div className={`${styles.chipRow} hscroll`}>
        {chips.map((c) => (
          <button
            key={c}
            className={`${styles.chip} ${active === c ? styles.chipActive : ''}`}
            onClick={() => setActive(c)}
          >
            {c}
          </button>
        ))}
      </div>

      {tab === 'meals' && (
        <div className={styles.sortRow}>
          {SORTS.map(([value, label]) => (
            <button
              key={value}
              className={`${styles.chip} ${styles.sortChip} ${sort === value ? styles.chipActive : ''}`}
              onClick={() => setSort(value)}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {tab === 'meals' ? (
        meals.length > 0 ? (
          <MealGrid>
            {meals.map((m) => <MealCard key={m.id} meal={m} />)}
          </MealGrid>
        ) : (
          !mealsLoading && <EmptyLine roomy>No meals match. Try another filter.</EmptyLine>
        )
      ) : ingredients.length > 0 ? (
        <div className={styles.ingList}>
          {ingredients.map((i) => (
            <button key={i.id} className={styles.ingRow} onClick={() => navigate(`/ingredients/${i.id}`)}>
              <span
                className={styles.ingThumb}
                style={{ background: ingredientBackground(null, i.category) }}
              />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className={styles.ingName} style={{ display: 'block' }}>{i.name}</span>
                <span className={styles.ingSub} style={{ display: 'block' }}>
                  {i.foodb_subgroup ?? i.category}
                </span>
              </span>
              {i.rating > 0 && <span className={styles.ingRating}>★ {i.rating.toFixed(1)}</span>}
            </button>
          ))}
        </div>
      ) : (
        !ingLoading && <EmptyLine roomy>No ingredients found.</EmptyLine>
      )}
    </div>
  );
}
