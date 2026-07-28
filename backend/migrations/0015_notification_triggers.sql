-- Iteration 13: the notifications table, bell icon, unread badge, and
-- Activity tab have all existed since the original build - but of the five
-- notification types the schema already reserved, only 'new_follower' was
-- ever actually triggered. 'edit_suggested', 'edit_won', 'meal_cooked' and
-- 'meal_saved' had full frontend copy/icons waiting for a backend that
-- never sent them. This closes that gap and adds two more for the
-- moderation system built in Iteration 10, which had no way to tell anyone
-- anything happened.
ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
    CHECK (type IN ('edit_suggested','edit_won','meal_cooked','meal_saved','new_follower',
                     'content_removed','flag_resolved'));

-- Tracks whether the author of a winning ingredient/guide edit has already
-- been told so - apply_winner() runs after every vote, not just the vote
-- that actually changes the leader, and re-notifying "your edit won" on
-- every subsequent vote for an edit that already won would be spam, not
-- news. Once true, that edit never notifies again even if it keeps winning.
ALTER TABLE ingredient_edits ADD COLUMN notified_win BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE guide_edits ADD COLUMN notified_win BOOLEAN NOT NULL DEFAULT false;
