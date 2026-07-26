import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { GuideDetail, GuideSummary } from '../api/types';
import { ChevronLeft } from '../components/Icon/Icon';
import styles from './Guides.module.css';

export function Guides() {
  const navigate = useNavigate();
  const { data: guides = [] } = useQuery({
    queryKey: ['guides'],
    queryFn: () => api.get<GuideSummary[]>('/guides'),
  });

  // Preserve the server's ordering (topic, then position) while grouping.
  const topics: { topic: string; items: GuideSummary[] }[] = [];
  for (const g of guides) {
    const bucket = topics.find((t) => t.topic === g.topic);
    bucket ? bucket.items.push(g) : topics.push({ topic: g.topic, items: [g] });
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate(-1)} aria-label="Back">
          <ChevronLeft size={18} strokeWidth={2.2} />
        </button>
        <h1 className={styles.title}>Guides</h1>
      </div>
      <p className={styles.lede}>
        Short reads for the things recipes assume you already know.
      </p>

      {topics.map(({ topic, items }) => (
        <section key={topic} className={styles.section}>
          <h2 className={styles.topic}>{topic}</h2>
          <div className={styles.list}>
            {items.map((g) => (
              <button key={g.slug} className={styles.card} onClick={() => navigate(`/guides/${g.slug}`)}>
                <span className={styles.cardTitle}>{g.title}</span>
                <span className={styles.cardSummary}>{g.summary}</span>
                {g.minutes && <span className={styles.cardMeta}>{g.minutes} min read</span>}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** Renders the seeded body text: blank-line paragraphs, "- " lines as points. */
function GuideBody({ body }: { body: string }) {
  const blocks = body.split(/\n\s*\n/);
  return (
    <>
      {blocks.map((block, i) => {
        const lines = block.split('\n');
        const bulletLines = lines.filter((l) => l.trim().startsWith('- '));

        if (bulletLines.length === lines.length && bulletLines.length > 0) {
          return (
            <ul key={i} className={styles.bullets}>
              {lines.map((l, j) => (
                <li key={j}>{l.trim().slice(2)}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className={styles.para}>
            {block}
          </p>
        );
      })}
    </>
  );
}

export function GuidePage() {
  const { slug } = useParams();
  const navigate = useNavigate();

  const { data: guide, isLoading } = useQuery({
    queryKey: ['guide', slug],
    queryFn: () => api.get<GuideDetail>(`/guides/${slug}`),
    enabled: Boolean(slug),
  });

  if (isLoading || !guide) return null;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate(-1)} aria-label="Back">
          <ChevronLeft size={18} strokeWidth={2.2} />
        </button>
      </div>

      <div className={styles.eyebrow}>{guide.topic}</div>
      <h1 className={styles.articleTitle}>{guide.title}</h1>
      <p className={styles.summary}>{guide.summary}</p>
      {guide.minutes && <div className={styles.readTime}>{guide.minutes} min read</div>}

      <article className={styles.article}>
        <GuideBody body={guide.body} />
      </article>
    </div>
  );
}
