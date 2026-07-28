import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useIsDesktop } from '../hooks/useMediaQuery';
import { useToast } from '../components/Toast/ToastContext';
import { Segmented } from '../components/Segmented/Segmented';
import { Avatar } from '../components/Avatar/Avatar';
import { EmptyCard } from '../components/Empty/Empty';
import { HeartIcon, PlusIcon } from '../components/Icon/Icon';
import { mealBackground } from '../lib/imagery';
import styles from './Home.module.css';

interface FeedPost {
  meal_id: number;
  name: string;
  author_id: number;
  author_name: string;
  cuisine: string;
  time_minutes: number;
  rating: number;
  photo_url: string | null;
  created_at: string;
  liked: boolean;
  saved: boolean;
}

interface Chef {
  id: number;
  display_name: string;
  meal_count: number;
  top_cuisine: string | null;
  best_rating: number | null;
  is_following: boolean;
}

interface ActivityItem {
  id: number;
  kind: string;
  actor_name: string | null;
  subject_type: string | null;
  subject_id: number | null;
  created_at: string;
  seen: boolean;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function relativeTime(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'Yesterday';
  return `${days}d`;
}

const ACTIVITY_GLYPH: Record<string, { glyph: string; bg: string }> = {
  edit_suggested: { glyph: '✎', bg: 'var(--accent)' },
  edit_won: { glyph: '✓', bg: 'var(--green)' },
  meal_cooked: { glyph: '★', bg: 'var(--amber)' },
  meal_saved: { glyph: '♡', bg: 'var(--ink)' },
  new_follower: { glyph: '+', bg: 'var(--green)' },
  content_removed: { glyph: '⚑', bg: 'var(--warn)' },
  flag_resolved: { glyph: '✓', bg: 'var(--muted)' },
  review_reply: { glyph: '💬', bg: 'var(--accent)' },
};

function activityCopy(a: ActivityItem): string {
  const who = a.actor_name ?? 'Someone';
  switch (a.kind) {
    case 'new_follower': return `${who} started following you`;
    case 'meal_cooked': return `${who} cooked one of your meals`;
    case 'meal_saved': return `${who} saved one of your meals`;
    case 'edit_suggested': return `${who} suggested an edit`;
    case 'edit_won': return 'Your edit is now the top answer';
    case 'content_removed': return 'A moderator removed something you posted';
    case 'flag_resolved': return 'A moderator resolved a flag you raised';
    case 'review_reply': return `${who} replied to your review`;
    default: return 'New activity';
  }
}

export function Home() {
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<'following' | 'activity'>(
    params.get('tab') === 'activity' ? 'activity' : 'following',
  );

  const { data: feed = [] } = useQuery({ queryKey: ['feed'], queryFn: () => api.get<FeedPost[]>('/feed') });
  const { data: suggested = [] } = useQuery({ queryKey: ['chefs-suggested'], queryFn: () => api.get<Chef[]>('/chefs/suggested') });
  const { data: followed = [] } = useQuery({ queryKey: ['chefs-following'], queryFn: () => api.get<Chef[]>('/chefs/following') });
  const { data: activity = [] } = useQuery({ queryKey: ['activity'], queryFn: () => api.get<ActivityItem[]>('/activity') });

  const unseen = activity.filter((a) => !a.seen).length;

  // Opening the tab clears the badge, matching the prototype.
  useEffect(() => {
    if (tab === 'activity' && unseen > 0) {
      api.post('/activity').then(() => qc.invalidateQueries({ queryKey: ['activity'] }));
    }
  }, [tab, unseen, qc]);

  const follow = useMutation({
    mutationFn: (chef: Chef) => api.post<{ following: boolean }>(`/chefs/${chef.id}/follow`),
    onSuccess: (res, chef) => {
      toast(res.following ? `Following ${chef.display_name}` : `Unfollowed ${chef.display_name}`);
      qc.invalidateQueries({ queryKey: ['chefs-suggested'] });
      qc.invalidateQueries({ queryKey: ['chefs-following'] });
      qc.invalidateQueries({ queryKey: ['feed'] });
    },
  });

  const like = useMutation({
    mutationFn: (id: number) => api.post<{ liked: boolean }>(`/meals/${id}/like`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['feed'] }),
  });

