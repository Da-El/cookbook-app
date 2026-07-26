import { type HTMLAttributes } from 'react';
import styles from './Card.module.css';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  dark?: boolean;
}

export function Card({ dark = false, className, ...rest }: CardProps) {
  const classes = [styles.card, dark ? styles.dark : '', className].filter(Boolean).join(' ');
  return <div className={classes} {...rest} />;
}
