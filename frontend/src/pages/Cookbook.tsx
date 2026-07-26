import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { IngredientSummary } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { useIsDesktop } from '../hooks/useMediaQuery';
import { useToast } from '../components/Toast/ToastContext';
import { Segmented } from '../components/Segmented/Segmented';
import { Avatar } from '../components/Avatar/Avatar';
import { MealCard, MealGrid } from '../components/MealCard/MealCard';
import { EmptyCard, EmptyLine } from '../components/Empty/Empty';
import { PencilIcon, SearchIcon } from '../components/Icon/Icon';
import { ingredientBackground, mealBackground } from '../lib/imagery';
import styles from './Cookbook.module.css';

type Group = 'recipes' | 'kitchen';
type SubTab = 'cooked' | 'saved' | 'published' | 'fridge' | 'shopping';

interface CookbookMeal {
  id: number;
  name: string;
  author_name: string;
  cuisine: string;
  time_minutes: number;
  rating: number;
  photo_url: string | null;
}

interface KitchenItem {
  id: number;
  ingredient_id: number | null;
  name: string;
  category: string;
}

const SECTION: Record<SubTab, { title: string; sub: string }> = {
  cooked: { title: 'Meals you’ve cooked', sub: 'Your running record of everything you’ve made.' },
  saved: { title: 'Saved to cook', sub: 'Your wishlist — ready when you are.' },
  published: { title: 'Meals you’ve published', sub: 'Others see you as the author of these.' },
  fridge: { title: 'What’s in your fridge', sub: 'What you have on hand — your feed uses it.' },
  shopping: { title: 'Shopping list', sub: 'What you still need to pick up.' },
};

const EMPTY: Record<'cooked' | 'saved' | 'published', { title: string; text: string; to: string }> = {
  cooked: {
    title: 'Nothing cooked yet',
    text: 'Open a meal and mark it as cooked — it lands here with your notes.',
    to: '/browse',
  },
  saved: {
    title: 'Nothing saved yet',
    text: 'Tap “Want to make” on any meal and it shows up here.',
    to: '/browse',
  },
  published: {
    title: 'Publish your first meal',
    text: 'Create a meal page and it’ll appear here with your name on it.',
    to: '/create/meal',
  },
};

const BADGE: Record<'cooked' | 'saved' | 'published', { label: string; color: string }> = {
  cooked: { label: 'Cooked', color: 'var(--green)' },
  saved: { label: 'Saved', color: 'var(--accent)' },
  published: { label: 'Yours', color: 'var(--green)' },
};

const GROUP_ORDER = ['Vegetable', 'Fruit', 'Herb', 'Aromatic', 'Protein', 'Dairy', 'Grain', 'Pantry', 'Other'];

