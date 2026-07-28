import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { Avatar } from '../components/Avatar/Avatar';
import { ContributorBadge, type ContributorTier } from '../components/ContributorBadge/ContributorBadge';
import { LoadingState, ErrorState } from '../components/PageState/PageState';
import { EmptyLine } from '../components/Empty/Empty';
import { ChevronLeft } from '../components/Icon/Icon';
import styles from './Leaderboard.module.css';

interface LeaderboardRow {
  id: number;
  display_name: string;
  avatar_theme: 'green' | 'terracotta' | 'navy' | 'plum';
  avatar_photo_url: string | null;
  tier: ContributorTier;
  activity: number;
}

const MEDAL = ['🥇', '🥈', '🥉'];

export function Leaderboard() {
  const navigate = useNavigate();

  const { data: rows, isLoading, isError, refetch } = useQuery({
    queryKey: ['leaderboard'],
    queryFn: () => api.get<LeaderboardRow[]>('/chefs/leaderboard'),
  });

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate(-1)} aria-label="Back">
          <ChevronLeft size={18} strokeWidth={2.2} />
        </button>
        <div>
          <h1 className={styles.title}>Top contributors</h1>
          <p className={styles.subtitle}>Reviews written, recipes edited, ingredient facts fixed</p>
        </div>
      </div>

      {isLoading && <LoadingState label="Loading the board…" />}

      {isError && (
        <ErrorState
          title="Couldn't load the leaderboard"
          text="Something went wrong."
          actionLabel="Try again"
          onAction={() => refetch()}
        />
      )}

      {rows && rows.length === 0 && (
        <div style={{ marginTop: 20 }}>
          <EmptyLine roomy>Nobody's reviewed or edited anything yet — be the first.</EmptyLine>
        </div>
      )}

      {rows && rows.length > 0 && (
        <div className={styles.list}>
          {rows.map((r, i) => (
            <button key={r.id} className={styles.row} onClick={() => navigate(`/chefs/${r.id}`)}>
              <span className={styles.rank}>{MEDAL[i] ?? `#${i + 1}`}</span>
              <Avatar name={r.display_name} photoUrl={r.avatar_photo_url} theme={r.avatar_theme} size="sm" shape="rounded" />
              <span className={styles.nameCol}>
                <span className={styles.name}>{r.display_name}</span>
                <ContributorBadge tier={r.tier} />
              </span>
              <span className={styles.activity}>{r.activity}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
