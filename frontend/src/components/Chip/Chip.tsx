import { type ButtonHTMLAttributes } from 'react';
import styles from './Chip.module.css';

interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
}

export function Chip({ active = false, className, ...rest }: ChipProps) {
  const classes = [styles.chip, active ? styles.active : '', className].filter(Boolean).join(' ');
  return <button type="button" className={classes} {...rest} />;
}
