interface IconProps {
  size?: number;
  strokeWidth?: number;
  className?: string;
}

function svg(path: React.ReactNode, { size = 20, strokeWidth = 2, className }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {path}
    </svg>
  );
}

export const HomeIcon = (p: IconProps) =>
  svg(<><path d="M3 10.5 12 3l9 7.5" /><path d="M5.5 9.5V20h13V9.5" /></>, p);

export const SearchIcon = (p: IconProps) =>
  svg(<><circle cx="11" cy="11" r="7" /><path d="M21 21l-3.5-3.5" /></>, p);

/** Calendar with a marked day - the meal planner. */
export const CalendarIcon = (p: IconProps) =>
  svg(
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
      <path d="M3.5 9.5h17" />
      <path d="M8 3v3.5M16 3v3.5" />
      <circle cx="12" cy="14.5" r="1.4" fill="currentColor" stroke="none" />
    </>,
    p,
  );

/** Compass - discovery rather than directed search. */
export const CompassIcon = (p: IconProps) =>
  svg(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M15.6 8.4 13.9 14 8.4 15.6 10.1 10z" />
    </>,
    p,
  );

export const PlusIcon = (p: IconProps) =>
  svg(<><path d="M12 5v14" /><path d="M5 12h14" /></>, p);

export const BookIcon = (p: IconProps) =>
  svg(<><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5z" /><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H19v3H6.5A2.5 2.5 0 0 1 4 20.5z" /></>, p);

export const ChevronLeft = (p: IconProps) => svg(<path d="M15 5l-7 7 7 7" />, p);
export const ChevronRight = (p: IconProps) => svg(<path d="M9 5l7 7-7 7" />, p);

export const ShareIcon = (p: IconProps) =>
  svg(<><path d="M12 16V4" /><path d="M8 8l4-4 4 4" /><path d="M4 14v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5" /></>, p);

export const CameraIcon = (p: IconProps) =>
  svg(<><path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2.2l1.2-2h8.2l1.2 2h2.2A1.5 1.5 0 0 1 21 8.5v10A1.5 1.5 0 0 1 19.5 20h-15A1.5 1.5 0 0 1 3 18.5z" /><circle cx="12" cy="13" r="3.6" /></>, p);

export const PencilIcon = (p: IconProps) =>
  svg(<><path d="M4 20h4l10-10-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></>, p);

export const CloseIcon = (p: IconProps) =>
  svg(<><path d="M6 6l12 12" /><path d="M18 6L6 18" /></>, p);

/** Branching Y - forking a recipe into your own copy. */
export const ForkIcon = (p: IconProps) =>
  svg(
    <>
      <circle cx="7" cy="6" r="2.2" />
      <circle cx="17" cy="6" r="2.2" />
      <circle cx="12" cy="18" r="2.2" />
      <path d="M7 8.2v2c0 1.8 1.4 3 3 3M17 8.2v2c0 1.8-1.4 3-3 3M12 13.2V16" />
    </>,
    p,
  );

/** Two overlapping cards - duplicating your own recipe as a new draft. */
export const CopyIcon = (p: IconProps) =>
  svg(
    <>
      <rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2" />
      <path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5" />
    </>,
    p,
  );

export const PrintIcon = (p: IconProps) =>
  svg(
    <>
      <path d="M7 8.5V4h10v4.5" />
      <rect x="4" y="8.5" width="16" height="8" rx="1.6" />
      <path d="M7 14h10v6H7z" />
    </>,
    p,
  );

export const FolderIcon = (p: IconProps) =>
  svg(<path d="M4 6.5A1.5 1.5 0 0 1 5.5 5h4l2 2.5h7A1.5 1.5 0 0 1 20 9v8.5A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5z" />, p);

export const HeartIcon = ({ filled, ...p }: IconProps & { filled?: boolean }) => (
  <svg
    width={p.size ?? 20}
    height={p.size ?? 20}
    viewBox="0 0 24 24"
    fill={filled ? 'currentColor' : 'none'}
    stroke="currentColor"
    strokeWidth={p.strokeWidth ?? 1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 20s-7-4.4-7-9.3A4.2 4.2 0 0 1 12 8a4.2 4.2 0 0 1 7 2.7C19 15.6 12 20 12 20z" />
  </svg>
);

export const BookmarkIcon = ({ filled, ...p }: IconProps & { filled?: boolean }) => (
  <svg
    width={p.size ?? 20}
    height={p.size ?? 20}
    viewBox="0 0 24 24"
    fill={filled ? 'currentColor' : 'none'}
    stroke="currentColor"
    strokeWidth={p.strokeWidth ?? 1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M6 4h12v16l-6-4.2L6 20z" />
  </svg>
);

export const PlayIcon = (p: IconProps) => (
  <svg width={p.size ?? 14} height={p.size ?? 14} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M7 4.5v15l13-7.5z" />
  </svg>
);
