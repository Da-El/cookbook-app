import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { CloseIcon } from '../components/Icon/Icon';
import styles from './CookMode.module.css';

interface MealSteps {
  id: number;
  steps: string[];
  is_cooked: boolean;
}

export function CookMode() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);

  const { data: meal } = useQuery({
    queryKey: ['meal', id],
    queryFn: () => api.get<MealSteps>(`/meals/${id}`),
    enabled: Boolean(id),
  });

  const cook = useMutation({ mutationFn: () => api.post(`/meals/${id}/cook`, {}) });

  if (!meal) return null;

  const total = meal.steps.length;
  const last = step === total - 1;

  function close() {
    navigate(`/meals/${id}`);
  }

  function next() {
    if (!last) {
      setStep((s) => s + 1);
      return;
    }
    if (!meal!.is_cooked) {
      cook.mutate(undefined, {
        onSuccess: () => navigate(`/meals/${id}?justCooked=1`, { replace: true }),
      });
    } else {
      close();
    }
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <button className={styles.close} onClick={close} aria-label="Close">
          <CloseIcon size={18} strokeWidth={2.2} />
        </button>
        <span className={styles.counter}>
          Step {step + 1} of {total}
        </span>
      </div>

      <div className={styles.progress}>
        {meal.steps.map((_, i) => (
          <span key={i} className={`${styles.segment} ${i <= step ? styles.segmentDone : ''}`} />
        ))}
      </div>

      <div className={styles.body}>
        <div className={styles.stepEyebrow}>Step {step + 1}</div>
        <div className={styles.stepText}>{meal.steps[step]}</div>
      </div>

      <div className={styles.footer}>
        {step > 0 && (
          <button className={styles.prev} onClick={() => setStep((s) => s - 1)} aria-label="Previous step">
            ‹
          </button>
        )}
        <button className={styles.next} onClick={next}>
          {last ? 'Finish cooking' : 'Next step'}
        </button>
      </div>
    </div>
  );
}
