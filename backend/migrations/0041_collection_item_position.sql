ALTER TABLE meal_collection_items ADD COLUMN position INTEGER NOT NULL DEFAULT 0;

UPDATE meal_collection_items i
SET position = sub.rn
FROM (
    SELECT collection_id, meal_id, ROW_NUMBER() OVER (PARTITION BY collection_id ORDER BY added_at DESC) - 1 AS rn
    FROM meal_collection_items
) sub
WHERE i.collection_id = sub.collection_id AND i.meal_id = sub.meal_id;
