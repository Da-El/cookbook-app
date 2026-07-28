import styles from './ContributorBadge.module.css';

export type ContributorTier = 'novice' | 'trusted' | 'veteran';

const LABEL: Record<Exclude<ContributorTier, 'novice'>, string> = {
  trusted: 'Trusted',
  veteran: 'Veteran',
};

/**
 * The same tier that already silently weights a person's votes (see
 * backend's reputation_weight/contributor_tier) made visible. Novice - the
 * vast majority of accounts - renders nothing: badging everyone would just
 * be noise, the point is to make the two tiers that DO mean something
 * recognizable at a glance.
 */
export function ContributorBadge({ tier }: { tier: ContributorTier | null | undefined }) {
  if (!tier || tier === 'novice') return null;
  return (
    <span className={`${styles.badge} ${tier === 'veteran' ? styles.veteran : styles.trusted}`} title={`${LABEL[tier]} contributor`}>
      {LABEL[tier]}
    </span>
  );
}
