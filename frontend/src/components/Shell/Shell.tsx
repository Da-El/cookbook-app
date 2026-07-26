import { useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useIsDesktop } from '../../hooks/useMediaQuery';
import { useAuth } from '../../auth/AuthContext';
import { useProfileTheme } from '../../theme/ThemeContext';
import { api } from '../../api/client';
import { Avatar } from '../Avatar/Avatar';
import { BookIcon, HomeIcon, PlusIcon, SearchIcon } from '../Icon/Icon';
import styles from './Shell.module.css';

const NAV = [
  { to: '/', mobileLabel: 'Home', desktopLabel: 'Feed', Icon: HomeIcon, end: true },
  { to: '/browse', mobileLabel: 'Browse', desktopLabel: 'Browse', Icon: SearchIcon },
  { to: '/create', mobileLabel: 'Create', desktopLabel: 'Create', Icon: PlusIcon },
  { to: '/cookbook', mobileLabel: 'Cookbook', desktopLabel: 'My Cookbook', Icon: BookIcon },
];

function LogoGlyph({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 7.2c-1.8-1.3-4-2-6-2v12c2 0 4.2.7 6 2 1.8-1.3 4-2 6-2V5.2c-2 0-4.2.7-6 2z" />
      <path d="M12 7.2v12" />
    </svg>
  );
}

function BellGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 8.5a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16s-2-1.5-2-6.5z" />
      <path d="M10.5 19a1.8 1.8 0 0 0 3 0" />
    </svg>
  );
}

interface ShellProps {
  children: ReactNode;
  /** Detail/overlay screens (Meal Detail, Settings, Create forms, ...): the
   * sidebar persists on desktop, but the mobile tab bar and logo header hide
   * in favor of the screen's own back-button header. */
  bare?: boolean;
}

export function Shell({ children, bare = false }: ShellProps) {
  const isDesktop = useIsDesktop();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const theme = useProfileTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [search, setSearch] = useState('');

  const { data: counts } = useQuery({
    queryKey: ['cookbook-counts'],
    queryFn: () => api.get<Record<string, number>>('/cookbook/counts'),
  });

  const { data: activity = [] } = useQuery({
    queryKey: ['activity'],
    queryFn: () => api.get<{ seen: boolean }[]>('/activity'),
  });
  const unseen = activity.filter((a) => !a.seen).length;

  if (!user) return <>{children}</>;

  const avatar = (size: 'sm' | 'md') => (
    <Avatar
      name={user.display_name}
      size={size}
      shape="rounded"
      theme={theme?.cb_avatar_theme}
      photoUrl={theme?.cb_avatar_photo_url}
    />
  );

  const menu = menuOpen && (
    <>
      <div className={styles.menuScrim} onClick={() => setMenuOpen(false)} />
      <div className={`${styles.menu} ${isDesktop ? '' : styles.menuMobile}`}>
        <div className={styles.menuHead}>
          {avatar('sm')}
          <div style={{ minWidth: 0 }}>
            <div className={styles.menuName}>{user.display_name}</div>
            <div className={styles.menuSub}>
              {counts?.cooked ?? 0} cooked · {counts?.saved ?? 0} saved
            </div>
          </div>
        </div>
        <div className={styles.menuDivider} />
        <Link to="/cookbook" className={styles.menuItem} onClick={() => setMenuOpen(false)}>
          Your cookbook
        </Link>
        <Link to="/settings" className={styles.menuItem} onClick={() => setMenuOpen(false)}>
          Settings
        </Link>
        <div className={styles.menuDivider} />
        <button
          className={`${styles.menuItem} ${styles.menuItemDanger}`}
          onClick={() => {
            setMenuOpen(false);
            logout();
          }}
        >
          Log out
        </button>
      </div>
    </>
  );

  if (isDesktop) {
    return (
      <div className={styles.root}>
        <aside className={styles.sidebar}>
          <div className={styles.logo}>
            <div className={styles.logoMark}><LogoGlyph /></div>
            <div className={styles.wordmark}>Cookbook</div>
          </div>

          <nav className={styles.nav}>
            {NAV.map(({ to, desktopLabel, Icon, end }) => {
              const active = end ? location.pathname === to : location.pathname.startsWith(to);
              return (
                <button
                  key={to}
                  className={`${styles.navItem} ${active ? styles.navItemActive : ''}`}
                  onClick={() => navigate(to)}
                >
                  <Icon size={20} strokeWidth={1.8} />
                  {desktopLabel}
                </button>
              );
            })}
          </nav>

          <button className={styles.sidebarUser} onClick={() => setMenuOpen((v) => !v)}>
            {avatar('sm')}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className={styles.sidebarUserName}>{user.display_name}</div>
              <div className={styles.sidebarUserSub}>{counts?.published ?? 0} recipes</div>
            </div>
          </button>
        </aside>

        <div className={styles.scroller}>
          <div className={styles.topbar}>
            <div className={styles.topbarSpacer} />
            <form
              className={styles.search}
              onSubmit={(e) => {
                e.preventDefault();
                navigate(`/browse?q=${encodeURIComponent(search)}`);
              }}
            >
              <SearchIcon size={18} strokeWidth={2} />
              <input
                className={styles.searchInput}
                placeholder="Search meals & ingredients…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </form>
            <div className={styles.topbarRight}>
              <button
                className={styles.bell}
                onClick={() => navigate('/?tab=activity')}
                aria-label="Activity"
              >
                <BellGlyph />
                {unseen > 0 && <span className={styles.bellBadge}>{unseen}</span>}
              </button>
              <button className={styles.newMeal} onClick={() => navigate('/create/meal')}>
                New meal
              </button>
            </div>
          </div>
          <div className={styles.content}>{children}</div>
        </div>
        {menu}
      </div>
    );
  }

  return (
    <div className={styles.mobileRoot}>
      <div className={bare ? styles.mobileContentBare : styles.mobileContent}>
        {!bare && (
          <div className={styles.mobileHeader}>
            <Link to="/" className={styles.mobileLogo}>
              <div className={styles.mobileLogoMark}><LogoGlyph size={17} /></div>
              <div className={styles.mobileWordmark}>Cookbook</div>
            </Link>
            <div className={styles.mobileHeaderActions}>
              <button className={styles.avatarBtn} onClick={() => setMenuOpen((v) => !v)}>
                {avatar('sm')}
              </button>
            </div>
          </div>
        )}
        {children}
      </div>

      {!bare && (
        <nav className={styles.tabbar}>
          {NAV.map(({ to, mobileLabel, Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => `${styles.tabItem} ${isActive ? styles.tabItemActive : ''}`}
            >
              <Icon size={23} strokeWidth={1.8} />
              {mobileLabel}
            </NavLink>
          ))}
        </nav>
      )}
      {menu}
    </div>
  );
}
