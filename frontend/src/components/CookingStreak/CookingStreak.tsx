import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import styles from './CookingStreak.module.css';

interface StreakData {
  current: number;
  longest: number;
  cooked_today: boolean;
  total_days_cooked: number;
}

/**
 * Consecutive-days-cooked tracker for the Cookbook page. Mirrors
 * TodayNutrition's graceful-absence pattern: nothing renders until the
 * user has cooked at least once, so a brand-new account doesn't see a
 * "0-day streak" nagging it on day one.
 */
export function CookingStreak() {
  const { data } = useQuery({
    queryKey: ['cookbook-streak'],
    queryFn: () => api.get<StreakData>('/cookbook/streak'),
  });

  if (!data || data.total_days_cooked === 0) return null;

  const { current, longest, cooked_today: cookedToday } = data;

  const sub =
    current === 0
      ? `Your best was ${longest} day${longest === 1 ? '' : 's'} — cook today to start again.`
      : cookedToday
        ? current === longest
          ? 'Your best yet — keep it going.'
          : `You cooked today. Best: ${longest} days.`
        : 'Cook today to keep it alive.';

  return (
    <div className={styles.card}>
      <span className={styles.flame}>🔥</span>
      <div className={styles.body}>
        <span className={styles.headline}>
          {current > 0 ? (
            <>
              <span className={styles.headlineNum}>{current}</span>-day streak
            </>
          ) : (
            'Start a new streak'
          )}
        </span>
        <span className={styles.sub}>{sub}</span>
      </div>
    </div>
  );
}
