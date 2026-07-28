import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { IngredientSummary } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { useProfileTheme } from '../theme/ThemeContext';
import { useIsDesktop } from '../hooks/useMediaQuery';
import { useToast } from '../components/Toast/ToastContext';
import { Segmented } from '../components/Segmented/Segmented';
import { Avatar } from '../components/Avatar/Avatar';
import { MealCard, MealGrid } from '../components/MealCard/MealCard';
import { EmptyCard, EmptyLine } from '../components/Empty/Empty';
import { PencilIcon, SearchIcon } from '../components/Icon/Icon';
import { ingredientBackground, mealBackground } from '../lib/imagery';
import { PAGE_THEMES, heroTextColors } from '../lib/themes';
import styles from './Cookbook.module.css';

type Group = 'recipes' | 'kitchen' | 'contributions';
type SubTab = 'cooked' | 'saved' | 'published' | 'fridge' | 'shopping' | 'reviews' | 'edits' | 'ratings' | 'votes';

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

interface MyReview {
  id: number;
  meal_id: number;
  meal_name: string;
  photo_url: string | null;
  score: number | null;
  note: string | null;
  is_public: boolean;
  cooked_at: string;
}

interface MyEdit {
  id: number;
  ingredient_id: number;
  ingredient_name: string;
  ingredient_category: string;
  field: string;
  value: unknown;
  votes: number;
  is_winning: boolean;
  created_at: string;
}

interface MyRating {
  meal_id: number;
  meal_name: string;
  photo_url: string | null;
  value: number;
  created_at: string;
  updated_at: string;
}

interface MyVote {
  kind: 'revision' | 'alias';
  target_id: number;
  subject_id: number;
  subject_name: string;
  label: string;
  value: number;
  created_at: string;
}

function relativeTime(iso: string) {
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days < 1) return 'today';
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

const FIELD_LABEL: Record<string, string> = {
  description: 'Description',
  category: 'Category',
  photo: 'Photo',
  nutrition: 'Nutrition',
};

function formatEditValue(field: string, value: unknown): string {
  if (field === 'nutrition' && value && typeof value === 'object') {
    const v = value as { calories?: number; protein?: number; serving_size?: string };
    const parts = [
      v.calories != null ? `${v.calories} cal` : null,
      v.protein != null ? `${v.protein}g protein` : null,
      v.serving_size ?? null,
    ].filter(Boolean);
    return parts.join(' · ') || 'Updated values';
  }
  return String(value);
}

const SECTION: Record<SubTab, { title: string; sub: string }> = {
  cooked: { title: 'Meals you’ve cooked', sub: 'Your running record of everything you’ve made.' },
  saved: { title: 'Saved to cook', sub: 'Your wishlist — ready when you are.' },
  published: { title: 'Meals you’ve published', sub: 'Others see you as the author of these.' },
  fridge: { title: 'What’s in your fridge', sub: 'What you have on hand — your feed uses it.' },
  shopping: { title: 'Shopping list', sub: 'What you still need to pick up.' },
  reviews: { title: 'Reviews you’ve left', sub: 'Every note and score you’ve left after cooking.' },
  edits: { title: 'Edits you’ve suggested', sub: 'Your community contributions to the ingredient catalog.' },
  ratings: { title: 'Meals you’ve rated', sub: 'Your 1–10 rating on every recipe, at a glance.' },
  votes: { title: 'Edits and names you’ve voted on', sub: 'Every vote you’ve cast on a recipe edit or an ingredient’s other names.' },
};

