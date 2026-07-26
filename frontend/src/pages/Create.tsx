import { useNavigate } from 'react-router-dom';
import styles from './Create.module.css';

function ImportGlyph() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v11" />
      <path d="M8 10.5 12 14.5l4-4" />
      <path d="M4 15v3.5A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V15" />
    </svg>
  );
}

function MealGlyph() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 11h18" />
      <path d="M12 11V4a5 5 0 0 1 5 5" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M6 20h12" />
    </svg>
  );
}

function IngredientGlyph() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2a7 7 0 0 0-4 12.7V20a2 2 0 0 0 4 0" />
      <path d="M12 22a2 2 0 0 0 2-2v-5.3A7 7 0 0 0 12 2" />
      <path d="M9 9c0-1.5 1.3-3 3-3" />
    </svg>
  );
}

export function Create() {
  const navigate = useNavigate();

  return (
    <div className={styles.page}>
      <h1 className={styles.landingTitle}>Create</h1>
      <p className={styles.subtitle}>What are you adding to the cookbook?</p>

      <div className={styles.entryCards}>
        <button className={styles.entryCard} onClick={() => navigate('/import')}>
          <span
            className={styles.entryIcon}
            style={{ background: 'linear-gradient(145deg,#3B5B7A,#28405A)' }}
          >
            <ImportGlyph />
          </span>
          <span className={styles.entryTitle} style={{ display: 'block' }}>Import a recipe</span>
          <span className={styles.entrySub} style={{ display: 'block' }}>
            From a link, or paste one in from anywhere.
          </span>
        </button>

        <button className={styles.entryCard} onClick={() => navigate('/create/meal')}>
          <span
            className={styles.entryIcon}
            style={{ background: 'linear-gradient(145deg,#D9542B,#B8431F)' }}
          >
            <MealGlyph />
          </span>
          <span className={styles.entryTitle} style={{ display: 'block' }}>New meal page</span>
          <span className={styles.entrySub} style={{ display: 'block' }}>
            Combine ingredients, add steps, tags, and a rating.
          </span>
        </button>

        <button className={styles.entryCard} onClick={() => navigate('/create/ingredient')}>
          <span
            className={styles.entryIcon}
            style={{ background: 'linear-gradient(145deg,#3F5D46,#2C4131)' }}
          >
            <IngredientGlyph />
          </span>
          <span className={styles.entryTitle} style={{ display: 'block' }}>New ingredient page</span>
          <span className={styles.entrySub} style={{ display: 'block' }}>
            Name it, describe it, rate it. One page per ingredient.
          </span>
        </button>
      </div>
    </div>
  );
}
