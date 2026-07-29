import type { ReactNode } from 'react';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import styles from './FilterSheet.module.css';

/**
 * A single filter dimension inside the sheet - a label plus its chip row,
 * wrapping naturally now that there's vertical room instead of the
 * horizontal-scroll-per-row stack this replaced on the page itself.
 */
export function FilterSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.section}>
      <span className={styles.sectionLabel}>{label}</span>
      <div className={styles.sectionChips}>{children}</div>
    </div>
  );
}

/**
 * Every filter dimension a list page has (diet, time, difficulty, occasion,
 * sort, ...) used to render as its own always-visible chip row - fine on a
 * wide desktop screen, but on a phone that's a wall of chips a user has to
 * scroll past before seeing a single result. This tucks all of it behind
 * one "Filters" trigger and a bottom sheet, the same collapse Airbnb,
 * DoorDash, and Pinterest all reach for on mobile: one row of two buttons
 * ("Filters", "Sort") stays on the page, everything else lives in here.
 */
export function FilterSheet({
  open,
  onClose,
  title = 'Filters',
  onClear,
  applyLabel = 'Show results',
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  onClear?: () => void;
  applyLabel?: string;
  children: ReactNode;
}) {
  useEscapeKey(onClose, open);
  if (!open) return null;

  return (
    <>
      <div className={styles.scrim} onClick={onClose} />
      <div className={styles.sheet} role="dialog" aria-modal="true" aria-label={title}>
        <div className={styles.grabber} />
        <div className={styles.head}>
          <span className={styles.title}>{title}</span>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className={styles.body}>{children}</div>
        <div className={styles.foot}>
          {onClear && (
            <button className={styles.clearBtn} onClick={onClear}>
              Clear all
            </button>
          )}
          <button className={styles.applyBtn} onClick={onClose}>
            {applyLabel}
          </button>
        </div>
      </div>
    </>
  );
}
