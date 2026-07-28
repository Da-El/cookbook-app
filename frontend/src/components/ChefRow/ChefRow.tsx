import { useNavigate } from 'react-router-dom';
import { Avatar } from '../Avatar/Avatar';
import styles from './ChefRow.module.css';

export interface Chef {
  id: number;
  display_name: string;
  meal_count: number;
  top_cuisine: string | null;
  best_rating: number | null;
  is_following: boolean;
}

export function chefSubtitle(c: Chef): string {
  if (c.meal_count === 0) return 'No recipes yet';
  const cuisine = c.top_cuisine ?? 'Global';
  const meals = `${c.meal_count} ${c.meal_count === 1 ? 'recipe' : 'recipes'}`;
  return c.best_rating ? `${cuisine} · ${meals} · ★ ${c.best_rating.toFixed(1)}` : `${cuisine} · ${meals}`;
}

export function ChefList({ children }: { children: React.ReactNode }) {
  return <div className={styles.list}>{children}</div>;
}

export function ChefRow({
  chef,
  onToggleFollow,
  isViewer = false,
}: {
  chef: Chef;
  onToggleFollow: (c: Chef) => void;
  /** True when this row is the signed-in viewer's own account - can't follow
   * yourself, so a follow list that includes the viewer (e.g. someone else's
   * followers list, when the viewer is one of them) shows "You" instead of a
   * button that would just 400 on click. */
  isViewer?: boolean;
}) {
  const navigate = useNavigate();
  return (
    <div className={styles.row}>
      <button className={styles.open} onClick={() => navigate(`/chefs/${chef.id}`)}>
        <Avatar name={chef.display_name} size="md" shape="rounded" />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span className={styles.name} style={{ display: 'block' }}>{chef.display_name}</span>
          <span className={styles.sub} style={{ display: 'block' }}>{chefSubtitle(chef)}</span>
        </span>
      </button>
      {isViewer ? (
        <span className={styles.youTag}>You</span>
      ) : (
        <button
          className={`${styles.followBtn} ${chef.is_following ? styles.following : ''}`}
          onClick={() => onToggleFollow(chef)}
        >
          {chef.is_following ? 'Following' : 'Follow'}
        </button>
      )}
    </div>
  );
}
