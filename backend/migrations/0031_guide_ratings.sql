ALTER TABLE ratings DROP CONSTRAINT ratings_subject_type_check;
ALTER TABLE ratings ADD CONSTRAINT ratings_subject_type_check
    CHECK (subject_type IN ('meal', 'ingredient', 'guide'));

-- Unlike meals/ingredients, a guide's rating never feeds a ranked_score or
-- reorders the list (see this module's doc comment) - it's cached here
-- purely as a second trust signal alongside helpful_count, not a sort key.
ALTER TABLE guides ADD COLUMN rating NUMERIC(3,1) NOT NULL DEFAULT 0;
ALTER TABLE guides ADD COLUMN rating_count INT NOT NULL DEFAULT 0;
