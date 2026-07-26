import { NavLink } from 'react-router-dom';
import styles from './TabBar.module.css';

const TABS = [
  { to: '/', label: 'Home', end: true },
  { to: '/browse', label: 'Browse' },
  { to: '/create', label: 'Create' },
  { to: '/cookbook', label: 'Cookbook' },
];

export function TabBar() {
  return (
    <nav className={styles.bar}>
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) => `${styles.item} ${isActive ? styles.active : ''}`}
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