export function Cookbook() {
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();

  const [group, setGroup] = useState<Group>('recipes');
  const [tab, setTab] = useState<SubTab>('cooked');
  const [query, setQuery] = useState('');

  const { data: counts } = useQuery({
    queryKey: ['cookbook-counts'],
    queryFn: () => api.get<Record<SubTab, number>>('/cookbook/counts'),
  });

  const isMealTab = tab === 'cooked' || tab === 'saved' || tab === 'published';

  const { data: meals = [] } = useQuery({
    queryKey: ['cookbook', tab],
    queryFn: () => api.get<CookbookMeal[]>(`/cookbook/${tab}`),
    enabled: isMealTab,
  });

  const kitchenKey = tab === 'shopping' ? 'shopping' : 'fridge';
  const { data: items = [] } = useQuery({
    queryKey: [kitchenKey],
    queryFn: () => api.get<KitchenItem[]>(`/${kitchenKey}`),
    enabled: !isMealTab,
  });

  const { data: matches = [] } = useQuery({
    queryKey: ['ingredients', query],
    queryFn: () => api.get<IngredientSummary[]>(`/ingredients?search=${encodeURIComponent(query)}`),
    enabled: !isMealTab && query.trim().length > 0,
  });

  const invalidateKitchen = () => {
    qc.invalidateQueries({ queryKey: [kitchenKey] });
    qc.invalidateQueries({ queryKey: ['cookbook-counts'] });
  };

  const addItem = useMutation({
    mutationFn: (body: { ingredient_id?: number; custom_name?: string }) =>
      api.post(`/${kitchenKey}`, body),
    onSuccess: invalidateKitchen,
  });

  const removeItem = useMutation({
    mutationFn: (id: number) => api.del(`/${kitchenKey}/${id}`),
    onSuccess: invalidateKitchen,
  });

  const gotIt = useMutation({
    mutationFn: (id: number) => api.post(`/shopping/${id}/got-it`),
    onSuccess: () => {
      toast('Moved to your fridge');
      qc.invalidateQueries({ queryKey: ['shopping'] });
      qc.invalidateQueries({ queryKey: ['fridge'] });
      qc.invalidateQueries({ queryKey: ['cookbook-counts'] });
    },
  });

  if (!user) return null;

  const inList = (id: number) => items.some((i) => i.ingredient_id === id);
  const exactMatch = matches.some((m) => m.name.toLowerCase() === query.trim().toLowerCase());

  const grouped = GROUP_ORDER.map((cat) => ({
    cat,
    rows: items.filter((i) => i.category === cat),
  })).filter((g) => g.rows.length > 0);

  const crossNote: Record<SubTab, { text: string; label: string; go: () => void }> = {
    cooked: {
      text: 'Everything here started life on your Saved list.',
      label: `Saved ${counts?.saved ?? 0}`,
      go: () => setTab('saved'),
    },
    saved: {
      text: 'Cook one and it moves over to Cooked automatically.',
      label: `Cooked ${counts?.cooked ?? 0}`,
      go: () => setTab('cooked'),
    },
    published: {
      text: 'Your own recipes — they show up in Browse and in your followers’ feeds.',
      label: 'New meal',
      go: () => navigate('/create/meal'),
    },
    fridge: {
      text: 'Missing something? Put it on the shopping list.',
      label: `Shopping ${counts?.shopping ?? 0}`,
      go: () => setTab('shopping'),
    },
    shopping: {
      text: 'Tap “Got it” and the item moves straight into your fridge.',
      label: `Fridge ${counts?.fridge ?? 0}`,
      go: () => setTab('fridge'),
    },
  };

  const subTabs: SubTab[] = group === 'recipes' ? ['cooked', 'saved', 'published'] : ['fridge', 'shopping'];

  return (
    <div className={styles.page}>
      <div className={styles.hero} style={{ background: 'linear-gradient(155deg,#FBF8F2,#F4ECDD)' }}>
        <div className={styles.heroRow}>
          <div style={{ minWidth: 0 }}>
            <div className={styles.heroEyebrow} style={{ color: 'var(--accent-dark)' }}>
              {user.display_name}'s kitchen
            </div>
            <div className={styles.heroTitle} style={{ color: 'var(--ink)' }}>Your Cookbook</div>
            <div className={styles.heroStats}>
              <span className={styles.heroStatNum}>{counts?.published ?? 0}</span>
              <span className={styles.heroStatLabel} style={{ color: 'var(--muted-2)' }}>recipes</span>
              <span style={{ color: '#D8CBB6' }}>·</span>
              <span className={styles.heroStatNum}>{counts?.cooked ?? 0}</span>
              <span className={styles.heroStatLabel} style={{ color: 'var(--muted-2)' }}>cooked</span>
            </div>
          </div>
          <div className={styles.heroActions}>
            <button className={styles.pencil} onClick={() => navigate('/cookbook/customize')} title="Customize">
              <PencilIcon size={19} strokeWidth={1.7} />
            </button>
            {!isDesktop && <Avatar name={user.display_name} size="md" shape="rounded" />}
          </div>
        </div>
      </div>

      <div className={styles.groupSwitch}>
        <Segmented
          value={group}
          fill={!isDesktop}
          onChange={(g) => {
            setGroup(g);
            setTab(g === 'recipes' ? 'cooked' : 'fridge');
            setQuery('');
          }}
          options={[
            { value: 'recipes', label: 'Recipes' },
            { value: 'kitchen', label: 'Kitchen' },
          ]}
        />
      </div>

      <div className={styles.subTabs}>
        {subTabs.map((t) => (
          <button
            key={t}
            className={`${styles.subTab} ${tab === t ? styles.subTabActive : ''}`}
            onClick={() => {
              setTab(t);
              setQuery('');
            }}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
            <span className={styles.subTabCount}>{counts?.[t] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>{SECTION[tab].title}</h2>
        {group === 'recipes' && <span className={`${styles.visPill} ${styles.visPublic}`}>Public</span>}
      </div>
      <p className={styles.sectionSub}>{SECTION[tab].sub}</p>

      {isDesktop && (
        <div className={styles.crossNote}>
          <span className={styles.crossNoteText}>{crossNote[tab].text}</span>
          <button className={styles.crossNoteBtn} onClick={crossNote[tab].go}>
            {crossNote[tab].label}
          </button>
        </div>
      )}

      {isMealTab ? (
        meals.length > 0 ? (
          isDesktop ? (
            <MealGrid>
              {meals.map((m) => (
                <MealCard
                  key={m.id}
                  meal={{ ...m, have_count: 0, total_count: 0 }}
                  badge={BADGE[tab as 'cooked' | 'saved' | 'published'].label}
                  badgeColor={BADGE[tab as 'cooked' | 'saved' | 'published'].color}
                />
              ))}
            </MealGrid>
          ) : (
            <div className={styles.mealList}>
              {meals.map((m) => (
                <button key={m.id} className={styles.mealRow} onClick={() => navigate(`/meals/${m.id}`)}>
                  <span
                    className={styles.mealThumb}
                    style={{ background: mealBackground(m.photo_url, m.cuisine) }}
                  />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className={styles.mealName} style={{ display: 'block' }}>{m.name}</span>
                    <span className={styles.mealSub} style={{ display: 'block' }}>
                      {m.cuisine} · {m.time_minutes} min
                    </span>
                  </span>
                  <span
                    className={styles.mealBadge}
                    style={{ color: BADGE[tab as 'cooked' | 'saved' | 'published'].color }}
                  >
                    {BADGE[tab as 'cooked' | 'saved' | 'published'].label}
                  </span>
                </button>
              ))}
            </div>
          )
        ) : (
          <EmptyCard
            title={EMPTY[tab as 'cooked' | 'saved' | 'published'].title}
            text={EMPTY[tab as 'cooked' | 'saved' | 'published'].text}
            onClick={() => navigate(EMPTY[tab as 'cooked' | 'saved' | 'published'].to)}
          />
        )
      ) : (
        <div className={styles.kitchen}>
          <div className={styles.searchBox}>
            <SearchIcon size={18} strokeWidth={2} />
            <input
              className={styles.searchInput}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tab === 'fridge' ? 'Search or add an ingredient…' : 'Search or add an item…'}
            />
          </div>

          {query.trim() && !exactMatch && (
            <div className={styles.offerRow}>
              <button
                className={styles.offerCreate}
                onClick={() => navigate(`/create/ingredient?name=${encodeURIComponent(query.trim())}`)}
              >
                + Create “{query.trim()}” page
              </button>
              <button
                className={styles.offerPlain}
                onClick={() => {
                  addItem.mutate({ custom_name: query.trim() });
                  setQuery('');
                }}
              >
                + Add without page
              </button>
            </div>
          )}

          {query.trim() && matches.length > 0 && (
            <div className={styles.matchList}>
              {matches.slice(0, 6).map((m) => {
                const on = inList(m.id);
                return (
                  <div key={m.id} className={styles.matchRow}>
                    <span
                      className={styles.matchThumb}
                      style={{ background: ingredientBackground(null, m.category) }}
                    />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className={styles.matchName} style={{ display: 'block' }}>{m.name}</span>
                      <span className={styles.matchCat} style={{ display: 'block' }}>{m.category}</span>
                    </span>
                    <button
                      className={`${styles.matchBtn} ${on ? styles.matchBtnOn : ''}`}
                      onClick={() => {
                        if (on) {
                          const row = items.find((i) => i.ingredient_id === m.id);
                          if (row) removeItem.mutate(row.id);
                        } else {
                          addItem.mutate({ ingredient_id: m.id });
                        }
                      }}
                    >
                      {on ? 'Remove' : 'Add'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {items.length > 0 ? (
            <div className={styles.groups}>
              {grouped.map(({ cat, rows }) => (
                <div key={cat}>
                  <div className={styles.groupLabel}>{cat}</div>
                  <div className={styles.groupItems}>
                    {rows.map((it) => (
                      <div key={it.id} className={styles.item}>
                        <button
                          className={styles.itemOpen}
                          onClick={() => it.ingredient_id && navigate(`/ingredients/${it.ingredient_id}`)}
                          style={{ cursor: it.ingredient_id ? 'pointer' : 'default' }}
                        >
                          <span
                            className={styles.itemThumb}
                            style={{ background: ingredientBackground(null, it.category) }}
                          />
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <span className={styles.itemName} style={{ display: 'block' }}>{it.name}</span>
                            <span className={styles.itemSub} style={{ display: 'block' }}>
                              {it.ingredient_id ? it.category : 'Quick add · no page'}
                            </span>
                          </span>
                        </button>
                        {tab === 'shopping' && (
                          <button className={styles.gotIt} onClick={() => gotIt.mutate(it.id)}>
                            Got it ✓
                          </button>
                        )}
                        <button
                          className={styles.removeX}
                          onClick={() => removeItem.mutate(it.id)}
                          aria-label={`Remove ${it.name}`}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyLine>
              {tab === 'fridge'
                ? 'Nothing in your fridge yet — search above to add.'
                : 'Nothing on your list yet — add missing ingredients from any meal, or search above.'}
            </EmptyLine>
          )}
        </div>
      )}
    </div>
  );
}
