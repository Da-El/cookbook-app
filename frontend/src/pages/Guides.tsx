import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { GuideDetail, GuideSummary } from '../api/types';
import { ChevronLeft } from '../components/Icon/Icon';
import { LoadingState, ErrorState } from '../components/PageState/PageState';
import { FlagButton } from '../components/Flag/FlagButton';
import { mealBackground } from '../lib/imagery';
import styles from './Guides.module.css';

interface RelatedMeal {
  id: number;
  name: string;
  cuisine: string;
  photo_url: string | null;
}

interface GuideEditRow {
  id: number;
  body: string;
  author_name: string | null;
  author_id: number | null;
  votes: number;
  voted_by_me: boolean;
  is_mine: boolean;
}

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
  const qc = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [draft, setDraft] = useState('');

  const { data: guide, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['guide', slug],
    queryFn: () => api.get<GuideDetail>(`/guides/${slug}`),
    enabled: Boolean(slug),
    retry: (failureCount, err) => {
      if (err instanceof ApiError) return false;
      return failureCount < 2;
    },
  });

  const { data: related = [] } = useQuery({
    queryKey: ['guide-related', slug],
    queryFn: () => api.get<RelatedMeal[]>(`/guides/${slug}/related-meals`),
    enabled: Boolean(slug),
  });

  const { data: edits = [] } = useQuery({
    queryKey: ['guide-edits', slug],
    queryFn: () => api.get<GuideEditRow[]>(`/guides/${slug}/edits`),
    enabled: Boolean(slug),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['guide', slug] });
    qc.invalidateQueries({ queryKey: ['guide-edits', slug] });
    qc.invalidateQueries({ queryKey: ['guides'] });
  };

  const voteHelpful = useMutation({
    mutationFn: () => api.post(`/guides/${slug}/helpful`),
    onSuccess: invalidate,
  });

  const submitEdit = useMutation({
    mutationFn: (body: string) => api.post(`/guides/${slug}/edits`, { body }),
    onSuccess: invalidate,
  });

  const voteEdit = useMutation({
    mutationFn: (editId: number) => api.post(`/guides/${slug}/edits/${editId}/vote`),
    onSuccess: invalidate,
  });

  const deleteEdit = useMutation({
    mutationFn: (editId: number) => api.del(`/guides/${slug}/edits/${editId}`),
    onSuccess: invalidate,
  });

  if (isLoading) return <LoadingState label="Loading guide…" />;
  if (isError || !guide) {
    const notFound = error instanceof ApiError && error.status === 404;
    return notFound ? (
      <ErrorState
        title="This guide isn't here"
        text="It may have been removed, or the link is wrong."
        actionLabel="All guides"
        onAction={() => navigate('/guides')}
      />
    ) : (
      <ErrorState
        title="Couldn't load this guide"
        text="The connection may have dropped. Try again."
        actionLabel="Try again"
        onAction={() => refetch()}
      />
    );
  }

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

      <div className={styles.helpfulRow}>
        <button
          className={`${styles.helpfulBtn} ${guide.your_helpful_vote ? styles.helpfulBtnOn : ''}`}
          onClick={() => voteHelpful.mutate()}
          aria-pressed={guide.your_helpful_vote}
        >
          👍 {guide.your_helpful_vote ? 'Marked helpful' : 'Was this helpful?'}
          {guide.helpful_count > 0 ? ` · ${guide.helpful_count}` : ''}
        </button>
      </div>

      {related.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.topic}>Try it in a recipe</h2>
          <div className={styles.relatedGrid}>
            {related.map((m) => (
              <button key={m.id} className={styles.relatedCard} onClick={() => navigate(`/meals/${m.id}`)}>
                <div className={styles.relatedPhoto} style={{ background: mealBackground(m.photo_url, m.cuisine) }} />
                <span className={styles.relatedName}>{m.name}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className={styles.section}>
        <div className={styles.editHeadRow}>
          <h2 className={styles.topic}>Suggest an improvement</h2>
          <button
            className={styles.suggestBtn}
            onClick={() => {
              setEditOpen((v) => !v);
              setDraft(guide.body);
            }}
          >
            {editOpen ? 'Cancel' : 'Edit this guide'}
          </button>
        </div>

        {editOpen && (
          <div className={styles.editForm}>
            <textarea
              className={styles.editTextarea}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={8}
            />
            <button
              className={styles.editSubmit}
              onClick={() => {
                if (!draft.trim()) return;
                submitEdit.mutate(draft.trim());
                setEditOpen(false);
              }}
            >
              Submit
            </button>
          </div>
        )}

        {edits.length > 0 && (
          <div className={styles.editList}>
            {edits.map((e, i) => (
              <div key={e.id} className={`${styles.editRow} ${i === 0 ? styles.editRowWinner : ''}`}>
                <span className={styles.editRowMeta}>
                  {e.author_name ?? 'a former user'} · {e.votes} vote{e.votes === 1 ? '' : 's'}
                  {i === 0 ? ' · live now' : ''}
                </span>
                <p className={styles.editRowBody}>{e.body}</p>
                <div className={styles.editRowActions}>
                  <button
                    className={`${styles.editVoteBtn} ${e.voted_by_me ? styles.editVoteBtnOn : ''}`}
                    onClick={() => voteEdit.mutate(e.id)}
                    aria-pressed={e.voted_by_me}
                  >
                    {e.voted_by_me ? '✓' : '△'} {e.votes}
                  </button>
                  {e.is_mine ? (
                    <button className={styles.editDeleteBtn} onClick={() => deleteEdit.mutate(e.id)}>
                      Withdraw
                    </button>
                  ) : (
                    <FlagButton contentType="guide_edit" contentId={e.id} />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
