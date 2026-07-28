ALTER TABLE meal_plan_entries ADD COLUMN position INTEGER NOT NULL DEFAULT 0;

UPDATE meal_plan_entries e
SET position = sub.rn
FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id, plan_date, slot ORDER BY id) - 1 AS rn
    FROM meal_plan_entries
) sub
WHERE e.id = sub.id;
