import { PASSWORD_SCORE_LABEL, scorePassword } from '../../lib/passwordStrength';
import styles from './PasswordStrength.module.css';

const TIER_CLASS = ['tier0', 'tier1', 'tier2', 'tier3', 'tier4'] as const;

/**
 * Shown only once there's something to score - an empty field isn't
 * "very weak," it's just not filled in yet.
 */
export function PasswordStrength({ password }: { password: string }) {
  if (!password) return null;
  const score = scorePassword(password);

  return (
    <div className={styles.wrap}>
      <div className={styles.bar} role="img" aria-label={`Password strength: ${PASSWORD_SCORE_LABEL[score]}`}>
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={`${styles.segment} ${i < score ? styles[TIER_CLASS[score]] : ''}`}
          />
        ))}
      </div>
      <span className={`${styles.label} ${styles[TIER_CLASS[score]]}`}>{PASSWORD_SCORE_LABEL[score]}</span>
    </div>
  );
}