  const save = useMutation({
    mutationFn: (id: number) => api.post<{ saved: boolean }>(`/meals/${id}/save`),
    onSuccess: (res) => {
      toast(res.saved ? 'Saved to cook' : 'Removed from saved');
      qc.invalidateQueries({ queryKey: ['feed'] });
      qc.invalidateQueries({ queryKey: ['cookbook-counts'] });
    },
  });

  function switchTab(t: 'following' | 'activity') {
    setTab(t);
    setParams(t === 'activity' ? { tab: 'activity' } : {}, { replace: true });
  }

  const segmented = (
    <Segmented
      value={tab}
      onChange={switchTab}
      fill={!isDesktop}
      options={[
        { value: 'following', label: 'Following' },
        { value: 'activity', label: unseen > 0 ? `Activity · ${unseen}` : 'Activity' },
      ]}
    />
  );

  const stories = (
    <div className={`${styles.stories} hscroll`}>
      <button className={styles.story} onClick={() => navigate('/browse')}>
        <div className={styles.storyFind}><PlusIcon size={20} strokeWidth={2} /></div>
        <span className={`${styles.storyLabel} ${styles.storyLabelMuted}`}>Find</span>
      </button>
      {followed.map((c) => (
        <button key={c.id} className={styles.story} onClick={() => navigate(`/chefs/${c.id}`)}>
          <div className={styles.storyRing}>
            <div className={styles.storyInner}>{c.display_name.charAt(0).toUpperCase()}</div>
          </div>
          <span className={styles.storyLabel}>{c.display_name.split(' ')[0]}</span>
        </button>
      ))}
    </div>
  );

  const feedBody =
    feed.length > 0 ? (
      <div className={styles.posts}>
        {feed.map((p) => (
          <article key={p.meal_id} className={styles.post}>
            <div className={styles.postHead}>
              <button
                onClick={() => navigate(`/chefs/${p.author_id}`)}
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
              >
                <Avatar name={p.author_name} size="sm" shape="rounded" />
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <button className={styles.postAuthor} onClick={() => navigate(`/chefs/${p.author_id}`)}>
                  {p.author_name}
                </button>
                <div className={styles.postVerb}>published a new meal</div>
              </div>
              <span className={styles.postTime}>{relativeTime(p.created_at)}</span>
            </div>

            <button
              className={styles.postPhoto}
              style={{ background: mealBackground(p.photo_url, p.cuisine) }}
              onClick={() => navigate(`/meals/${p.meal_id}`)}
            >
              <span className={styles.postScrim} />
              <span className={styles.postCaption}>
                <span className={styles.postTitle} style={{ display: 'block' }}>{p.name}</span>
                <span className={styles.postSub} style={{ display: 'block' }}>
                  {p.cuisine} · {p.time_minutes} min{p.rating > 0 && ` · ★ ${p.rating.toFixed(1)}`}
                </span>
              </span>
            </button>

            <div className={styles.postActions}>
              <button
                className={`${styles.likeBtn} ${p.liked ? styles.likeBtnOn : ''}`}
                onClick={() => like.mutate(p.meal_id)}
              >
                <HeartIcon size={16} filled={p.liked} />
                Like
              </button>
              <button
                className={`${styles.saveBtn} ${p.saved ? styles.saveBtnOn : ''}`}
                onClick={() => save.mutate(p.meal_id)}
              >
                {p.saved ? 'Saved' : 'Save'}
              </button>
            </div>
          </article>
        ))}
      </div>
    ) : (
      <EmptyCard
        title={followed.length === 0 ? 'Your feed is empty' : 'Nothing new yet'}
        text={
          followed.length === 0
            ? 'Follow a few chefs and their meals will show up here.'
            : "The chefs you follow haven't published anything yet."
        }
        onClick={() => navigate('/browse')}
      />
    );

