import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { mealBackground } from '../../lib/imagery';
import styles from './FeaturedMeal.module.css';

interface FeaturedMealData {
  id: number;
  name: string;
  cuisine: string;
  time_minutes: number;
  rating: number;
  rating_count: number;
  photo_url: string | null;
  author_name: string;
}

/**
 * A random pick from meals someone has actually rated - "featured" reads
 * as an editorial choice, so this deliberately excludes unrated recipes
 * `min_rating_count=1` does the filtering server-side rather than a
 * client-side retry loop hoping for a rated one. Falls back to nothing
 * rendered at all once the catalog has no rated meals yet, rather than a
 * broken-feeling empty card.
 */
export function FeaturedMeal() {
  const navigate = useNavigate();
  const { data } = useQuery({
    queryKey: ['featured-meal'],
    queryFn: () => api.get<FeaturedMealData>('/meals/random?min_rating_count=1'),
    retry: false,
    staleTime: Infinity,
  });

  if (!data) return null;

  return (
    <button className={styles.card} onClick={() => navigate(`/meals/${data.id}`)}>
      <div className={styles.photo} style={{ background: mealBackground(data.photo_url, data.cuisine) }} />
      <div className={styles.body}>
        <span className={styles.eyebrow}>✨ Featured</span>
        <span className={styles.name}>{data.name}</span>
        <span className={styles.meta}>
          {data.cuisine} · {data.time_minutes} min · ★ {data.rating.toFixed(1)} · by {data.author_name}
        </span>
      </div>
    </button>
  );
}
