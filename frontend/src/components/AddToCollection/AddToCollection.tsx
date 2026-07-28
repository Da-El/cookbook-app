import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { FolderIcon, CloseIcon } from '../Icon/Icon';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import styles from './AddToCollection.module.css';

interface CollectionRow {
  id: number;
  name: string;
  meal_count: number;
  meal_ids: number[];
}

/**
 * The other half of collections: from a recipe's own page, toggle it into
 * or out of any of your collections without leaving. Opens as a small
 * sheet rather than navigating away, since adding to two or three
 * collections at once is a real use case (a dish that's both a weeknight
 * dinner and a meal-prep favorite).
 */
export function AddToCollection({ mealId, triggerClassName }: { mealId: number; triggerClassName?: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  useEscapeKey(() => setOpen(false), open);

  const { data: collections = [] } = useQuery({
    queryKey: ['collections'],
    queryFn: () => api.get<CollectionRow[]>('/collections'),
    enabled: open,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['collections'] });

  const toggle = useMutation({
    mutationFn: ({ id, inIt }: { id: number; inIt: boolean }) =>
      inIt ? api.del(`/collections/${id}/meals/${mealId}`) : api.post(`/collections/${id}/meals`, { meal_id: mealId }),
    onSuccess: invalidate,
  });

  const create = useMutation({
    mutationFn: () => api.post<{ id: number }>('/collections', { name: name.trim() }),
    onSuccess: (res) => {
      setName('');
      setCreating(false);
      invalidate();
      toggle.mutate({ id: res.id, inIt: false });
    },
  });

  if (!open) {
    return (
      <button className={triggerClassName ?? styles.trigger} title="Add to collection" onClick={() => setOpen(true)}>
        <FolderIcon size={17} strokeWidth={1.8} />
      </button>
    );
  }

  return (
    <div className={styles.sheetScrim} onClick={() => setOpen(false)}>
      <div className={styles.sheet} onClick={(e) => e.stopPropagation()}>
        <div className={styles.sheetHead}>
          <span className={styles.sheetTitle}>Add to collection</span>
          <button className={styles.closeBtn} onClick={() => setOpen(false)} aria-label="Close">
            <CloseIcon size={16} strokeWidth={2} />
          </button>
        </div>

        {collections.length === 0 && !creating && (
          <p className={styles.empty}>You don't have any collections yet.</p>
        )}

        <div className={styles.list}>
          {collections.map((c) => {
            const inIt = c.meal_ids.includes(mealId);
            return (
              <button
                key={c.id}
                className={`${styles.row} ${inIt ? styles.rowOn : ''}`}
                onClick={() => toggle.mutate({ id: c.id, inIt })}
              >
                <span className={styles.checkbox}>{inIt ? '✓' : ''}</span>
                <span className={styles.rowName}>{c.name}</span>
              </button>
            );
          })}
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
              placeholder="Collection name"
              maxLength={60}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && name.trim()) create.mutate();
                if (e.key === 'Escape') setCreating(false);
              }}
            />
            <button className={styles.newSubmit} disabled={!name.trim()} onClick={() => create.mutate()}>
              Add
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