  const activityBody =
    activity.length > 0 ? (
      <div className={styles.activityList}>
        {activity.map((a) => {
          const g = ACTIVITY_GLYPH[a.kind] ?? { glyph: '•', bg: 'var(--muted)' };
          return (
            <button
              key={a.id}
              className={`${styles.activityRow} ${!a.seen ? styles.activityUnread : ''}`}
              onClick={() => {
                if (a.subject_type === 'meal' && a.subject_id) navigate(`/meals/${a.subject_id}`);
                else if (a.subject_type === 'ingredient' && a.subject_id) navigate(`/ingredients/${a.subject_id}`);
              }}
            >
              <span className={styles.activityGlyph} style={{ background: g.bg }}>{g.glyph}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className={styles.activityTitle} style={{ display: 'block' }}>{activityCopy(a)}</span>
              </span>
              <span className={styles.activityTime}>{relativeTime(a.created_at)}</span>
            </button>
          );
        })}
      </div>
    ) : (
      <EmptyCard
        title="No activity yet"
        text="When people follow you, cook your meals or vote on your edits, it shows up here."
        onClick={() => navigate('/create')}
      />
    );

  const chefsToFollow = suggested.length > 0 && (
    <div className={styles.railCard}>
      <div className={styles.railTitle}>Chefs to follow</div>
      <div className={styles.railList}>
        {suggested.map((c) => (
          <div key={c.id} className={styles.railRow}>
            <Avatar name={c.display_name} size="sm" shape="rounded" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <button className={styles.railName} onClick={() => navigate(`/chefs/${c.id}`)}>
                {c.display_name}
              </button>
              <div className={styles.railSub}>
                {c.top_cuisine ?? 'Global'}
                {c.best_rating ? ` · ★ ${c.best_rating.toFixed(1)}` : ''}
              </div>
            </div>
            <button className={styles.followBtn} onClick={() => follow.mutate(c)}>Follow</button>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className={isDesktop ? styles.layout : undefined}>
      <div className={isDesktop ? styles.feedCol : undefined}>
        {isDesktop ? (
          <div className={styles.headRow}>
            <div>
              <div className={styles.eyebrow}>{greeting()}</div>
              <div className={styles.pageTitle}>Your kitchen feed</div>
            </div>
            {segmented}
          </div>
        ) : (
          <div className={styles.segmentWrap}>{segmented}</div>
        )}

        {tab === 'following' ? (
          <>
            {stories}
            {feedBody}
            {!isDesktop && suggested.length > 0 && (
              <section className={styles.chefSection}>
                <div className={styles.chefSectionTitle}>Chefs to follow</div>
                <div className={`${styles.chefRail} hscroll`}>
                  {suggested.map((c) => (
                    <div key={c.id} className={styles.chefCard}>
                      <Avatar name={c.display_name} size="md" shape="rounded" />
                      <button className={styles.chefCardName} onClick={() => navigate(`/chefs/${c.id}`)}>
                        {c.display_name}
                      </button>
                      <div className={styles.railSub}>
                        {c.top_cuisine ?? 'Global'}
                        {c.best_rating ? ` · ★ ${c.best_rating.toFixed(1)}` : ''}
                      </div>
                      <button className={styles.chefCardBtn} onClick={() => follow.mutate(c)}>Follow</button>
                    </div>
                  ))}
                </div>
              </section>
            )}
            <button className={styles.leaderboardLinkMobile} onClick={() => navigate('/leaderboard')}>
              🏆 See top contributors
            </button>
          </>
        ) : (
          activityBody
        )}
      </div>

      {isDesktop && (
        <aside className={styles.rightRail}>
          {chefsToFollow}
          <div className={styles.railCard}>
            <button className={styles.leaderboardLink} onClick={() => navigate('/leaderboard')}>
              🏆 Top contributors
            </button>
          </div>
        </aside>
      )}
      {user && null}
    </div>
  );
}
