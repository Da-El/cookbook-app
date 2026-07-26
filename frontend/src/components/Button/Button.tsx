import { type ButtonHTMLAttributes } from 'react';
import styles from './Button.module.css';

type Variant = 'primary' | 'positive' | 'ghost' | 'outline';
type Size = 'md' | 'sm';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  className,
  ...rest
}: ButtonProps) {
  const classes = [
    styles.button,
    styles[variant],
    size === 'sm' ? styles.sm : '',
    fullWidth ? styles.fullWidth : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return <button className={classes} {...rest} />;
}
