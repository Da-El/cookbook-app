import styles from './PageState.module.css';

/**
 * Every detail page used to do `if (isLoading || !data) return null`, which
 * covers "still loading," "the id doesn't exist," and "the network died"
 * with the exact same blank white screen - so a slow connection and a dead
 * link were indistinguishable from a crash. This gives each of those three
 * a distinct, honest state instead.
 */
export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className={styles.wrap} role="status" aria-live="polite">
      <span className={styles.spinner} aria-hidden="true" />
      <span className={styles.label}>{label}</span>
    </div>
  );
}

export function ErrorState({
  title,
  text,
  actionLabel,
  onAction,
}: {
  title: string;
  text: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className={styles.wrap} role="alert">
      <span className={styles.errorIcon} aria-hidden="true">!</span>
      <p className={styles.errorTitle}>{title}</p>
      <p className={styles.errorText}>{text}</p>
      {onAction && actionLabel && (
        <button className={styles.errorAction} onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}
