-- Unlike vis_mine/vis_made/vis_want/vis_fridge (all default 'public'), a
-- meal plan is schedule/routine data rather than "what I cooked" - default
-- private, opt in rather than opt out.
ALTER TABLE users ADD COLUMN vis_plan TEXT NOT NULL DEFAULT 'private'
    CHECK (vis_plan IN ('public', 'private'));
