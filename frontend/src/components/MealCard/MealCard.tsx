import { useNavigate } from 'react-router-dom';
import { mealBackground } from '../../lib/imagery';
import styles from './MealCard.module.css';

export interface MealCardData {
  id: number;
  name: string;
  cuisine: string;
  time_minutes: number;
  rating: number;
  photo_url: string | null;
  have_count?: number;
  total_count?: number;
  /// Set server-side from the vote-and-volume-weighted ranking, not the raw
  /// average - a meal with one 10/10 doesn't outrank one with fifty 9s just
  /// because its displayed number is higher. Optional: only the handful of
  /// endpoints that already compute ranked_score set it.
  is_top_in_cuisine?: boolean;
  /// Diets every catalog-matched ingredient supports (see backend/src/diet.rs).
  diet_tags?: string[];
  /// Distinct users who've cooked this - a popularity signal independent of
  /// rating_count, since cooking something and rating it are separate
  /// actions. Optional for the same reason is_top_in_cuisine is.
  cook_count?: number;
}

/// vegan implies vegetarian implies pescatarian in how diet.rs tags
/// ingredients, so showing all three that are present would just repeat the
/// same claim at decreasing strength - one badge, the strongest true one.
function headlineDiet(tags: string[] | undefined): string | null {
  if (!tags) return null;
  if (tags.includes('vegan')) return 'Vegan';
  if (tags.includes('vegetarian')) return 'Vegetarian';
  if (tags.includes('pescatarian')) return 'Pescatarian';
  return null;
}

export function MealGrid({ children }: { children: React.ReactNode }) {
  return <div className={styles.grid}>{children}</div>;
}

export function MealCard({
  meal,
  badge,
  badgeColor,
}: {
  meal: MealCardData;
  badge?: string;
  badgeColor?: string;
}) {
  const navigate = useNavigate();
  const canMake =
    (meal.total_count ?? 0) > 0 && meal.have_count === meal.total_count;
  const diet = headlineDiet(meal.diet_tags);

  return (
    <button className={styles.card} onClick={() => navigate(`/meals/${meal.id}`)}>
      <div className={styles.photo} style={{ background: mealBackground(meal.photo_url, meal.cuisine) }}>
        {badge && (
          <span className={styles.badge} style={{ color: badgeColor }}>
            {badge}
          </span>
        )}
        {meal.is_top_in_cuisine && (
          <span className={styles.rankBadge} title={`Top rated in ${meal.cuisine}`}>
            ★ Top rated
          </span>
        )}
      </div>
      <div className={styles.title}>{meal.name}</div>
      <div className={styles.meta}>
        {canMake && <span className={styles.canMakeDot} title="You can make this" />}
        <span>{meal.cuisine}</span>
        <span>·</span>
        <span>{meal.time_minutes} min</span>
        {meal.rating > 0 && (
          <>
            <span>·</span>
            <span className={styles.rating}>★{meal.rating.toFixed(1)}</span>
          </>
        )}
        {diet && (
          <>
            <span>·</span>
            <span className={styles.dietTag}>{diet}</span>
          </>
        )}
        {Boolean(meal.cook_count) && (
          <>
            <span>·</span>
            <span title={`Cooked by ${meal.cook_count} chef${meal.cook_count === 1 ? '' : 's'}`}>
              🍳 {meal.cook_count}
            </span>
          </>
        )}
      </div>
    </button>
  );
}
