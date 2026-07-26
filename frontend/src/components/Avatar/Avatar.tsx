import styles from './Avatar.module.css';

type Size = 'sm' | 'md' | 'lg';
type Shape = 'rounded' | 'circle';
type Theme = 'green' | 'terracotta' | 'slate' | 'blush';

interface AvatarProps {
  name: string;
  photoUrl?: string | null;
  size?: Size;
  shape?: Shape;
  theme?: Theme;
  className?: string;
}

export function Avatar({
  name,
  photoUrl,
  size = 'md',
  shape = 'rounded',
  theme = 'green',
  className,
}: AvatarProps) {
  const classes = [styles.avatar, styles[size], styles[shape], styles[`theme-${theme}`], className]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes}>
      {photoUrl ? <img src={photoUrl} alt={name} /> : <span>{name.charAt(0).toUpperCase()}</span>}
    </div>
  );
}
