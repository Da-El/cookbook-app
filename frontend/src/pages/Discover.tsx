import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { GuideSummary } from '../api/types';
import { MealCard, MealGrid } from '../components/MealCard/MealCard';
import { EmptyCard } from '../components/Empty/Empty';
import styles from './Discover.module.css';

interface DiscoverMeal {
  id: number;
  name: string;
  author_name: string;
  cuisine: string;
  meal_type: string;
  time_minutes: number;
  rating: number;
  rating_count: number;
  photo_url: string | null;
  have_count: number;
  total_count: number;
}

interface Section {
  key: string;
  title: string;
  subtitle: string;
  meals: DiscoverMeal[];
}

export function Discover() {
  const navigate = useNavigate();

  const { data: sections = [], isLoading } = useQuery({
    queryKey: ['discover'],
    queryFn: () => api.get<Section[]>('/meals/discover'),
  });

  const { data: guides = [] } = useQuery({
    queryKey: ['guides'],
    queryFn: () => api.get<GuideSummary[]>('/guides'),
  });

  if (isLoading) return null;

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <div className={styles.eyebrow}>Discover</div>
        <h1 className={styles.title}>Something to cook</h1>
        <p className={styles.lede}>
          Ideas beyond your own cookbook — and a few guides for when a recipe assumes you already
          know something.
        </p>
      </div>

      <div className={styles.actions}>
        <button className={styles.action} onClick={() => navigate('/import')}>
          <span className={styles.actionTitle}>Import a recipe</span>
          <span className={styles.actionSub}>From a link, or paste it in</span>
        </button>
        <button className={styles.action} onClick={() => navigate('/plan')}>
          <span className={styles.actionTitle}>Plan your week</span>
          <span className={styles.actionSub}>Builds the shopping list for you</span>
        </button>
      </div>

      {sections.length === 0 ? (
        <div style={{ marginTop: 22 }}>
          <EmptyCard
            title="Nothing published yet"
            text="Import a recipe or write one up, and it'll start filling this page."
            onClick={() => navigate('/import')}
          />
        </div>
      ) : (
        sections.map((s) => (
          <section key={s.key} className={styles.section}>
            <h2 className={styles.sectionTitle}>{s.title}</h2>
            <p className={styles.sectionSub}>{s.subtitle}</p>
            <MealGrid>
              {s.meals.map((m) => (
                <MealCard key={m.id} meal={m} />
              ))}
            </MealGrid>
          </section>
        ))
      )}

      {guides.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Learn something</h2>
          <p className={styles.sectionSub}>Short reads, no jargon.</p>
          <div className={styles.guideRow}>
            {guides.slice(0, 4).map((g) => (
              <button
                key={g.slug}
                className={styles.guideCard}
                onClick={() => navigate(`/guides/${g.slug}`)}
              >
                <span className={styles.guideTopic}>{g.topic}</span>
                <span className={styles.guideTitle}>{g.title}</span>
                <span className={styles.guideSummary}>{g.summary}</span>
              </button>
            ))}
          </div>
          <button className={styles.allGuides} onClick={() => navigate('/guides')}>
            All guides
          </button>
        </section>
      )}
    </div>
  );
}
