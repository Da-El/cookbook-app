import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styles from './Timers.module.css';

interface Timer {
  id: number;
  label: string;
  /** Wall-clock ms when this timer finishes. */
  endsAt: number;
  /** Remaining ms captured at the moment of pausing; null while running. */
  pausedWith: number | null;
  rungAt: number | null;
}

const PRESETS = [1, 3, 5, 10, 15, 20, 30, 45, 60];

function format(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * A short chime built with the Web Audio API.
 *
 * No audio file to ship, and — more importantly — it's created from a user
 * gesture chain, so mobile browsers will actually let it play. An <audio> tag
 * loaded up front is usually blocked by autoplay policy.
 */
function useChime() {
  const ctxRef = useRef<AudioContext | null>(null);

  const ensure = useCallback(() => {
    if (!ctxRef.current) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor) ctxRef.current = new Ctor();
    }
    // Browsers suspend contexts created before interaction; resume on use.
    void ctxRef.current?.resume();
    return ctxRef.current;
  }, []);

  const play = useCallback(() => {
    const ctx = ensure();
    if (!ctx) return;
    const now = ctx.currentTime;
    [880, 1174.7].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const at = now + i * 0.18;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.35, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.55);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.6);
    });
  }, [ensure]);

  return { play, ensure };
}

/**
 * Keeps the screen awake while a timer runs, and re-acquires the lock when the
 * tab comes back — the browser drops it on visibility change.
 */
function useWakeLock(active: boolean) {
  const lockRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    let cancelled = false;

    const acquire = async () => {
      if (!active || !('wakeLock' in navigator)) return;
      try {
        const lock = await navigator.wakeLock.request('screen');
        if (cancelled) {
          void lock.release();
          return;
        }
        lockRef.current = lock;
      } catch {
        // Denied or unsupported: timers still work, the screen just sleeps.
      }
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible' && active) void acquire();
    };

    void acquire();
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void lockRef.current?.release().catch(() => {});
      lockRef.current = null;
    };
  }, [active]);
}

export function Timers({ onClose }: { onClose: () => void }) {
  const [timers, setTimers] = useState<Timer[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [label, setLabel] = useState('');
  const [custom, setCustom] = useState('');
  const { play, ensure } = useChime();

  const running = timers.some((t) => t.pausedWith === null && t.endsAt > now);
  useWakeLock(running);

  // Ticking only drives the display. Remaining time is always derived from
  // wall-clock timestamps, so a throttled or suspended tab still shows the
  // truth the moment it wakes up.
  useEffect(() => {
    if (timers.length === 0) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [timers.length]);

  // Fire once per timer as it crosses zero.
  useEffect(() => {
    const due = timers.filter((t) => t.pausedWith === null && t.rungAt === null && t.endsAt <= now);
    if (due.length === 0) return;
    play();
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    setTimers((prev) =>
      prev.map((t) => (due.some((d) => d.id === t.id) ? { ...t, rungAt: Date.now() } : t)),
    );
  }, [now, timers, play]);

  const add = (minutes: number) => {
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    ensure(); // unlock audio inside the tap that created the timer
    setTimers((prev) => [
      ...prev,
      {
        id: Date.now() + prev.length,
        label: label.trim() || `${minutes} min`,
        endsAt: Date.now() + minutes * 60_000,
        pausedWith: null,
        rungAt: null,
      },
    ]);
    setLabel('');
    setCustom('');
  };

  const toggle = (id: number) =>
    setTimers((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        return t.pausedWith === null
          ? { ...t, pausedWith: Math.max(0, t.endsAt - Date.now()) }
          : { ...t, endsAt: Date.now() + t.pausedWith, pausedWith: null, rungAt: null };
      }),
    );

  const remove = (id: number) => setTimers((prev) => prev.filter((t) => t.id !== id));

  const sorted = useMemo(
    () =>
      [...timers].sort((a, b) => {
        const ra = a.pausedWith ?? a.endsAt - now;
        const rb = b.pausedWith ?? b.endsAt - now;
        return ra - rb;
      }),
    [timers, now],
  );

  return (
    <div className={styles.panel}>
      <div className={styles.head}>
        <span className={styles.title}>Timers</span>
        <button className={styles.close} onClick={onClose} aria-label="Close timers">
          ×
        </button>
      </div>

      {sorted.length > 0 && (
        <div className={styles.list}>
          {sorted.map((t) => {
            const remaining = t.pausedWith ?? t.endsAt - now;
            const done = remaining <= 0 && t.pausedWith === null;
            return (
              <div key={t.id} className={`${styles.timer} ${done ? styles.timerDone : ''}`}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className={styles.timerLabel}>{t.label}</div>
                  <div className={styles.timerTime}>
                    {done ? 'Done' : format(remaining)}
                    {t.pausedWith !== null && <span className={styles.paused}>paused</span>}
                  </div>
                </div>
                {!done && (
                  <button className={styles.timerBtn} onClick={() => toggle(t.id)}>
                    {t.pausedWith === null ? 'Pause' : 'Resume'}
                  </button>
                )}
                <button className={styles.timerX} onClick={() => remove(t.id)} aria-label="Remove timer">
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}

      <input
        className={styles.labelInput}
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="What's it for? (optional)"
      />

      <div className={styles.presets}>
        {PRESETS.map((m) => (
          <button key={m} className={styles.preset} onClick={() => add(m)}>
            {m}m
          </button>
        ))}
      </div>

      <div className={styles.customRow}>
        <input
          className={styles.customInput}
          value={custom}
          inputMode="numeric"
          placeholder="Minutes"
          onChange={(e) => setCustom(e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => e.key === 'Enter' && add(Number(custom))}
        />
        <button className={styles.customBtn} disabled={!custom} onClick={() => add(Number(custom))}>
          Start
        </button>
      </div>

      <p className={styles.caveat}>
        Timers keep the screen awake while they run. If you lock the phone or switch apps, the
        alarm may not sound until you come back — check them here rather than relying on a chime.
      </p>
    </div>
  );
}
