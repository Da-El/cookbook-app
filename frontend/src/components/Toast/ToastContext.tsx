import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { useIsDesktop } from '../../hooks/useMediaQuery';
import styles from './Toast.module.css';

const ToastContext = createContext<(message: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const isDesktop = useIsDesktop();

  const show = useCallback((m: string) => {
    setMessage(m);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMessage(null), 1800);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {message && (
        <div className={`${styles.toast} ${isDesktop ? '' : styles.mobile}`} role="status">
          {message}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
