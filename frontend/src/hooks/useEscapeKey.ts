import { useEffect } from 'react';

/**
 * Closes a modal/sheet on Escape - the mouse-only "click the scrim to
 * dismiss" pattern several overlays in this app already have leaves
 * keyboard users with no way out short of Tab-cycling to a close button
 * that may not exist. `active` gates the listener so only the currently
 * open overlay reacts, not every mounted one.
 */
export function useEscapeKey(onEscape: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onEscape();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [active, onEscape]);
}
