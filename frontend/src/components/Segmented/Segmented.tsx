import styles from './Segmented.module.css';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (v: T) => void;
  /** Stretch the buttons to fill the track (mobile full-bleed style). */
  fill?: boolean;
  /** Ink-on-white active treatment instead of white-on-track. */
  dark?: boolean;
  /** Rounded-rect track rather than a pill. */
  square?: boolean;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  fill = false,
  dark = false,
  square = false,
}: SegmentedProps<T>) {
  const track = [
    styles.track,
    fill ? styles.trackFill : '',
    dark ? styles.trackDark : '',
    square ? styles.trackSquare : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={track}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`${styles.button} ${o.value === value ? styles.active : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
