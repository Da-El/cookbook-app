import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { IngredientSummary } from '../api/types';
import { useIsDesktop } from '../hooks/useMediaQuery';
import { useToast } from '../components/Toast/ToastContext';
import { Segmented } from '../components/Segmented/Segmented';
import { MealCard, MealGrid, type MealCardData } from '../components/MealCard/MealCard';
import { ChefList, ChefRow, type Chef } from '../components/ChefRow/ChefRow';
import { EmptyLine } from '../components/Empty/Empty';
import { SearchIcon } from '../components/Icon/Icon';
import { ingredientBackground } from '../lib/imagery';
import styles from './Browse.module.css';

const MEAL_TYPES = ['All', 'Breakfast', 'Lunch', 'Dinner', 'Dessert', 'Snack'];
const ING_CATEGORIES = ['All', 'Vegetable', 'Fruit', 'Herb', 'Aromatic', 'Protein', 'Dairy', 'Grain', 'Pantry'];
// Labels match Settings.tsx's diet-preference chips; the lowercase form is
// what the backend's diet_flags/diet_tags actually store.
const DIET_CHIPS = ['All', 'Vegetarian', 'Vegan', 'Pescatarian', 'Gluten-free', 'Dairy-free', 'Nut-free'];
const SORTS: [string, string][] = [
  ['top', 'Top rated'],
  ['rising', 'Rising'],
  ['canmake', 'Can make'],
  ['fastest', 'Fastest'],
];
const DIFFICULTY_CHIPS = ['All', 'Easy', 'Medium', 'Hard'];
const TIME_CHIPS: [string, number | null][] = [
  ['Any time', null],
  ['15 min', 15],
  ['30 min', 30],
  ['45 min', 45],
  ['60 min', 60],
];
// Matches backend/src/meals.rs's OCCASION_TAGS exactly - the tag (left) is
// what the API filters on, the label (right) is what the chip shows.
const OCCASION_CHIPS: [string, string][] = [
  ['All', 'All'],
  ['quick-weeknight', 'Quick weeknight'],
  ['meal-prep', 'Meal prep'],
  ['date-night', 'Date night'],
  ['kid-friendly', 'Kid-friendly'],
  ['party', 'Party'],
  ['comfort-food', 'Comfort food'],
  ['healthy', 'Healthy'],
  ['budget', 'Budget-friendly'],
];

interface MealRow extends MealCardData {
  author_name: string;
  meal_type: string;
  is_top_in_cuisine?: boolean;
  difficulty?: string;
}

interface IngredientHit extends IngredientSummary {
  /// Present when this row only matched through a community alias, e.g.
  /// searching "cilantro" surfacing "Coriander, leaves, raw" - the row needs
  /// to say why it's here or it looks like a mismatch.
  matched_alias?: string | null;
}

interface GuideHit {
  slug: string;
  title: string;
  summary: string;
  topic: string;
}

interface SearchResults {
  meals: MealRow[];
  ingredients: IngredientHit[];
  guides: GuideHit[];
}

