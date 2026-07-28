import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { LoadingState } from '../components/PageState/PageState';
import { EmptyLine } from '../components/Empty/Empty';
import { ChevronLeft } from '../components/Icon/Icon';
import styles from './Collections.module.css';

interface CollectionRow {
  id: number;
  name: string;
  created_at: string;
  meal_count: number;
  meal_ids: number[];
  is_public: boolean;
}

/**
 * The user's own named lists of meals - Saved/Cooked/Published are fixed,
 * single-purpose buckets; a collection is whatever shape a person actually
 * wants to organise their cookbook into ("Weeknight dinners", "Meal prep").
 */
export function Collections() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  const { data: collections, isLoading } = useQuery({
    queryKey: ['collections'],
    queryFn: () => api.get<CollectionRow[]>('/collections'),
  });

  const create = useMutation({
    mutationFn: () => api.post<{ id: number }>('/collections', { name: name.trim() }),
    onSuccess: (res) => {
      setName('');
      setCreating(false);
      qc.invalidateQueries({ queryKey: ['collections'] });
      navigate(`/collections/${res.id}`);
    },
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.del(`/collections/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['collections'] }),
  });

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate(-1)} aria-label="Back">
          <ChevronLeft size={18} strokeWidth={2.2} />
        </button>
        <div>
          <h1 className={styles.title}>Collections</h1>
          <p className={styles.subtitle}>Your own shape for your cookbook</p>
        </div>
      </div>

      {!creating ? (
        <button className={styles.newBtn} onClick={() => setCreating(true)}>
          + New collection
        </button>
      ) : (
        <div className={styles.newForm}>
          <input
            className={styles.newInput}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Weeknight dinners"
            maxLength={60}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim()) create.mutate();
              if (e.key === 'Escape') setCreating(false);
            }}
          />
          <button className={styles.newSubmit} disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
            Create
          </button>
          <button className={styles.newCancel} onClick={() => setCreating(false)}>
            Cancel
          </button>
        </div>
      )}

      {isLoading && <LoadingState label="Loading your collections…" />}

      {collections && collections.length === 0 && (
        <div style={{ marginTop: 20 }}>
          <EmptyLine roomy>No collections yet — start with whatever you keep re-planning around.</EmptyLine>
        </div>
      )}

      {collections && collections.length > 0 && (
        <div className={styles.list}>
          {collections.map((c) => (
            <div key={c.id} className={styles.row}>
              <button className={styles.rowMain} onClick={() => navigate(`/collections/${c.id}`)}>
                <span className={styles.rowName}>
                  {c.name}
                  {c.is_public && <span className={styles.publicBadge}>Public</span>}
                </span>
                <span className={styles.rowCount}>
                  {c.meal_count} meal{c.meal_count === 1 ? '' : 's'}
                </span>
              </button>
              <button
                className={styles.deleteBtn}
                title="Delete this collection"
                aria-label="Delete this collection"
                onClick={() => {
                  if (confirm(`Delete "${c.name}"? The meals in it aren't affected.`)) remove.mutate(c.id);
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