const EMPTY: Record<'cooked' | 'saved' | 'published' | 'reviews' | 'edits' | 'ratings' | 'votes', { title: string; text: string; to: string }> = {
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
  reviews: {
    title: 'No reviews yet',
    text: 'Cook a meal and leave a note — it shows up here.',
    to: '/browse',
  },
  edits: {
    title: 'No edits yet',
    text: 'Suggest a description, category, photo, or nutrition change on any ingredient page.',
    to: '/browse',
  },
  ratings: {
    title: 'No ratings yet',
    text: 'Rate a meal 1–10 from its recipe page — it shows up here.',
    to: '/browse',
  },
  votes: {
    title: 'No votes yet',
    text: 'Vote on a recipe edit in its history, or on an ingredient’s other names.',
    to: '/browse',
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
  const theme = useProfileTheme();
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
  const isKitchenTab = tab === 'fridge' || tab === 'shopping';
  const isContributionTab = tab === 'reviews' || tab === 'edits' || tab === 'ratings' || tab === 'votes';

  const { data: meals = [] } = useQuery({
    queryKey: ['cookbook', tab],
    queryFn: () => api.get<CookbookMeal[]>(`/cookbook/${tab}`),
    enabled: isMealTab,
  });

  const kitchenKey = tab === 'shopping' ? 'shopping' : 'fridge';
  const { data: items = [] } = useQuery({
    queryKey: [kitchenKey],
    queryFn: () => api.get<KitchenItem[]>(`/${kitchenKey}`),
    enabled: isKitchenTab,
  });

  const { data: matches = [] } = useQuery({
    queryKey: ['ingredients', query],
    queryFn: () => api.get<IngredientSummary[]>(`/ingredients?search=${encodeURIComponent(query)}`),
    enabled: isKitchenTab && query.trim().length > 0,
  });

  const { data: reviews = [] } = useQuery({
    queryKey: ['cookbook-reviews'],
    queryFn: () => api.get<MyReview[]>('/cookbook/reviews'),
    enabled: tab === 'reviews',
  });

  const { data: myEdits = [] } = useQuery({
    queryKey: ['cookbook-edits'],
    queryFn: () => api.get<MyEdit[]>('/cookbook/edits'),
    enabled: tab === 'edits',
  });

  const { data: myRatings = [] } = useQuery({
    queryKey: ['cookbook-ratings'],
    queryFn: () => api.get<MyRating[]>('/cookbook/ratings'),
    enabled: tab === 'ratings',
  });

  const { data: myVotes = [] } = useQuery({
    queryKey: ['cookbook-votes'],
    queryFn: () => api.get<MyVote[]>('/cookbook/votes'),
    enabled: tab === 'votes',
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
    reviews: {
      text: 'You’ve also contributed ingredient edits.',
      label: `Edits ${counts?.edits ?? 0}`,
      go: () => setTab('edits'),
    },
    edits: {
      text: 'You’ve also cast votes on edits and names.',
      label: `Votes ${counts?.votes ?? 0}`,
      go: () => setTab('votes'),
    },
    ratings: {
      text: 'You’ve also left reviews on meals you’ve cooked.',
      label: `Reviews ${counts?.reviews ?? 0}`,
      go: () => setTab('reviews'),
    },
    votes: {
      text: 'You’ve also rated meals you’ve cooked.',
      label: `Ratings ${counts?.ratings ?? 0}`,
      go: () => setTab('ratings'),
    },
  };

  const subTabs: SubTab[] =
    group === 'recipes' ? ['cooked', 'saved', 'published']
    : group === 'kitchen' ? ['fridge', 'shopping']
    : ['reviews', 'edits', 'ratings', 'votes'];

  const hasHeroPhoto = Boolean(theme?.cb_hero_photo_url);
  const heroTheme = theme?.cb_hero_theme ?? 'cream';
  const heroBg = hasHeroPhoto
    ? `center/cover no-repeat url("${theme!.cb_hero_photo_url}")`
    : PAGE_THEMES[heroTheme].cardBg;
  const heroColors = heroTextColors(hasHeroPhoto, heroTheme);
  const cookbookTitle = theme?.cb_title?.trim() || 'Your Cookbook';
  const cookbookBio = theme?.cb_bio?.trim();

  return (
    <div className={styles.page}>
      <div className={styles.hero} style={{ background: heroBg }}>
        {hasHeroPhoto && <div className={styles.heroScrim} />}
        <div className={styles.heroRow}>
          <div style={{ minWidth: 0, position: 'relative' }}>
            <div className={styles.heroEyebrow} style={{ color: heroColors.eyebrow }}>
              {user.display_name}'s kitchen
            </div>
            <div className={styles.heroTitle} style={{ color: heroColors.title }}>{cookbookTitle}</div>
            {cookbookBio && (
              <div className={styles.heroBio} style={{ color: heroColors.bio }}>{cookbookBio}</div>
            )}
            <div className={styles.heroStats}>
              <span className={styles.heroStatNum} style={{ color: heroColors.stat }}>{counts?.published ?? 0}</span>
              <span className={styles.heroStatLabel} style={{ color: heroColors.statLabel }}>recipes</span>
              <span style={{ color: heroColors.dot }}>·</span>
              <span className={styles.heroStatNum} style={{ color: heroColors.stat }}>{counts?.cooked ?? 0}</span>
              <span className={styles.heroStatLabel} style={{ color: heroColors.statLabel }}>cooked</span>
            </div>
          </div>
          <div className={styles.heroActions} style={{ position: 'relative' }}>
            <button className={styles.pencil} onClick={() => navigate('/cookbook/customize')} title="Customize">
              <PencilIcon size={19} strokeWidth={1.7} />
            </button>
            {!isDesktop && (
              <Avatar
                name={user.display_name}
                size="md"
                shape="rounded"
                theme={theme?.cb_avatar_theme}
                photoUrl={theme?.cb_avatar_photo_url}
              />
            )}
          </div>
        </div>
      </div>

      <div className={styles.groupSwitch}>
        <Segmented
          value={group}
          fill={!isDesktop}
          onChange={(g) => {
            setGroup(g);
            setTab(g === 'recipes' ? 'cooked' : g === 'kitchen' ? 'fridge' : 'reviews');
            setQuery('');
          }}
          options={[
            { value: 'recipes', label: 'Recipes' },
            { value: 'kitchen', label: 'Kitchen' },
            { value: 'contributions', label: 'Contributions' },
          ]}
        />
        <button className={styles.collectionsLink} onClick={() => navigate('/collections')}>
          📁 Collections
        </button>
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
      ) : isContributionTab ? (
        tab === 'ratings' ? (
          myRatings.length > 0 ? (
            <div className={styles.mealList}>
              {myRatings.map((r) => (
                <button key={r.meal_id} className={styles.mealRow} onClick={() => navigate(`/meals/${r.meal_id}`)}>
                  <span className={styles.mealThumb} style={{ background: mealBackground(r.photo_url, null) }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className={styles.mealName} style={{ display: 'block' }}>{r.meal_name}</span>
                    <span className={styles.reviewScore}>★ {r.value}/10</span>
                    <span className={styles.reviewTime} style={{ display: 'block' }}>
                      {r.updated_at !== r.created_at ? 'Updated ' : 'Rated '}{relativeTime(r.updated_at)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <EmptyCard title={EMPTY.ratings.title} text={EMPTY.ratings.text} onClick={() => navigate(EMPTY.ratings.to)} />
          )
        ) : tab === 'votes' ? (
          myVotes.length > 0 ? (
            <div className={styles.mealList}>
              {myVotes.map((v) => (
                <button
                  key={`${v.kind}-${v.target_id}`}
                  className={styles.mealRow}
                  onClick={() => navigate(v.kind === 'revision' ? `/meals/${v.subject_id}/history` : `/ingredients/${v.subject_id}`)}
                >
                  <span
                    className={styles.mealThumb}
                    style={{ background: v.kind === 'revision' ? mealBackground(null, null) : ingredientBackground(null, null) }}
                  />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className={styles.mealName} style={{ display: 'block' }}>{v.subject_name}</span>
                    <span className={styles.editFieldRow}>
                      <span className={styles.editField}>{v.kind === 'revision' ? 'Edit' : 'Alternate name'}</span>
                      <span className={v.value > 0 ? styles.editWinning : styles.reviewScore}>
                        {v.value > 0 ? '▲ Helped' : '▼ Hurt'}
                      </span>
                    </span>
                    <span className={styles.reviewNote} style={{ display: 'block' }}>{v.label}</span>
                    <span className={styles.reviewTime} style={{ display: 'block' }}>{relativeTime(v.created_at)}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <EmptyCard title={EMPTY.votes.title} text={EMPTY.votes.text} onClick={() => navigate(EMPTY.votes.to)} />
          )
        ) : tab === 'reviews' ? (
          reviews.length > 0 ? (
            <div className={styles.mealList}>
              {reviews.map((r) => (
                <button key={r.id} className={styles.mealRow} onClick={() => navigate(`/meals/${r.meal_id}`)}>
                  <span className={styles.mealThumb} style={{ background: mealBackground(r.photo_url, null) }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className={styles.mealName} style={{ display: 'block' }}>{r.meal_name}</span>
                    {r.score != null && <span className={styles.reviewScore}>★ {r.score}/10</span>}
                    {r.note && <span className={styles.reviewNote} style={{ display: 'block' }}>{r.note}</span>}
                    <span className={styles.reviewTime} style={{ display: 'block' }}>
                      {relativeTime(r.cooked_at)}{!r.is_public && ' · Private'}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <EmptyCard
              title={EMPTY.reviews.title}
              text={EMPTY.reviews.text}
              onClick={() => navigate(EMPTY.reviews.to)}
            />
          )
        ) : myEdits.length > 0 ? (
          <div className={styles.mealList}>
            {myEdits.map((e) => (
              <button key={e.id} className={styles.mealRow} onClick={() => navigate(`/ingredients/${e.ingredient_id}`)}>
                {e.field === 'photo' ? (
                  <span className={styles.mealThumb} style={{ background: `center/cover no-repeat url("${String(e.value)}")` }} />
                ) : (
                  <span className={styles.mealThumb} style={{ background: ingredientBackground(null, e.ingredient_category) }} />
                )}
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className={styles.mealName} style={{ display: 'block' }}>{e.ingredient_name}</span>
                  <span className={styles.editFieldRow}>
                    <span className={styles.editField}>{FIELD_LABEL[e.field] ?? e.field}</span>
                    {e.is_winning && <span className={styles.editWinning}>Winning</span>}
                  </span>
                  {e.field !== 'photo' && (
                    <span className={styles.reviewNote} style={{ display: 'block' }}>
                      {formatEditValue(e.field, e.value)}
                    </span>
                  )}
                  <span className={styles.reviewTime} style={{ display: 'block' }}>
                    {relativeTime(e.created_at)} · {e.votes} vote{e.votes === 1 ? '' : 's'}
                  </span>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <EmptyCard title={EMPTY.edits.title} text={EMPTY.edits.text} onClick={() => navigate(EMPTY.edits.to)} />
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
