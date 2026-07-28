ALTER TABLE content_flags DROP CONSTRAINT content_flags_content_type_check;
ALTER TABLE content_flags ADD CONSTRAINT content_flags_content_type_check
    CHECK (content_type IN ('meal_revision', 'review', 'ingredient_edit', 'alias', 'substitute', 'guide_edit', 'user_profile'));
