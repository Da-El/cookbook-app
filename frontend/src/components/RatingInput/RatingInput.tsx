import styles from './RatingInput.module.css';

/**
 * A 1-10 rating picker, used identically on meals, ingredients, and guides -
 * previously four separate copies of ten individually-bordered pill buttons
 * in a row, which on a 375px phone meant ten ~30px tap targets with gaps
 * between them and only the exact selected number highlighted (everything
 * else read as "unselected," not "below your rating"). This is one
 * connected bar instead: segments fill up to the chosen value the way a
 * volume slider or star row does, so "7/10" is scannable at a glance
 * instead of requiring a read of which single number is dark.
 */
export function RatingInput({
  value,
  onChange,
  max = 10,
  label,
}: {
  value: number | null;
  onChange: (n: number) => void;
  max?: number;
  label?: string;
}) {
  return (
    <div className={styles.bar} role="group" aria-label={label ?? `Rate from 1 to ${max}`}>
      {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          type="button"
          className={`${styles.segment} ${value != null && n <= value ? styles.segmentOn : ''}`}
          onClick={() => onChange(n)}
          aria-label={`Rate ${n} out of ${max}`}
          aria-pressed={value === n}
        >
          {n}
        </button>
      ))}
    </div>
  );
}
