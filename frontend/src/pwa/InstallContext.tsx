import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

/**
 * Chrome fires this so the page can host its own install UI instead of the
 * browser's mini-infobar. It isn't in lib.dom yet, hence the local shape.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'cookbook:install-dismissed';

interface InstallState {
  /** Chrome/Edge/Android: a real prompt is available to fire. */
  canPrompt: boolean;
  /** iOS Safari has no prompt API - the user must use the Share sheet. */
  isIOS: boolean;
  /** Already running as an installed app, so there's nothing to offer. */
  isInstalled: boolean;
  /** The user closed the banner; the account-menu entry stays available. */
  dismissed: boolean;
  promptInstall: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
  dismiss: () => void;
  /** Lets the account menu re-open the banner after a dismissal. */
  resurface: () => void;
}

const Ctx = createContext<InstallState | null>(null);

function detectStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari's own flag, which predates display-mode.
    (navigator as { standalone?: boolean }).standalone === true
  );
}

function detectIOS(): boolean {
  const ua = navigator.userAgent;
  // iPadOS 13+ reports as Macintosh, so check for touch to catch it too.
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

export function InstallProvider({ children }: { children: ReactNode }) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(detectStandalone);
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === '1');

  useEffect(() => {
    const onBeforeInstall = (e: Event) => {
      // Suppress Chrome's own mini-infobar so ours is the only prompt shown.
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setIsInstalled(true);
      setDeferred(null);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);

    // Covers the user installing from the browser's own menu while the tab is open.
    const mq = window.matchMedia('(display-mode: standalone)');
    const onDisplayChange = (e: MediaQueryListEvent) => setIsInstalled(e.matches);
    mq.addEventListener('change', onDisplayChange);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
      mq.removeEventListener('change', onDisplayChange);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferred) return 'unavailable' as const;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    // The event is single-use; Chrome re-fires it later if still installable.
    setDeferred(null);
    return outcome;
  }, [deferred]);

  const dismiss = useCallback(() => {
    localStorage.setItem(DISMISS_KEY, '1');
    setDismissed(true);
  }, []);

  const resurface = useCallback(() => {
    localStorage.removeItem(DISMISS_KEY);
    setDismissed(false);
  }, []);

  const isIOS = detectIOS();

  return (
    <Ctx.Provider
      value={{
        canPrompt: Boolean(deferred),
        isIOS,
        isInstalled,
        dismissed,
        promptInstall,
        dismiss,
        resurface,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useInstall(): InstallState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useInstall must be used inside <InstallProvider>');
  return ctx;
}

/** Whether there is any install path worth offering the user at all. */
export function canOfferInstall(s: InstallState): boolean {
  return !s.isInstalled && (s.canPrompt || s.isIOS);
}
