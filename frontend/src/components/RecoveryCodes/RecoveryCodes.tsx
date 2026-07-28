import { useState } from 'react';
import { CloseIcon } from '../Icon/Icon';
import styles from './RecoveryCodes.module.css';

/**
 * The one and only time these codes are ever shown in the clear - enabling
 * 2FA and regenerating both route through here. No backdrop-click or Escape
 * dismissal on purpose: closing this needs to be a deliberate "I've saved
 * these," not an accidental tap-away that loses your only chance to see
 * them again.
 */
export function RecoveryCodes({ codes, onClose }: { codes: string[]; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can fail (permissions, insecure context) - the
      // codes are still on screen to copy by hand, so this is silent.
    }
  };

  return (
    <div className={styles.scrim}>
      <div className={styles.sheet}>
        <div className={styles.sheetHead}>
          <span className={styles.sheetTitle}>Save your recovery codes</span>
        </div>
        <p className={styles.hint}>
          If you ever can't receive the email code, one of these gets you in instead. Each
          code works once. Store them somewhere safe - this is the only time they're shown.
        </p>
        <div className={styles.grid}>
          {codes.map((c) => (
            <span key={c} className={styles.code}>
              {c}
            </span>
          ))}
        </div>
        <button className={styles.copyBtn} onClick={copyAll}>
          {copied ? 'Copied!' : 'Copy all'}
        </button>
        <button className={styles.doneBtn} onClick={onClose}>
          <CloseIcon size={14} strokeWidth={2.2} /> I've saved these, done
        </button>
      </div>
    </div>
  );
}
