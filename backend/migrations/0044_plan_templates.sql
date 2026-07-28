CREATE TABLE plan_templates (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX plan_templates_user_idx ON plan_templates (user_id, created_at DESC);

CREATE TABLE plan_template_entries (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    template_id BIGINT NOT NULL REFERENCES plan_templates(id) ON DELETE CASCADE,
    -- Days since the template's own reference start (0-6) rather than a
    -- real date - a template is a shape for a week, not tied to any one
    -- calendar week.
    day_offset SMALLINT NOT NULL CHECK (day_offset BETWEEN 0 AND 6),
    slot TEXT NOT NULL CHECK (slot = ANY (ARRAY['breakfast','lunch','dinner','snack'])),
    meal_id BIGINT NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
    servings INTEGER NOT NULL DEFAULT 1 CHECK (servings > 0)
);

CREATE INDEX plan_template_entries_template_idx ON plan_template_entries (template_id);
