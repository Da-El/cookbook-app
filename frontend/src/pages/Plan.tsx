import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { GroceryItem, GroceryList, PlanEntry, PlanSlot, PlanSuggestion, PlanTemplate } from '../api/types';
import type { CookbookMealLite } from '../api/types';
import { Segmented } from '../components/Segmented/Segmented';
import { EmptyLine } from '../components/Empty/Empty';
import { useToast } from '../components/Toast/ToastContext';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { useIsDesktop } from '../hooks/useMediaQuery';
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

/** Groups already-category-sorted items into consecutive runs, preserving the
 * server's order within each - a re-sort here would fight the "shared items
 * first within the aisle" ordering the backend already computed. */
function groceryByAisle(items: GroceryItem[]): [string, GroceryItem[]][] {
  const groups: [string, GroceryItem[]][] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last[0] === item.category) {
      last[1].push(item);
    } else {
      groups.push([item.category, [item]]);
    }
  }
  return groups;
}

/** Plain-text version of the list, grouped by aisle like the on-screen
 * version - meant for pasting into a Notes app or texting to whoever else
 * is doing the shopping, not for parsing back in. */
function groceryListText(grocery: GroceryList): string {
  const lines = [`Grocery list (${grocery.meals_planned} meal${grocery.meals_planned === 1 ? '' : 's'} planned)`, ''];
  for (const [category, items] of groceryByAisle(grocery.items)) {
    lines.push(category.toUpperCase());
    for (const it of items) {
      const qty = it.total_label ?? (it.unquantified.join(', ') || '');
      lines.push(`- ${it.name}${qty ? ` — ${qty}` : ''}`);
    }
    lines.push('');
  }
  return lines.join('\n').trim();
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
  const isDesktop = useIsDesktop();
  const qc = useQueryClient();
  const toast = useToast();

  const [weekOffset, setWeekOffset] = useState(0);
  // Which single day the mobile view is showing - a full 7-day x 4-slot
  // grid stacked in one column is 28 tap targets and a long scroll before
  // you can act on anything, the same "too much at once" problem Browse's
  // filter wall had. Desktop keeps the real 7-column grid; mobile shows one
  // day at a time behind a day-strip, the same pattern Google/Apple
  // Calendar use on a phone.
  const [selectedDayIso, setSelectedDayIso] = useState<string | null>(null);
  const [view, setView] = useState<View>('week');
  // `swapId` set means this sheet is replacing an existing entry's meal
  // in place rather than adding a new one - same picker UI, different action
  // on click, so a swap doesn't need its own dialog built from scratch.
  const [picking, setPicking] = useState<{ date: string; slot: PlanSlot; swapId?: number } | null>(null);
  useEscapeKey(() => setPicking(null), picking !== null);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateName, setTemplateName] = useState('');

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
  // Falls back to today-if-in-week, else the week's first day - so paging a
  // week forward/back doesn't strand the selection on a date that's no
  // longer on screen.
  const activeDayIso =
    selectedDayIso && days.some((d) => isoDate(d) === selectedDayIso)
      ? selectedDayIso
      : days.some((d) => isoDate(d) === todayIso)
        ? todayIso
        : from;
  const daysToRender = isDesktop ? days : days.filter((d) => isoDate(d) === activeDayIso);

  const { data: entries = [] } = useQuery({
    queryKey: ['plan', from, to],
    queryFn: () => api.get<PlanEntry[]>(`/plan?from=${from}&to=${to}`),
  });

  const { data: templates = [] } = useQuery({
    queryKey: ['plan-templates'],
    queryFn: () => api.get<PlanTemplate[]>('/plan/templates'),
    enabled: view === 'week',
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

  const updateEntry = useMutation({
    mutationFn: ({ id, ...patch }: { id: number; meal_id?: number; servings?: number }) =>
      api.post(`/plan/${id}`, patch),
    onSuccess: () => {
      setPicking(null);
      invalidate();
    },
  });

  const moveEntry = useMutation({
    mutationFn: ({ id, direction }: { id: number; direction: 'up' | 'down' }) =>
      api.post(`/plan/${id}/move`, { direction }),
    onSuccess: invalidate,
  });

  const saveTemplate = useMutation({
    mutationFn: () => api.post('/plan/templates', { name: templateName.trim(), from, to }),
    onSuccess: () => {
      setSavingTemplate(false);
      setTemplateName('');
      toast('Saved as a template');
      qc.invalidateQueries({ queryKey: ['plan-templates'] });
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not save that template.'),
  });

  const deleteTemplate = useMutation({
    mutationFn: (id: number) => api.del(`/plan/templates/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plan-templates'] }),
  });

  const applyTemplate = useMutation({
    mutationFn: (id: number) => api.post<{ applied: number }>(`/plan/templates/${id}/apply`, { start_date: from }),
    onSuccess: (r) => {
      toast(`Added ${r.applied} meal${r.applied === 1 ? '' : 's'} to this week`);
      invalidate();
    },
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

  // Web Share on a phone (hands it straight to Messages/Notes/etc.);
  // clipboard everywhere else, since desktop browsers mostly don't
  // implement `navigator.share` at all.
  async function shareGroceryList() {
    if (!grocery) return;
    const text = groceryListText(grocery);
    if (navigator.share) {
      try {
        await navigator.share({ text, title: 'Grocery list' });
      } catch {
        // AbortError from the user cancelling the share sheet - not a failure.
      }
      return;
    }
    await navigator.clipboard.writeText(text);
    toast('Copied to clipboard');
  }

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

      {view === 'week' && (templates.length > 0 || entries.length > 0) && (
        <div className={`${styles.templateRow} hscroll`}>
          {templates.map((t) => (
            <span key={t.id} className={styles.templateChip}>
              <button
                className={styles.templateChipApply}
                onClick={() => applyTemplate.mutate(t.id)}
                disabled={applyTemplate.isPending}
                title={`Apply "${t.name}" to this week`}
              >
                {t.name} ({t.entry_count})
              </button>
              <button
                className={styles.templateChipRemove}
                onClick={() => {
                  if (confirm(`Delete the template "${t.name}"? This doesn't touch any week already using it.`)) {
                    deleteTemplate.mutate(t.id);
                  }
                }}
                aria-label={`Delete template "${t.name}"`}
              >
                ×
              </button>
            </span>
          ))}
          {entries.length > 0 &&
            (savingTemplate ? (
              <span className={styles.templateSaveForm}>
                <input
                  className={styles.templateSaveInput}
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="Name this week…"
                  maxLength={60}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && templateName.trim()) saveTemplate.mutate();
                    if (e.key === 'Escape') setSavingTemplate(false);
                  }}
                />
                <button
                  className={styles.templateSaveConfirm}
                  disabled={!templateName.trim() || saveTemplate.isPending}
                  onClick={() => saveTemplate.mutate()}
                >
                  Save
                </button>
              </span>
            ) : (
              <button className={styles.templateSaveBtn} onClick={() => setSavingTemplate(true)}>
                + Save this week as template
              </button>
            ))}
        </div>
      )}

      {view === 'week' ? (
        <>
          {!isDesktop && (
            <div className={`${styles.dayStrip} hscroll`}>
              {days.map((d) => {
                const iso = isoDate(d);
                const count = entries.filter((e) => e.plan_date === iso).length;
                return (
                  <button
                    key={iso}
                    className={`${styles.dayStripCell} ${iso === activeDayIso ? styles.dayStripCellActive : ''} ${iso === todayIso ? styles.dayStripCellToday : ''}`}
                    onClick={() => setSelectedDayIso(iso)}
                  >
                    <span className={styles.dayStripName}>
                      {d.toLocaleDateString(undefined, { weekday: 'short' })}
                    </span>
                    <span className={styles.dayStripNum}>{d.getDate()}</span>
                    {count > 0 && <span className={styles.dayStripDot} />}
                  </button>
                );
              })}
            </div>
          )}

          <div className={styles.days}>
            {daysToRender.map((d) => {
              const iso = isoDate(d);
              const forDay = entries.filter((e) => e.plan_date === iso);
              return (
                <div key={iso} className={`${styles.day} ${iso === todayIso ? styles.dayToday : ''}`}>
                  {isDesktop && (
                    <div className={styles.dayHead}>
                      <span className={styles.dayName}>
                        {d.toLocaleDateString(undefined, { weekday: 'short' })}
                      </span>
                      <span className={styles.dayNum}>{d.getDate()}</span>
                    </div>
                  )}

                  {SLOTS.map((slot) => {
                    const inSlot = forDay.filter((e) => e.slot === slot);
                    return (
                      <div key={slot} className={styles.slot}>
                        <div className={styles.slotLabel}>{SLOT_LABEL[slot]}</div>
                        {inSlot.map((e, i) => (
                          <div key={e.id} className={styles.planned}>
                            {inSlot.length > 1 && (
                              <div className={styles.plannedReorder}>
                                <button
                                  className={styles.plannedReorderBtn}
                                  disabled={i === 0 || moveEntry.isPending}
                                  onClick={() => moveEntry.mutate({ id: e.id, direction: 'up' })}
                                  aria-label={`Move ${e.meal_name} earlier`}
                                >
                                  ▲
                                </button>
                                <button
                                  className={styles.plannedReorderBtn}
                                  disabled={i === inSlot.length - 1 || moveEntry.isPending}
                                  onClick={() => moveEntry.mutate({ id: e.id, direction: 'down' })}
                                  aria-label={`Move ${e.meal_name} later`}
                                >
                                  ▼
                                </button>
                              </div>
                            )}
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
                                  {e.rating > 0 && ` · ★${e.rating.toFixed(1)}`}
                                </span>
                              </span>
                            </button>
                            <div className={styles.plannedActions}>
                              <button
                                className={styles.plannedSwap}
                                onClick={() => setPicking({ date: iso, slot, swapId: e.id })}
                                aria-label={`Swap ${e.meal_name} for a different recipe`}
                                title="Swap for a different recipe"
                              >
                                ⇄
                              </button>
                              <button
                                className={styles.plannedX}
                                onClick={() => removeEntry.mutate(e.id)}
                                aria-label={`Remove ${e.meal_name}`}
                              >
                                ×
                              </button>
                            </div>
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
                <button className={styles.shareBtn} onClick={shareGroceryList}>
                  Share list
                </button>
              </div>

              {/* Grouped by aisle (the server already sorts items this way)
                  rather than one flat list - a store trip means walking
                  produce, then dairy, then pantry, not bouncing between them. */}
              {groceryByAisle(grocery.items).map(([category, items]) => (
                <div key={category} className={styles.aisleGroup}>
                  <div className={styles.aisleLabel}>{category}</div>
                  <div className={styles.groceryList}>
                    {items.map((it) => (
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
                </div>
              ))}

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
                {picking.swapId
                  ? `Swap this ${SLOT_LABEL[picking.slot].toLowerCase()} for…`
                  : `Add to ${SLOT_LABEL[picking.slot].toLowerCase()}`}
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
                      picking.swapId
                        ? updateEntry.mutate({ id: picking.swapId, meal_id: m.id })
                        : addEntry.mutate({ plan_date: picking.date, slot: picking.slot, meal_id: m.id })
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
