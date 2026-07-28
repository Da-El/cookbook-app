import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { CloseIcon } from '../components/Icon/Icon';
import { Timers } from '../components/Timers/Timers';
import styles from './CookMode.module.css';

/** Screen Wake Lock API - not implemented everywhere yet (older Safari,
 * some Android WebViews), so this is best-effort: cooking still works
 * without it, the screen just times out like normal. Re-acquires on
 * visibility change since the OS releases the lock when the tab backgrounds
 * (switching to a timer app, taking a call) and doesn't restore it itself. */
function useWakeLock(active: boolean) {
  const lockRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;

    let cancelled = false;
    async function acquire() {
      try {
        const lock = await navigator.wakeLock.request('screen');
        if (cancelled) {
          lock.release();
          return;
        }
        lockRef.current = lock;
      } catch {
        // Denied or unsupported mid-session - fine, cooking just proceeds
        // with the screen timing out normally.
      }
    }
    acquire();

    function onVisibilityChange() {
      if (document.visibilityState === 'visible' && !lockRef.current) acquire();
    }
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      lockRef.current?.release();
      lockRef.current = null;
    };
  }, [active]);
}

/** Swipe left/right between steps - the hands cooking with are often wet,
 * floury, or full, and a small "Next step" button asks for more precision
 * than a full-width swipe does. */
function useSwipeNav(onNext: () => void, onPrev: () => void) {
  const startX = useRef<number | null>(null);
  const startY = useRef<number | null>(null);

  return {
    onTouchStart(e: React.TouchEvent) {
      startX.current = e.touches[0].clientX;
      startY.current = e.touches[0].clientY;
    },
    onTouchEnd(e: React.TouchEvent) {
      if (startX.current == null || startY.current == null) return;
      const dx = e.changedTouches[0].clientX - startX.current;
      const dy = e.changedTouches[0].clientY - startY.current;
      startX.current = null;
      startY.current = null;
      // Mostly-horizontal and past a real-swipe threshold - otherwise a
      // scroll or a tap reads as an accidental step change.
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      if (dx < 0) onNext();
      else onPrev();
    },
  };
}

interface MealSteps {
  id: number;
  steps: string[];
  is_cooked: boolean;
}

export function CookMode() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [timersOpen, setTimersOpen] = useState(false);

  const { data: meal } = useQuery({
    queryKey: ['meal', id],
    queryFn: () => api.get<MealSteps>(`/meals/${id}`),
    enabled: Boolean(id),
  });

  const cook = useMutation({ mutationFn: () => api.post(`/meals/${id}/cook`, {}) });

  const total = meal?.steps.length ?? 0;
  const last = step === total - 1;

  function close() {
    navigate(`/meals/${id}`);
  }

  // Defined before the `!meal` guard (with its own internal check) rather
  // than after, so the wake lock and swipe hooks below - which must run on
  // every render, guard or not - have a stable function to hold onto instead
  // of a conditionally-declared one.
  function next() {
    if (!meal) return;
    if (!last) {
      setStep((s) => s + 1);
      return;
    }
    if (!meal.is_cooked) {
      cook.mutate(undefined, {
        onSuccess: () => navigate(`/meals/${id}?justCooked=1`, { replace: true }),
      });
    } else {
      close();
    }
  }

  function prev() {
    setStep((s) => Math.max(0, s - 1));
  }

  useWakeLock(Boolean(meal));
  const swipeHandlers = useSwipeNav(next, prev);

  if (!meal) return null;

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <button className={styles.close} onClick={close} aria-label="Close">
          <CloseIcon size={18} strokeWidth={2.2} />
        </button>
        <span className={styles.counter}>
          Step {step + 1} of {total}
        </span>
        <button
          className={`${styles.timerBtn} ${timersOpen ? styles.timerBtnOn : ''}`}
          onClick={() => setTimersOpen((v) => !v)}
        >
          Timers
        </button>
      </div>

      <div className={styles.progress}>
        {meal.steps.map((_, i) => (
          <span key={i} className={`${styles.segment} ${i <= step ? styles.segmentDone : ''}`} />
        ))}
      </div>

      <div className={styles.body} {...swipeHandlers}>
        <div className={styles.stepEyebrow}>Step {step + 1}</div>
        <div className={styles.stepText}>{meal.steps[step]}</div>
      </div>

      <div className={styles.footer}>
        {step > 0 && (
          <button className={styles.prev} onClick={prev} aria-label="Previous step">
            ‹
          </button>
        )}
        <button className={styles.next} onClick={next}>
          {last ? 'Finish cooking' : 'Next step'}
        </button>
      </div>

      {timersOpen && <Timers onClose={() => setTimersOpen(false)} />}
    </div>
  );
}