export function Browse() {
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const qc = useQueryClient();
  const toast = useToast();
  const [params] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [tab, setTab] = useState<'meals' | 'ingredients' | 'chefs'>('meals');
  // Each tab keeps its own filter so switching doesn't strand an invalid value.
  const [mealType, setMealType] = useState('All');
  const [category, setCategory] = useState('All');
  const [diet, setDiet] = useState('All');
  const [sort, setSort] = useState('top');
  const [difficulty, setDifficulty] = useState('All');
  const [maxTime, setMaxTime] = useState<number | null>(null);
  const [occasion, setOccasion] = useState('All');

  // The desktop topbar searches by pushing ?q=, so mirror it into local state.
  const urlQuery = params.get('q');
  useEffect(() => {
    if (urlQuery !== null) setSearch(urlQuery);
  }, [urlQuery]);

  // A typed query does double duty: it's the entry point for both tabs at
  // once, so one request covers what used to be two. Below, each tab reads
  // its half and ignores the other - most of a search's cost is the ranking
  // work, not shipping a few extra rows the browser never renders.
  const trimmedSearch = search.trim();
  const { data: searchResults, isLoading: searchLoading } = useQuery({
    queryKey: ['search', trimmedSearch],
    queryFn: () => api.get<SearchResults>(`/search?q=${encodeURIComponent(trimmedSearch)}`),
    enabled: trimmedSearch.length > 0 && (tab === 'meals' || tab === 'ingredients'),
  });

  const { data: browseMeals = [], isLoading: browseMealsLoading } = useQuery({
    queryKey: ['meals', mealType, diet, sort, difficulty, maxTime, occasion],
    queryFn: () => {
      const q = new URLSearchParams();
      if (mealType !== 'All') q.set('meal_type', mealType);
      if (diet !== 'All') q.set('diet', diet.toLowerCase());
      q.set('sort', sort);
      if (difficulty !== 'All') q.set('difficulty', difficulty.toLowerCase());
      if (maxTime != null) q.set('max_time', String(maxTime));
      if (occasion !== 'All') q.set('occasion', occasion);
      return api.get<MealRow[]>(`/meals?${q}`);
    },
    enabled: tab === 'meals' && trimmedSearch.length === 0,
  });

  const { data: browseIngredients = [], isLoading: browseIngLoading } = useQuery({
    queryKey: ['ingredients', category],
    queryFn: () => {
      const q = new URLSearchParams();
      if (category !== 'All') q.set('category', category);
      // Same shape as a search hit minus matched_alias, which this endpoint
      // never sets - keeping one element type for `ingredients` below.
      return api.get<IngredientHit[]>(`/ingredients?${q}`);
    },
    enabled: tab === 'ingredients' && trimmedSearch.length === 0,
  });

  // Ranked search doesn't take the meal_type/category chips server-side, so
  // apply them client-side on the (already small, already-fetched) result
  // set rather than losing the chip once someone starts typing.
  const meals = trimmedSearch
    ? (searchResults?.meals ?? []).filter(
        (m) =>
          (mealType === 'All' || m.meal_type === mealType) &&
          (diet === 'All' || (m.diet_tags ?? []).includes(diet.toLowerCase())) &&
          (difficulty === 'All' || m.difficulty === difficulty.toLowerCase()) &&
          (maxTime == null || m.time_minutes <= maxTime),
      )
    : browseMeals;
  const ingredients = trimmedSearch
    ? (searchResults?.ingredients ?? []).filter((i) => category === 'All' || i.category === category)
    : browseIngredients;
  const mealsLoading = trimmedSearch ? searchLoading : browseMealsLoading;
  const ingLoading = trimmedSearch ? searchLoading : browseIngLoading;
  const guideHits = trimmedSearch ? searchResults?.guides ?? [] : [];

  const { data: chefs = [], isLoading: chefsLoading } = useQuery({
    queryKey: ['chefs-search', search],
    queryFn: () => {
      const q = new URLSearchParams();
      if (search) q.set('search', search);
      return api.get<Chef[]>(`/chefs?${q}`);
    },
    enabled: tab === 'chefs',
  });

  const follow = useMutation({
    mutationFn: (chef: Chef) => api.post<{ following: boolean }>(`/chefs/${chef.id}/follow`),
    onSuccess: (res, chef) => {
      toast(res.following ? `Following ${chef.display_name}` : `Unfollowed ${chef.display_name}`);
      qc.invalidateQueries({ queryKey: ['chefs-search'] });
      qc.invalidateQueries({ queryKey: ['chefs-suggested'] });
      qc.invalidateQueries({ queryKey: ['chefs-following'] });
      qc.invalidateQueries({ queryKey: ['feed'] });
    },
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
          { value: 'chefs', label: 'Chefs' },
        ]}
      />
    </div>
  );

  const chips = tab === 'meals' ? MEAL_TYPES : ING_CATEGORIES;
  const active = tab === 'meals' ? mealType : category;
  const setActive = tab === 'meals' ? setMealType : setCategory;
  const showChips = tab !== 'chefs';

  const surpriseMe = useMutation({
    mutationFn: () => api.get<MealRow>('/meals/random'),
    onSuccess: (m) => navigate(`/meals/${m.id}`),
  });

  return (
    <div className={styles.page}>
      {isDesktop ? (
        <div className={styles.headRow}>
          <h1 className={styles.title}>Browse</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {tab === 'meals' && (
              <button
                className={styles.surpriseBtn}
                disabled={surpriseMe.isPending}
                onClick={() => surpriseMe.mutate()}
              >
                🎲 Surprise me
              </button>
            )}
            {toggle}
          </div>
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
          {tab === 'meals' && (
            <button
              className={styles.surpriseBtn}
              disabled={surpriseMe.isPending}
              onClick={() => surpriseMe.mutate()}
              style={{ marginTop: 10 }}
            >
              🎲 Surprise me
            </button>
          )}
          {toggle}
        </>
      )}

      {showChips && (
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
      )}

      {tab === 'meals' && (
        <div className={`${styles.chipRow} hscroll`}>
          {DIET_CHIPS.map((d) => (
            <button
              key={d}
              className={`${styles.chip} ${diet === d ? styles.chipActive : ''}`}
              onClick={() => setDiet(d)}
            >
              {d}
            </button>
          ))}
        </div>
      )}

      {tab === 'meals' && (
        <div className={`${styles.chipRow} hscroll`}>
          {TIME_CHIPS.map(([label, value]) => (
            <button
              key={label}
              className={`${styles.chip} ${maxTime === value ? styles.chipActive : ''}`}
              onClick={() => setMaxTime(value)}
            >
              {label}
            </button>
          ))}
          {DIFFICULTY_CHIPS.map((d) => (
            <button
              key={d}
              className={`${styles.chip} ${difficulty === d ? styles.chipActive : ''}`}
              onClick={() => setDifficulty(d)}
            >
              {d}
            </button>
          ))}
        </div>
      )}

      {tab === 'meals' && !trimmedSearch && (
        <div className={`${styles.chipRow} hscroll`}>
          {OCCASION_CHIPS.map(([tag, label]) => (
            <button
              key={tag}
              className={`${styles.chip} ${occasion === tag ? styles.chipActive : ''}`}
              onClick={() => setOccasion(tag)}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {tab === 'meals' && !trimmedSearch && (
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
      {/* Once there's a query, relevance is the sort - "Top rated"/"Fastest"
          would silently do nothing against ranked search results, which is
          worse than not offering them. */}

      {tab === 'chefs' ? (
        chefs.length > 0 ? (
          <ChefList>
            {chefs.map((c) => (
              <ChefRow key={c.id} chef={c} onToggleFollow={(x) => follow.mutate(x)} />
            ))}
          </ChefList>
        ) : (
          !chefsLoading && (
            <EmptyLine roomy>
              {search ? 'No chefs match that search.' : 'No other chefs have joined yet.'}
            </EmptyLine>
          )
        )
      ) : tab === 'meals' ? (
        <>
          {guideHits.length > 0 && (
            <div className={styles.guideStrip}>
              <span className={styles.guideStripLabel}>From the guides</span>
              {guideHits.map((g) => (
                <button key={g.slug} className={styles.guideHit} onClick={() => navigate(`/guides/${g.slug}`)}>
                  <span className={styles.guideHitTitle}>{g.title}</span>
                  <span className={styles.guideHitSummary}>{g.summary}</span>
                </button>
              ))}
            </div>
          )}
          {meals.length > 0 ? (
            <MealGrid>
              {meals.map((m) => <MealCard key={m.id} meal={m} />)}
            </MealGrid>
          ) : (
            !mealsLoading && guideHits.length === 0 && (
              <EmptyLine roomy>No meals match. Try another filter.</EmptyLine>
            )
          )}
        </>
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
                  {i.matched_alias ? `Also called "${i.matched_alias}"` : i.food_group ?? i.category}
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
