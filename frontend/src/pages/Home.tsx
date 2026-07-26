import { Card } from '../components/Card/Card';
import { Button } from '../components/Button/Button';
import { Avatar } from '../components/Avatar/Avatar';
import { useAuth } from '../auth/AuthContext';

export function Home() {
  const { user, logout } = useAuth();
  if (!user) return null;

  return (
    <div style={{ padding: 'var(--space-4)', display: 'grid', gap: 'var(--space-4)' }}>
      <h1 className="display" style={{ fontSize: 'var(--text-display-lg)' }}>
        Cookbook
      </h1>

      <Card style={{ display: 'grid', gap: 'var(--space-4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <Avatar name={user.display_name} theme="terracotta" />
          <div>
            <p style={{ margin: 0, fontWeight: 600 }}>{user.display_name}</p>
            <p style={{ margin: 0, color: 'var(--muted-1)', fontSize: 'var(--text-ui-sm)' }}>
              {user.email}
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={() => logout()}>
          Sign out
        </Button>
      </Card>
    </div>
  );
}
