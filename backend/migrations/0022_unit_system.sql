-- Iteration 25: a per-account measurement preference for the grocery list.
-- 'as_written' (the default, and the only behavior before this migration)
-- keeps rendering each total in whichever unit the source recipes used most
-- often; 'metric'/'imperial' override that with a consistent system instead,
-- for a shopper who thinks in one system regardless of how a recipe was written.
ALTER TABLE users ADD COLUMN unit_system TEXT NOT NULL DEFAULT 'as_written'
    CHECK (unit_system IN ('as_written', 'metric', 'imperial'));
