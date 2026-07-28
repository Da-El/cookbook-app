-- Iteration 67: ingredient reviews, review replies, guide comments,
-- collections, and collection comments have all shipped since the last time
-- this list grew (0032) with no way to flag any of them - same "reuse the
-- existing mechanism" reasoning moderation.rs's remove_content() already
-- follows, just extended to cover the content types that came after it.
ALTER TABLE content_flags DROP CONSTRAINT content_flags_content_type_check;
ALTER TABLE content_flags ADD CONSTRAINT content_flags_content_type_check
    CHECK (content_type IN (
        'meal_revision', 'review', 'ingredient_edit', 'alias', 'substitute', 'guide_edit', 'user_profile',
        'ingredient_review', 'review_reply', 'guide_comment', 'collection', 'collection_comment'
    ));
