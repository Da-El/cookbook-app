import styles from './Empty.module.css';

/** Clickable prompt card - the app's main "you have nothing yet, do this" pattern. */
export function EmptyCard({
  title,
  text,
  onClick,
}: {
  title: string;
  text: string;
  onClick?: () => void;
}) {
  return (
    <button className={styles.card} onClick={onClick} type="button">
      <div className={styles.cardTitle}>{title}</div>
      <div className={styles.cardText}>{text}</div>
    </button>
  );
}

/** Single centred line, for list and grid empties. */
export function EmptyLine({ children, roomy = false }: { children: string; roomy?: boolean }) {
  return <p className={`${styles.line} ${roomy ? styles.lineRoomy : ''}`}>{children}</p>;
}

/** Static dashed card without a title, used on other people's profiles. */
export function EmptyStatic({ children }: { children: string }) {
  return <div className={styles.static}>{children}</div>;
}
