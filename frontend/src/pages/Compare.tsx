import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueries, useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { IngredientDetail, IngredientSummary, Micros } from '../api/types';
import { LoadingState } from '../components/PageState/PageState';
import { EmptyLine } from '../components/Empty/Empty';
import { ChevronLeft } from '../components/Icon/Icon';
import styles from './Compare.module.css';

const MAX_ITEMS = 3;

const MICRO_ROWS: [keyof Micros, string][] = [
  ['vit_c_mg', 'Vitamin C'],
  ['calcium_mg', 'Calcium'],
  ['iron_mg', 'Iron'],
  ['potassium_mg', 'Potassium'],
  ['magnesium_mg', 'Magnesium'],
  ['sodium_mg', 'Sodium'],
];

function fmt(v: number | null | undefined, unit: string) {
  return v == null ? '—' : `${v}${unit}`;
}

/** Highlights the best (or worst, for sodium) value in a row across the
 * ingredients being compared - the whole point of a side-by-side view is
 * spotting the difference at a glance, not just listing the same numbers
 * in three columns. */
function bestIndex(values: (number | null)[], lowerIsBetter: boolean): number | null {
  let best: number | null = null;
  let bestVal: number | null = null;
  values.forEach((v, i) => {
    if (v == null) return;
    if (bestVal == null || (lowerIsBetter ? v < bestVal : v > bestVal)) {
      bestVal = v;
      best = i;
    }
  });
  // Only worth calling out when the values actually differ.
  const distinct = new Set(values.filter((v): v is number => v != null));
  return distinct.size > 1 ? best : null;
}

/**
 * Nutrition (and rating) for two or three ingredients, side by side -
 * "which of these is actually lower-sodium" is a question a single
 * ingredient page can't answer on its own.
 */
