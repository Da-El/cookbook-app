-- Iteration 12: forking. Distinct from the propose-and-vote edit system
-- (revisions/aliases/substitutes) - a fork isn't a suggestion on someone
-- else's recipe, it's a full independent copy the forker owns outright and
-- can take anywhere, the same way GitHub's fork differs from a pull request.
--
-- Denormalised name/author_name alongside the FKs, matching meal_revisions'
-- editor_name precedent: attribution should survive the original recipe (or
-- its author's account) later being deleted, not go blank at that point.
ALTER TABLE meals ADD COLUMN forked_from_id BIGINT REFERENCES meals(id) ON DELETE SET NULL;
ALTER TABLE meals ADD COLUMN forked_from_name TEXT;
ALTER TABLE meals ADD COLUMN forked_from_author_id BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE meals ADD COLUMN forked_from_author_name TEXT;

CREATE INDEX meals_forked_from_idx ON meals(forked_from_id) WHERE forked_from_id IS NOT NULL;
