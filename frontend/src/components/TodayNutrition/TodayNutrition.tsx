import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import styles from './TodayNutrition.module.css';

interface NutritionTotals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

interface TodayResponse {
  totals: NutritionTotals;
  goals: {
    calories: number | null;
    protein_g: number | null;
    carbs_g: number | null;
    fat_g: number | null;
  };
  meals_logged: number;
}

const METRICS: [keyof NutritionTotals, keyof TodayResponse['goals'], string, string][] = [
  ['calories', 'calories', 'Calories', ''],
  ['protein', 'protein_g', 'Protein', 'g'],
  ['carbs', 'carbs_g', 'Carbs', 'g'],
  ['fat', 'fat_g', 'Fat', 'g'],
];

/**
 * A day's nutrition against whatever goals the user set in Settings - only
 * ever appears once there's something to show (a goal set, or a meal
 * logged today), so it doesn't clutter the feed for anyone who hasn't
 * opted in. One serving assumed per meal marked cooked today (see
 * nutrition.rs's `today()` doc comment) - an honest simplification, not a
 * precise food diary.
 */
export function TodayNutrition() {
  const { data } = useQuery({
    queryKey: ['nutrition-today'],
    queryFn: () => api.get<TodayResponse>('/nutrition/today'),
  });

  if (!data) return null;
  const hasAnyGoal = METRICS.some(([, goalKey]) => data.goals[goalKey] != null);
  if (!hasAnyGoal && data.meals_logged === 0) return null;

  return (
    <div className={styles.card}>
      <div className={styles.head}>
        <span className={styles.title}>Today</span>
        <span className={styles.sub}>
          {data.meals_logged} meal{data.meals_logged === 1 ? '' : 's'} logged
        </span>
      </div>
      <div className={styles.metrics}>
        {METRICS.map(([key, goalKey, label, unit]) => {
          const goal = data.goals[goalKey];
          const value = Math.round(data.totals[key]);
          if (goal == null) {
            return data.meals_logged > 0 ? (
              <div key={key} className={styles.metric}>
                <div className={styles.metricHead}>
                  <span className={styles.metricLabel}>{label}</span>
                  <span className={styles.metricValue}>
                    {value}
                    {unit}
                  </span>
                </div>
              </div>
            ) : null;
          }
          const pct = Math.min(100, Math.round((value / goal) * 100));
          const over = value > goal;
          return (
            <div key={key} className={styles.metric}>
              <div className={styles.metricHead}>
                <span className={styles.metricLabel}>{label}</span>
                <span className={styles.metricValue}>
                  {value} / {goal}
                  {unit}
                </span>
              </div>
              <div className={styles.track}>
                <div
                  className={`${styles.fill} ${over ? styles.fillOver : ''}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