export function Compare() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');

  const ids = (params.get('ids') ?? '')
    .split(',')
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n) && n > 0);

  function setIds(next: number[]) {
    setParams(next.length > 0 ? { ids: next.join(',') } : {});
  }

  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: ['ingredient', String(id)],
      queryFn: () => api.get<IngredientDetail>(`/ingredients/${id}`),
    })),
  });
  const items = results.map((r) => r.data).filter((d): d is IngredientDetail => Boolean(d));
  const loading = results.some((r) => r.isLoading);

  const { data: matches = [] } = useQuery({
    queryKey: ['ingredients', query],
    queryFn: () => api.get<IngredientSummary[]>(`/ingredients?search=${encodeURIComponent(query)}`),
    enabled: query.trim().length > 1,
  });

  function addIngredient(id: number) {
    if (ids.includes(id) || ids.length >= MAX_ITEMS) return;
    setIds([...ids, id]);
    setQuery('');
  }

  function removeIngredient(id: number) {
    setIds(ids.filter((i) => i !== id));
  }

  const calorieRow = items.map((i) => i.nutrition?.calories ?? null);
  const proteinRow = items.map((i) => i.nutrition?.protein ?? null);
  const carbsRow = items.map((i) => i.nutrition?.carbs ?? null);
  const fatRow = items.map((i) => i.nutrition?.fat ?? null);
  const fiberRow = items.map((i) => i.nutrition?.fiber ?? null);
  const sugarRow = items.map((i) => i.nutrition?.sugar ?? null);
  const ratingRow = items.map((i) => (i.rating_count > 0 ? i.rating : null));

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate(-1)} aria-label="Back">
          <ChevronLeft size={18} strokeWidth={2.2} />
        </button>
        <div>
          <h1 className={styles.title}>Compare ingredients</h1>
          <p className={styles.subtitle}>Nutrition and rating, side by side</p>
        </div>
      </div>

      {ids.length < MAX_ITEMS && (
        <div className={styles.search}>
          <input
            className={styles.searchInput}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={ids.length === 0 ? 'Search for an ingredient to start…' : 'Add another ingredient…'}
          />
          {query.trim().length > 1 && matches.length > 0 && (
            <div className={styles.matches}>
              {matches
                .filter((m) => !ids.includes(m.id))
                .slice(0, 6)
                .map((m) => (
                  <button key={m.id} className={styles.matchRow} onClick={() => addIngredient(m.id)}>
                    {m.name}
                  </button>
                ))}
            </div>
          )}
        </div>
      )}

      {loading && ids.length > 0 && <LoadingState label="Loading ingredients…" />}

      {ids.length === 0 && !loading && (
        <div style={{ marginTop: 20 }}>
          <EmptyLine roomy>Search above to add your first ingredient.</EmptyLine>
        </div>
      )}

      {items.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.rowLabel} />
                {items.map((i) => (
                  <th key={i.id} className={styles.colHead}>
                    <button className={styles.colName} onClick={() => navigate(`/ingredients/${i.id}`)}>
                      {i.name}
                    </button>
                    <button
                      className={styles.removeBtn}
                      onClick={() => removeIngredient(i.id)}
                      aria-label={`Remove ${i.name}`}
                    >
                      ×
                    </button>
                  </th>
                ))}
                {items.length < MAX_ITEMS && <th className={styles.addColHead} />}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className={styles.rowLabel}>Rating</td>
                {items.map((i, idx) => (
                  <td key={i.id} className={idx === bestIndex(ratingRow, false) ? styles.best : ''}>
                    {i.rating_count > 0 ? `★ ${i.rating.toFixed(1)} (${i.rating_count})` : '—'}
                  </td>
                ))}
              </tr>
              <tr>
                <td className={styles.rowLabel}>Serving</td>
                {items.map((i) => (
                  <td key={i.id}>{i.nutrition?.serving_size ?? '—'}</td>
                ))}
              </tr>
              <tr>
                <td className={styles.rowLabel}>Calories</td>
                {items.map((i, idx) => (
                  <td key={i.id} className={idx === bestIndex(calorieRow, true) ? styles.best : ''}>
                    {fmt(calorieRow[idx], '')}
                  </td>
                ))}
              </tr>
              <tr>
                <td className={styles.rowLabel}>Protein</td>
                {items.map((i, idx) => (
                  <td key={i.id} className={idx === bestIndex(proteinRow, false) ? styles.best : ''}>
                    {fmt(proteinRow[idx], 'g')}
                  </td>
                ))}
              </tr>
              <tr>
                <td className={styles.rowLabel}>Carbs</td>
                {items.map((i, idx) => (
                  <td key={i.id} className={idx === bestIndex(carbsRow, true) ? styles.best : ''}>
                    {fmt(carbsRow[idx], 'g')}
                  </td>
                ))}
              </tr>
              <tr>
                <td className={styles.rowLabel}>Fat</td>
                {items.map((i, idx) => (
                  <td key={i.id} className={idx === bestIndex(fatRow, true) ? styles.best : ''}>
                    {fmt(fatRow[idx], 'g')}
                  </td>
                ))}
              </tr>
              <tr>
                <td className={styles.rowLabel}>Fiber</td>
                {items.map((i, idx) => (
                  <td key={i.id} className={idx === bestIndex(fiberRow, false) ? styles.best : ''}>
                    {fmt(fiberRow[idx], 'g')}
                  </td>
                ))}
              </tr>
              <tr>
                <td className={styles.rowLabel}>Sugar</td>
                {items.map((i, idx) => (
                  <td key={i.id} className={idx === bestIndex(sugarRow, true) ? styles.best : ''}>
                    {fmt(sugarRow[idx], 'g')}
                  </td>
                ))}
              </tr>
              {MICRO_ROWS.map(([key, label]) => {
                const row = items.map((i) => i.nutrition?.micros[key] ?? null);
                return (
                  <tr key={key}>
                    <td className={styles.rowLabel}>{label}</td>
                    {items.map((i, idx) => (
                      <td key={i.id} className={idx === bestIndex(row, key === 'sodium_mg') ? styles.best : ''}>
                        {fmt(row[idx], 'mg')}
                      </td>
                    ))}
                  </tr>
                );
              })}
              <tr>
                <td className={styles.rowLabel}>Diet</td>
                {items.map((i) => (
                  <td key={i.id} className={styles.dietCell}>
                    {i.diet_flags.length > 0
                      ? i.diet_flags.map((f) => f.charAt(0).toUpperCase() + f.slice(1)).join(', ')
                      : '—'}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
