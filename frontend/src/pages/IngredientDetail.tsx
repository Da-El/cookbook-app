import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { IngredientDetail as Detail, Micros } from '../api/types';
import { Card } from '../components/Card/Card';
import styles from './IngredientDetail.module.css';

// FDA daily values (mg) - drives the %DV bars.
const DV: Record<keyof Micros, { label: string; dv: number }> = {
  vit_c_mg: { label: 'Vitamin C', dv: 90 },
  calcium_mg: { label: 'Calcium', dv: 1300 },
  iron_mg: { label: 'Iron', dv: 18 },
  potassium_mg: { label: 'Potassium', dv: 4700 },
  magnesium_mg: { label: 'Magnesium', dv: 420 },
  sodium_mg: { label: 'Sodium', dv: 2300 },
};

export function IngredientDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['ingredient', id],
    queryFn: () => api.get<Detail>(`/ingredients/${id}`),
    enabled: Boolean(id),
  });

  if (isLoading || !data) return null;

  const n = data.nutrition;

  return (
    <div className={styles.page}>
      <button className={styles.back} onClick={() => navigate(-1)}>
        ← Back
      </button>

      <h1 className={styles.name}>{data.name}</h1>

      <div className={styles.chips}>
        <span className={styles.tag}>{data.category}</span>
        {data.foodb_group && <span className={styles.tag}>{data.foodb_group}</span>}
        {data.foodb_subgroup && <span className={styles.tag}>{data.foodb_subgroup}</span>}
        {n && <span className={`${styles.tag} ${styles.source}`}>{n.source}</span>}
      </div>

      <p className={styles.desc}>{data.description}</p>

      {n && (
        <Card>
          <p className={styles.sectionTitle}>Nutrition facts</p>
          <p className={styles.serving}>Per {n.serving_size}</p>

          <div className={styles.macros}>
            <Macro value={n.calories} label="Cal" />
            <Macro value={n.protein} label="Protein" unit="g" />
            <Macro value={n.carbs} label="Carbs" unit="g" />
            <Macro value={n.fat} label="Fat" unit="g" />
            <Macro value={n.fiber} label="Fiber" unit="g" />
            <Macro value={n.sugar} label="Sugars" unit="g" />
          </div>

          <p className={styles.sectionTitle}>Micronutrients</p>
          {(Object.keys(DV) as (keyof Micros)[]).map((key) => {
            const value = n.micros[key];
            if (value === null) return null;
            const { label, dv } = DV[key];
            const pct = Math.min(100, Math.round((value / dv) * 100));
            return (
              <div key={key} className={styles.micro}>
                <div className={styles.microHead}>
                  <span className={styles.microName}>{label}</span>
                  <span className={styles.microVal}>
                    {value} mg · {pct}%
                  </span>
                </div>
                <div className={styles.track}>
                  <div className={styles.fill} style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}

function Macro({ value, label, unit = '' }: { value: number | null; label: string; unit?: string }) {
  return (
    <div className={styles.macro}>
      <div className={styles.macroValue}>
        {value ?? '—'}
        {value !== null && unit}
      </div>
      <div className={styles.macroLabel}>{label}</div>
    </div>
  );
}
