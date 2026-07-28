import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import {
  BookIcon, CalendarIcon, CompassIcon, HomeIcon, PlusIcon, SearchIcon,
} from '../Icon/Icon';
import styles from './CommandPalette.module.css';

interface MealHit {
  id: number;
  name: string;
  cuisine: string;
  rating: number;
}

interface IngredientHit {
  id: number;
  name: string;
  category: string;
}

interface GuideHit {
  slug: string;
  title: string;
  topic: string;
}

interface SearchResults {
  meals: MealHit[];
  ingredients: IngredientHit[];
  guides: GuideHit[];
}

interface Action {
  key: string;
  label: string;
  Icon: (p: { size?: number; strokeWidth?: number }) => React.ReactElement;
  go: () => void;
}

/**
 * App-wide jump-to, opened with Cmd/Ctrl+K from anywhere. Reuses the same
 * `/search` endpoint (and thus the same ranked_score-blended ordering)
 * Browse already searches with - this isn't a second search implementation,
 * just a faster front door to the first one.
 */
export function CommandPalette() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEscapeKey(() => setOpen(false), open);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery('');
      setDebounced('');
      setActiveIndex(0);
      // Focus after the overlay has actually mounted.
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 200);
    return () => clearTimeout(t);
  }, [query]);

  const { data } = useQuery({
    queryKey: ['command-palette-search', debounced],
    queryFn: () => api.get<SearchResults>(`/search?q=${encodeURIComponent(debounced)}&limit=6`),
    enabled: open && debounced.length > 0,
  });

  const ACTIONS: Action[] = useMemo(
    () => [
      { key: 'home', label: 'Go to Feed', Icon: HomeIcon, go: () => navigate('/') },
      { key: 'browse', label: 'Browse recipes', Icon: SearchIcon, go: () => navigate('/browse') },
      { key: 'discover', label: 'Discover', Icon: CompassIcon, go: () => navigate('/discover') },
      { key: 'plan', label: 'Meal plan', Icon: CalendarIcon, go: () => navigate('/plan') },
      { key: 'create', label: 'Create a recipe', Icon: PlusIcon, go: () => navigate('/create') },
      { key: 'cookbook', label: 'My Cookbook', Icon: BookIcon, go: () => navigate('/cookbook') },
    ],
    [navigate],
  );

  const meals = data?.meals ?? [];
  const ingredients = data?.ingredients ?? [];
  const guides = data?.guides ?? [];

  // A single flat list backs arrow-key navigation regardless of which
  // group an item visually belongs to.
  const flatItems = useMemo(() => {
    if (debounced.length === 0) {
      return ACTIONS.map((a) => ({ kind: 'action' as const, action: a }));
    }
    return [
      ...meals.map((m) => ({ kind: 'meal' as const, meal: m })),
      ...ingredients.map((i) => ({ kind: 'ingredient' as const, ingredient: i })),
      ...guides.map((g) => ({ kind: 'guide' as const, guide: g })),
    ];
  }, [debounced, ACTIONS, meals, ingredients, guides]);

  function activate(item: (typeof flatItems)[number]) {
    setOpen(false);
    if (item.kind === 'action') item.action.go();
    else if (item.kind === 'meal') navigate(`/meals/${item.meal.id}`);
    else if (item.kind === 'ingredient') navigate(`/ingredients/${item.ingredient.id}`);
    else navigate(`/guides/${item.guide.slug}`);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, flatItems.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = flatItems[activeIndex];
      if (item) activate(item);
    }
  }

  if (!open) return null;

  let flatCursor = 0;

  return (
    <div className={styles.scrim} onClick={() => setOpen(false)}>
      <div className={styles.palette} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Search Cookbook">
        <div className={styles.inputRow}>
          <SearchIcon size={18} strokeWidth={2} />
          <input
            ref={inputRef}
            className={styles.input}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActiveIndex(0); }}
            onKeyDown={onKeyDown}
            placeholder="Search meals, ingredients, guides…"
            aria-label="Search"
          />
          <kbd className={styles.kbd}>Esc</kbd>
        </div>

        <div className={styles.results}>
          {debounced.length === 0 ? (
            <div className={styles.group}>
              <div className={styles.groupLabel}>Quick actions</div>
              {ACTIONS.map((a) => {
                const idx = flatCursor++;
                return (
                  <button
                    key={a.key}
                    className={`${styles.row} ${idx === activeIndex ? styles.rowActive : ''}`}
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={() => activate({ kind: 'action', action: a })}
                  >
                    <a.Icon size={17} strokeWidth={1.8} />
                    <span>{a.label}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <>
              {meals.length === 0 && ingredients.length === 0 && guides.length === 0 && (
                <div className={styles.empty}>No matches for "{debounced}".</div>
              )}
              {meals.length > 0 && (
                <div className={styles.group}>
                  <div className={styles.groupLabel}>Meals</div>
                  {meals.map((m) => {
                    const idx = flatCursor++;
                    return (
                      <button
                        key={m.id}
                        className={`${styles.row} ${idx === activeIndex ? styles.rowActive : ''}`}
                        onMouseEnter={() => setActiveIndex(idx)}
                        onClick={() => activate({ kind: 'meal', meal: m })}
                      >
                        <span className={styles.rowTitle}>{m.name}</span>
                        <span className={styles.rowMeta}>{m.cuisine}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              {ingredients.length > 0 && (
                <div className={styles.group}>
                  <div className={styles.groupLabel}>Ingredients</div>
                  {ingredients.map((i) => {
                    const idx = flatCursor++;
                    return (
                      <button
                        key={i.id}
                        className={`${styles.row} ${idx === activeIndex ? styles.rowActive : ''}`}
                        onMouseEnter={() => setActiveIndex(idx)}
                        onClick={() => activate({ kind: 'ingredient', ingredient: i })}
                      >
                        <span className={styles.rowTitle}>{i.name}</span>
                        <span className={styles.rowMeta}>{i.category}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              {guides.length > 0 && (
                <div className={styles.group}>
                  <div className={styles.groupLabel}>Guides</div>
                  {guides.map((g) => {
                    const idx = flatCursor++;
                    return (
                      <button
                        key={g.slug}
                        className={`${styles.row} ${idx === activeIndex ? styles.rowActive : ''}`}
                        onMouseEnter={() => setActiveIndex(idx)}
                        onClick={() => activate({ kind: 'guide', guide: g })}
                      >
                        <span className={styles.rowTitle}>{g.title}</span>
                        <span className={styles.rowMeta}>{g.topic}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
