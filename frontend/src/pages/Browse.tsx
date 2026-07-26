import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { IngredientSummary } from '../api/types';
import { Chip } from '../components/Chip/Chip';
import styles from './Browse.module.css';

export function Browse() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string | null>(null);

  const { data: categories = [] } = useQuery({
    queryKey: ['ingredient-categories'],
    queryFn: () => api.get<string[]>('/ingredients/categories'),
  });

  const { data: ingredients = [], isLoading } = useQuery({
    queryKey: ['ingredients', search, category],
    queryFn: () => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (category) params.set('category', category);
      return api.get<IngredientSummary[]>(`/ingredients?${params}`);
    },
  });

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Browse</h1>

      <input
        className={styles.search}
        placeholder="Search ingredients…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className={styles.filters}>
        <Chip active={category === null} onClick={() => setCategory(null)}>
          All
        </Chip>
        {categories.map((c) => (
          <Chip key={c} active={category === c} onClick={() => setCategory(c)}>
            {c}
          </Chip>
        ))}
      </div>

      {!isLoading && <p className={styles.count}>{ingredients.length} ingredients</p>}

      <div className={styles.list}>
        {ingredients.map((ing) => (
          <button
            key={ing.id}
            className={styles.row}
            onClick={() => navigate(`/ingredients/${ing.id}`)}
          >
            <span>
              <span className={styles.rowName}>{ing.name}</span>
              <br />
              <span className={styles.rowSub}>{ing.foodb_subgroup ?? ing.category}</span>
            </span>
          </button>
        ))}
      </div>

      {!isLoading && ingredients.length === 0 && (
        <p className={styles.empty}>No ingredients match that search.</p>
      )}
    </div>
  );
}
