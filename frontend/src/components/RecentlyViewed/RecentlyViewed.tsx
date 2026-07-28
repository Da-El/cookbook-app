import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getRecentlyViewed, type RecentlyViewedItem } from '../../lib/recentlyViewed';
import { mealBackground, ingredientBackground } from '../../lib/imagery';
import styles from './RecentlyViewed.module.css';

/**
 * A quick way back to a meal or ingredient page the user just left -
 * client-side only (localStorage), so it reads the list fresh on every
 * mount rather than subscribing to writes from other tabs/components.
 * Renders nothing until there's real history, same graceful-absence
 * pattern as FeaturedMeal/TodayNutrition.
 */
export function RecentlyViewed() {
  const navigate = useNavigate();
  const [items, setItems] = useState<RecentlyViewedItem[]>([]);

  useEffect(() => {
    setItems(getRecentlyViewed());
  }, []);

  if (items.length === 0) return null;

  return (
    <div className={styles.section}>
      <span className={styles.title}>Recently viewed</span>
      <div className={`${styles.rail} hscroll`}>
        {items.map((item) => (
          <button
            key={`${item.kind}-${item.id}`}
            className={styles.card}
            onClick={() => navigate(item.kind === 'meal' ? `/meals/${item.id}` : `/ingredients/${item.id}`)}
          >
            <span
              className={styles.thumb}
              style={{
                background:
                  item.kind === 'meal'
                    ? mealBackground(item.photo_url, item.subtitle)
                    : ingredientBackground(item.photo_url, item.subtitle),
              }}
            />
            <span className={styles.name}>{item.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
