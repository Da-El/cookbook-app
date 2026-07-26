import { type InputHTMLAttributes, useId } from 'react';
import styles from './Input.module.css';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  invalid?: boolean;
}

export function Input({ label, invalid = false, className, ...rest }: InputProps) {
  const id = useId();
  const classes = [styles.input, invalid ? styles.error : '', className].filter(Boolean).join(' ');

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <input id={id} className={classes} {...rest} />
    </div>
  );
}
