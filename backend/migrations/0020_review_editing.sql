-- Iteration 21: let a review's author fix a typo or update their take
-- without deleting and re-cooking to get a new one. NULL means never
-- edited - the page only shows "(edited)" when this is actually set,
-- never a synthetic "edited 0 seconds after posting."
ALTER TABLE reviews ADD COLUMN edited_at TIMESTAMPTZ;
