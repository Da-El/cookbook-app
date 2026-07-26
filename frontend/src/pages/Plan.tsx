import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { GroceryList, PlanEntry, PlanSlot, PlanSuggestion } from '../api/types';
import type { CookbookMealLite } from '../api/types';
import { Segmented } from '../components/Segmented/Segmented';
import { EmptyLine } from '../components/Empty/Empty';
import { useToast } from '../components/Toast/ToastContext';
import { mealBackground, ingredientBackground } from '../lib/imagery';
import styles from './Plan.module.css';

type View = 'week' | 'grocery';

const SLOTS: PlanSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];
const SLOT_LABEL: Record<PlanSlot, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
};

/** Local-date ISO string; toISOString() would shift the day in most timezones. */
function isoDate(d: Date): string {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function startOfWeek(base: Date): Date {
  const d = new Date(base);
  // Monday-first: getDay() is 0 for Sunday, which should close a week, not open one.
  const offset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - offset);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function Plan() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();

  const [weekOffset, setWeekOffset] = useState(0);
  const [view, setView] = useState<View>('week');
  const [picking, setPicking] = useState<{ date: string; slot: PlanSlot } | null>(null);

  const weekStart = useMemo(() => {
    const d = startOfWeek(new Date());
    d.setDate(d.getDate() + weekOffset * 7);
    return d;
  }, [weekOffset]);

  const days = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const d = new Date(weekStart);
        d.setDate(d.getDate() + i);
        return d;
      }),
    [weekStart],
  );

  const from = isoDate(days[0]);
  const to = isoDate(days[6]);
  const todayIso = isoDate(new Date());

  const { data: entries = [] } = useQuery({
    queryKey: ['plan', from, to],
    queryFn: () => api.get<PlanEntry[]>(`/plan?from=${from}&to=${to}`),
  });

  const { data: grocery } = useQuery({
    queryKey: ['plan-grocery', from, to],
    queryFn: () => api.get<GroceryList>(`/plan/grocery?from=${from}&to=${to}`),
    enabled: view === 'grocery',
  });

  const { data: suggestions = [] } = useQuery({
    queryKey: ['plan-suggestions', from, to],
    queryFn: () => api.get<PlanSuggestion[]>(`/plan/suggestions?from=${from}&to=${to}`),
    enabled: view === 'week' && entries.length > 0,
  });

  const { data: cookbook = [] } = useQuery({
    queryKey: ['plan-pickable'],
    queryFn: async () => {
      const [saved, published, cooked] = await Promise.all([
        api.get<CookbookMealLite[]>('/cookbook/saved'),
        api.get<CookbookMealLite[]>('/cookbook/published'),
        api.get<CookbookMealLite[]>('/cookbook/cooked'),
      ]);
      // One list, de-duplicated: a meal can be saved and cooked at once.
      const seen = new Set<number>();
      return [...published, ...saved, ...cooked].filter((m) =>
        seen.has(m.id) ? false : (seen.add(m.id), true),
      );
    },
    enabled: picking !== null,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['plan', from, to] });
    qc.invalidateQueries({ queryKey: ['plan-grocery', from, to] });
    qc.invalidateQueries({ queryKey: ['plan-suggestions', from, to] });
  };

  const addEntry = useMutation({
    mutationFn: (b: { plan_date: string; slot: PlanSlot; meal_id: number }) => api.post('/plan', b),
    onSuccess: () => {
      setPicking(null);
      invalidate();
    },
  });

  const removeEntry = useMutation({
    mutationFn: (id: number) => api.del(`/plan/${id}`),
    onSuccess: invalidate,
  });

  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const toggleTick = (key: string) =>
    setTicked((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const push = useMutation({
    mutationFn: () =>
      api.post<{ added: number }>('/plan/grocery/push', { keys: [...ticked], from, to }),
    onSuccess: (r) => {
      toast(r.added ? `Added ${r.added} to your shopping list` : 'Already on your list');
      setTicked(new Set());
      qc.invalidateQueries({ queryKey: ['shopping'] });
      qc.invalidateQueries({ queryKey: ['cookbook-counts'] });
    },
  });

  const weekLabel = `${days[0].toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${days[6].toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <div>
          <div className={styles.eyebrow}>Meal plan</div>
          <h1 className={styles.title}>{weekLabel}</h1>
        </div>
        <div className={styles.weekNav}>
          <button className={styles.navBtn} onClick={() => setWeekOffset((w) => w - 1)} aria-label="Previous week">
            ‹
          </button>
          <button className={styles.navToday} onClick={() => setWeekOffset(0)}>
            This week
          </button>
          <button className={styles.navBtn} onClick={() => setWeekOffset((w) => w + 1)} aria-label="Next week">
            ›
          </button>
        </div>
      </div>

      <div className={styles.viewSwitch}>
        <Segmented
          value={view}
          fill
          onChange={setView}
          options={[
            { value: 'week', label: 'Week' },
            { value: 'grocery', label: 'Grocery list' },
          ]}
        />
      </div>

      {view === 'week' ? (
        <>
          <div className={styles.days}>
            {days.map((d) => {
              const iso = isoDate(d);
              const forDay = entries.filter((e) => e.plan_date === iso);
              return (
                <div key={iso} className={`${styles.day} ${iso === todayIso ? styles.dayToday : ''}`}>
                  <div className={styles.dayHead}>
                    <span className={styles.dayName}>
                      {d.toLocaleDateString(undefined, { weekday: 'short' })}
                    </span>
                    <span className={styles.dayNum}>{d.getDate()}</span>
                  </div>

                  {SLOTS.map((slot) => {
                    const inSlot = forDay.filter((e) => e.slot === slot);
                    return (
                      <div key={slot} className={styles.slot}>
                        <div className={styles.slotLabel}>{SLOT_LABEL[slot]}</div>
                        {inSlot.map((e) => (
                          <div key={e.id} className={styles.planned}>
                            <button
                              className={styles.plannedOpen}
                              onClick={() => navigate(`/meals/${e.meal_id}`)}
                            >
                              <span
                                className={styles.plannedThumb}
                                style={{ background: mealBackground(e.photo_url, e.cuisine) }}
                              />
                              <span style={{ flex: 1, minWidth: 0 }}>
                                <span className={styles.plannedName}>{e.meal_name}</span>
                                <span className={styles.plannedMeta}>
                                  {e.time_minutes} min
                                  {e.servings > 1 && ` · ${e.servings} servings`}
                                </span>
                              </span>
                            </button>
                            <button
                              className={styles.plannedX}
                              onClick={() => removeEntry.mutate(e.id)}
                              aria-label={`Remove ${e.meal_name}`}
                            >
                              ×
                            </button>
                          </div>
                        ))}
                        <button
                          className={styles.addSlot}
                          onClick={() => setPicking({ date: iso, slot })}
                        >
                          + Add
                        </button>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>

          {suggestions.length > 0 && (
            <>
              <h2 className={styles.sectionTitle}>Uses what you're already buying</h2>
              <p className={styles.sectionSub}>
                Adding one of these means less of the week's shopping goes to waste.
              </p>
              <div className={styles.suggestions}>
                {suggestions.map((s) => (
                  <button
                    key={s.id}
                    className={styles.suggestion}
                    onClick={() => navigate(`/meals/${s.id}`)}
                  >
                    <span
                      className={styles.suggestionThumb}
                      style={{ background: mealBackground(s.photo_url, s.cuisine) }}
                    />
                    <span className={styles.suggestionName}>{s.name}</span>
                    <span className={styles.suggestionShare}>
                      shares {s.shared} of {s.total}
                    </span>
                    {s.shared_names.length > 0 && (
                      <span className={styles.suggestionWhy}>{s.shared_names.slice(0, 3).join(', ')}</span>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      ) : (
        <>
          {grocery && grocery.meals_planned > 0 ? (
            <>
              <div className={styles.groceryHead}>
                <span>
                  {grocery.meals_planned} meal{grocery.meals_planned === 1 ? '' : 's'} planned
                  {grocery.shared_count > 0 && (
                    <>
                      {' · '}
                      <strong>{grocery.shared_count}</strong> ingredient
                      {grocery.shared_count === 1 ? '' : 's'} used more than once
                    </>
                  )}
                </span>
              </div>

              <div className={styles.groceryList}>
                {grocery.items.map((it) => (
                  <label key={it.key} className={styles.groceryRow}>
                    <input
                      type="checkbox"
                      className={styles.check}
                      checked={ticked.has(it.key)}
                      onChange={() => toggleTick(it.key)}
                    />
                    <span
                      className={styles.groceryThumb}
                      style={{ background: ingredientBackground(null, it.category) }}
                    />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className={styles.groceryName}>
                        {it.name}
                        {it.in_fridge && <span className={styles.haveChip}>in your fridge</span>}
                        {it.meal_count > 1 && (
                          <span className={styles.sharedChip}>×{it.meal_count} meals</span>
                        )}
                      </span>
                      <span className={styles.groceryMeta}>
                        {it.total_label ?? (it.unquantified.join(', ') || '—')}
                        {it.total_label && it.unquantified.length > 0 && ` · ${it.unquantified.join(', ')}`}
                      </span>
                      <span className={styles.groceryFrom}>{it.from_meals.join(' · ')}</span>
                    </span>
                  </label>
                ))}
              </div>

              <button
                className={styles.pushBtn}
                disabled={ticked.size === 0 || push.isPending}
                onClick={() => push.mutate()}
              >
                {push.isPending
                  ? 'Adding…'
                  : `Add ${ticked.size || ''} to shopping list`.replace('  ', ' ')}
              </button>
            </>
          ) : (
            <div style={{ marginTop: 20 }}>
              <EmptyLine roomy>Plan some meals this week and the shopping list builds itself.</EmptyLine>
            </div>
          )}
        </>
      )}

      {picking && (
        <>
          <div className={styles.scrim} onClick={() => setPicking(null)} />
          <div className={styles.sheet}>
            <div className={styles.sheetHead}>
              <span className={styles.sheetTitle}>
                Add to {SLOT_LABEL[picking.slot].toLowerCase()}
              </span>
              <button className={styles.sheetClose} onClick={() => setPicking(null)} aria-label="Close">
                ×
              </button>
            </div>
            {cookbook.length > 0 ? (
              <div className={styles.pickList}>
                {cookbook.map((m) => (
                  <button
                    key={m.id}
                    className={styles.pickRow}
                    onClick={() =>
                      addEntry.mutate({ plan_date: picking.date, slot: picking.slot, meal_id: m.id })
                    }
                  >
                    <span
                      className={styles.pickThumb}
                      style={{ background: mealBackground(m.photo_url, m.cuisine) }}
                    />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className={styles.pickName}>{m.name}</span>
                      <span className={styles.pickMeta}>
                        {m.cuisine} · {m.time_minutes} min
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div style={{ padding: '4px 4px 12px' }}>
                <EmptyLine>
                  Nothing in your cookbook yet — save or import a recipe and it'll show up here.
                </EmptyLine>
              </div>
            )}
            <button className={styles.browseBtn} onClick={() => navigate('/browse')}>
              Browse all recipes
            </button>
          </div>
        </>
      )}
    </div>
  );
}
