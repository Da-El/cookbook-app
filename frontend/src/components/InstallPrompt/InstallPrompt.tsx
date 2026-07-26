import { useState } from 'react';
import { canOfferInstall, useInstall } from '../../pwa/InstallContext';
import styles from './InstallPrompt.module.css';

function AppMark() {
  return (
    <div className={styles.mark} aria-hidden="true">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 7.2c-1.8-1.3-4-2-6-2v12c2 0 4.2.7 6 2 1.8-1.3 4-2 6-2V5.2c-2 0-4.2.7-6 2z" />
        <path d="M12 7.2v12" />
      </svg>
    </div>
  );
}

/** iOS renders its Share control as a box with an up-arrow; mirroring it here
 *  means the instruction points at something the user can actually recognise. */
function ShareGlyph() {
  return (
    <svg className={styles.inlineIcon} width="15" height="15" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true">
      <path d="M12 15V4" />
      <path d="M8.5 7.5 12 4l3.5 3.5" />
      <path d="M6 12.5v6a1.5 1.5 0 0 0 1.5 1.5h9a1.5 1.5 0 0 0 1.5-1.5v-6" />
    </svg>
  );
}

export function InstallPrompt() {
  const install = useInstall();
  const [busy, setBusy] = useState(false);
  const [showIOSSteps, setShowIOSSteps] = useState(false);

  if (!canOfferInstall(install) || install.dismissed) return null;

  const onInstall = async () => {
    if (install.isIOS) {
      setShowIOSSteps((v) => !v);
      return;
    }
    setBusy(true);
    const outcome = await install.promptInstall();
    setBusy(false);
    // Declining Chrome's dialog is a decision - don't nag on the next render.
    if (outcome === 'dismissed') install.dismiss();
  };

  return (
    <div className={styles.wrap} role="dialog" aria-label="Install Cookbook">
      <div className={styles.card}>
        <button
          className={styles.close}
          onClick={install.dismiss}
          aria-label="Not now"
          title="Not now"
        >
          ×
        </button>

        <div className={styles.row}>
          <AppMark />
          <div className={styles.copy}>
            <div className={styles.title}>Install Cookbook</div>
            <div className={styles.sub}>
              {install.isIOS
                ? 'Add it to your Home Screen for full-screen, one-tap access.'
                : 'Get it on your home screen — full screen, no browser bar.'}
            </div>
          </div>
        </div>

        {showIOSSteps && (
          <ol className={styles.steps}>
            <li>
              Tap the Share button <ShareGlyph /> in Safari's toolbar
            </li>
            <li>Scroll down and tap <strong>Add to Home Screen</strong></li>
            <li>Tap <strong>Add</strong> — that's it</li>
          </ol>
        )}

        <div className={styles.actions}>
          <button className={styles.later} onClick={install.dismiss}>
            Not now
          </button>
          <button className={styles.install} onClick={onInstall} disabled={busy}>
            {busy ? 'Installing…' : install.isIOS ? (showIOSSteps ? 'Hide steps' : 'Show me how') : 'Install'}
          </button>
        </div>
      </div>
    </div>
  );
}
