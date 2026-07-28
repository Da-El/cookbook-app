import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { Button } from '../components/Button/Button';
import { Avatar } from '../components/Avatar/Avatar';
import styles from './Onboarding.module.css';

const DIET_PREFS = ['Vegetarian', 'Vegan', 'Pescatarian', 'Gluten-free', 'Dairy-free', 'Nut-free'];

interface SuggestedChef {
  id: number;
  display_name: string;
  avatar_theme: 'green' | 'terracotta' | 'navy' | 'plum';
  avatar_photo_url: string | null;
  meal_count: number;
  top_cuisine: string | null;
  is_following: boolean;
}

/**
 * `has_onboarded` has existed on the user row and in `POST /profile` since
 * the backend was first written (see `update_profile`'s own doc comment:
 * "Used by Settings and onboarding") - this is the onboarding half that was
 * never actually built. A first run today drops a new account straight into
 * an empty fridge and a feed with nobody followed, with no orientation at
 * all; this closes that gap with three short, skippable steps rather than a
 * long form nobody will finish.
 */
export function Onboarding() {
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [diet, setDiet] = useState<string[]>([]);

  const { data: suggested = [] } = useQuery({
    queryKey: ['chefs-suggested'],
    queryFn: () => api.get<SuggestedChef[]>('/chefs/suggested'),
    enabled: step === 1,
  });

  const saveDiet = useMutation({
    mutationFn: (next: string[]) => api.post('/profile', { diet_prefs: next }),
  });

  const follow = useMutation({
    mutationFn: (chefId: number) => api.post(`/chefs/${chefId}/follow`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['chefs-suggested'] }),
  });

  const finish = useMutation({
    mutationFn: () => api.post('/profile', { has_onboarded: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });

  function toggleDiet(pref: string) {
    const next = diet.includes(pref) ? diet.filter((d) => d !== pref) : [...diet, pref];
    setDiet(next);
    saveDiet.mutate(next);
  }

  const STEPS = ['Welcome', 'Follow a few chefs', 'Ready'];

  return (
    <div className={styles.screen}>
      <div className={styles.panel}>
        <div className={styles.dots}>
          {STEPS.map((label, i) => (
            <span key={label} className={`${styles.dot} ${i <= step ? styles.dotActive : ''}`} aria-hidden="true" />
          ))}
        </div>
        <p className={styles.stepLabel} aria-live="polite">
          Step {step + 1} of {STEPS.length}
        </p>

        {step === 0 && (
          <>
            <h1 className={styles.title}>Welcome to Cookbook</h1>
            <p className={styles.lede}>
              Any of these apply to you? We'll use them to steer what you see - nothing here is locked in,
              change it anytime in Settings.
            </p>
            <div className={styles.chipRow} role="group" aria-label="Diet preferences">
              {DIET_PREFS.map((p) => (
                <button
                  key={p}
                  className={`${styles.chip} ${diet.includes(p) ? styles.chipActive : ''}`}
                  aria-pressed={diet.includes(p)}
                  onClick={() => toggleDiet(p)}
                >
                  {p}
                </button>
              ))}
            </div>
            <Button fullWidth onClick={() => setStep(1)}>
              Continue
            </Button>
          </>
        )}

        {step === 1 && (
          <>
            <h1 className={styles.title}>Follow a few chefs</h1>
            <p className={styles.lede}>
              Your feed is empty until you follow someone. Here are a few people already cooking here.
            </p>
            {suggested.length > 0 ? (
              <div className={styles.chefList}>
                {suggested.map((c) => (
                  <div key={c.id} className={styles.chefRow}>
                    <Avatar name={c.display_name} photoUrl={c.avatar_photo_url} theme={c.avatar_theme} size="md" shape="rounded" />
                    <span className={styles.chefMeta}>
                      <span className={styles.chefName}>{c.display_name}</span>
                      <span className={styles.chefSub}>
                        {c.meal_count} {c.meal_count === 1 ? 'recipe' : 'recipes'}
                        {c.top_cuisine ? ` · ${c.top_cuisine}` : ''}
                      </span>
                    </span>
                    <button
                      className={`${styles.followBtn} ${c.is_following ? styles.following : ''}`}
                      onClick={() => follow.mutate(c.id)}
                      aria-pressed={c.is_following}
                    >
                      {c.is_following ? 'Following' : 'Follow'}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className={styles.emptyNote}>No one to suggest yet - you can find chefs anytime from Browse.</p>
            )}
            <Button fullWidth onClick={() => setStep(2)}>
              Continue
            </Button>
            <button className={styles.skip} onClick={() => setStep(2)}>
              Skip for now
            </button>
          </>
        )}

        {step === 2 && (
          <>
            <h1 className={styles.title}>You're set</h1>
            <p className={styles.lede}>
              Add what's in your fridge to see what you can make right now, or just start browsing -
              either way, welcome to the kitchen.
            </p>
            <Button fullWidth disabled={finish.isPending} onClick={() => finish.mutate()}>
              {finish.isPending ? 'Just a moment…' : 'Start cooking'}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
