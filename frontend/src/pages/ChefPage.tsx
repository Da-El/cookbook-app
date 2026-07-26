import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast/ToastContext';
import { Avatar } from '../components/Avatar/Avatar';
import { EmptyStatic } from '../components/Empty/Empty';
import { ChevronLeft } from '../components/Icon/Icon';
import { mealBackground } from '../lib/imagery';
import styles from './ChefPage.module.css';

type Tab = 'published' | 'cooked' | 'reviews';

interface ChefProfile {
  id: number;
  display_name: string;
  bio: string | null;
  avatar_theme: 'green' | 'terracotta' | 'navy' | 'plum';
  avatar_photo_url: string | null;
  follower_count: number;
  following_count: number;
  is_following: boolean;
  is_me: boolean;
}

interface ChefMeal {
  id: number;
  name: string;
  cuisine: string;
  time_minutes: number;
  rating: number;
  photo_url: string | null;
}

interface ChefReview {
  meal_id: number;
  meal_name: string;
  photo_url: string | null;
  score: number | null;
  note: string | null;
  cooked_at: string;
}

function relativeTime(iso: string) {
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days < 1) return 'today';
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

export function ChefPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { user: viewer } = useAuth();
  const [tab, setTab] = useState<Tab>('published');

  const { data: chef } = useQuery({
    queryKey: ['chef', id],
    queryFn: () => api.get<ChefProfile>(`/chefs/${id}`),
    enabled: Boolean(id),
  });

  const { data: published = [] } = useQuery({
    queryKey: ['chef-published', id],
    queryFn: () => api.get<ChefMeal[]>(`/chefs/${id}/published`),
    enabled: Boolean(id),
  });

  const { data: cooked = [] } = useQuery({
    queryKey: ['chef-cooked', id],
    queryFn: () => api.get<ChefMeal[]>(`/chefs/${id}/cooked`),
    enabled: Boolean(id),
  });

  const { data: reviews = [] } = useQuery({
    queryKey: ['chef-reviews', id],
    queryFn: () => api.get<ChefReview[]>(`/chefs/${id}/reviews`),
    enabled: Boolean(id),
  });

  const follow = useMutation({
    mutationFn: () => api.post<{ following: boolean }>(`/chefs/${id}/follow`),
    onSuccess: (res) => {
      toast(res.following ? `Following ${chef?.display_name}` : `Unfollowed ${chef?.display_name}`);
      qc.invalidateQueries({ queryKey: ['chef', id] });
      qc.invalidateQueries({ queryKey: ['chefs-suggested'] });
      qc.invalidateQueries({ queryKey: ['chefs-following'] });
      qc.invalidateQueries({ queryKey: ['feed'] });
    },
  });

  // Visiting your own profile via a chef link - the Cookbook tab is the real home for it.
  useEffect(() => {
    if (viewer && chef?.is_me) navigate('/cookbook', { replace: true });
  }, [viewer, chef, navigate]);

  if (!chef || chef.is_me) return null;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate(-1)} aria-label="Back">
          <ChevronLeft size={18} strokeWidth={2.2} />
        </button>
      </div>

      <div className={styles.profileRow}>
        <Avatar
          name={chef.display_name}
          photoUrl={chef.avatar_photo_url}
          theme={chef.avatar_theme}
          size="lg"
          shape="rounded"
        />
        <div style={{ minWidth: 0 }}>
          <div className={styles.name}>{chef.display_name}</div>
          {chef.bio && <div className={styles.bio}>{chef.bio}</div>}
          <div className={styles.followerCount}>{chef.follower_count} followers</div>
        </div>
      </div>

      <button
        className={`${styles.followBtn} ${chef.is_following ? styles.followBtnOn : ''}`}
        onClick={() => follow.mutate()}
      >
        {chef.is_following ? 'Following' : 'Follow'}
      </button>

      <div className={styles.tabs}>
        {(['published', 'cooked', 'reviews'] as Tab[]).map((t) => (
          <button
            key={t}
            className={`${styles.tab} ${tab === t ? styles.tabActive : ''}`}
            onClick={() => setTab(t)}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
            <span className={styles.tabCount}>
              {t === 'published' ? published.length : t === 'cooked' ? cooked.length : reviews.length}
            </span>
          </button>
        ))}
      </div>

      {tab === 'published' &&
        (published.length > 0 ? (
          <div className={styles.mealList}>
            {published.map((m) => (
              <button key={m.id} className={styles.mealRow} onClick={() => navigate(`/meals/${m.id}`)}>
                <span className={styles.mealThumb} style={{ background: mealBackground(m.photo_url, m.cuisine) }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className={styles.mealName} style={{ display: 'block' }}>{m.name}</span>
                  <span className={styles.mealSub} style={{ display: 'block' }}>
                    {m.cuisine} · {m.time_minutes} min
                  </span>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div style={{ marginTop: 16 }}>
            <EmptyStatic>No published recipes yet.</EmptyStatic>
          </div>
        ))}

      {tab === 'cooked' &&
        (cooked.length > 0 ? (
          <div className={styles.mealList}>
            {cooked.map((m) => (
              <button key={m.id} className={styles.mealRow} onClick={() => navigate(`/meals/${m.id}`)}>
                <span className={styles.mealThumb} style={{ background: mealBackground(m.photo_url, m.cuisine) }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className={styles.mealName} style={{ display: 'block' }}>{m.name}</span>
                  <span className={styles.mealSub} style={{ display: 'block' }}>
                    {m.cuisine} · {m.time_minutes} min
                  </span>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div style={{ marginTop: 16 }}>
            <EmptyStatic>No public cooking log yet.</EmptyStatic>
          </div>
        ))}

      {tab === 'reviews' &&
        (reviews.length > 0 ? (
          <div className={styles.mealList}>
            {reviews.map((r) => (
              <button key={`${r.meal_id}-${r.cooked_at}`} className={styles.reviewRow} onClick={() => navigate(`/meals/${r.meal_id}`)}>
                <span className={styles.mealThumb} style={{ background: mealBackground(r.photo_url, null) }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className={styles.mealName} style={{ display: 'block' }}>{r.meal_name}</span>
                  {r.score != null && <span className={styles.reviewScore}>★ {r.score}/10</span>}
                  {r.note && <span className={styles.reviewNote} style={{ display: 'block' }}>{r.note}</span>}
                  <span className={styles.reviewTime} style={{ display: 'block' }}>{relativeTime(r.cooked_at)}</span>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div style={{ marginTop: 16 }}>
            <EmptyStatic>No public reviews yet.</EmptyStatic>
          </div>
        ))}
    </div>
  );
}
