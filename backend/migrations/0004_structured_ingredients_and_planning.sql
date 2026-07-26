-- Restructures recipe ingredients and adds meal planning, guides, and the
-- import pipeline.
--
-- The old meal_ingredients shape blocked most of what's added here:
--   * ingredient_id NOT NULL  -> an imported "2 tbsp gochujang" had nothing in
--                                the 363-item USDA catalog to point at
--   * qty TEXT                -> "2 cups" + "1 tbsp" can't be summed, so no
--                                aggregated grocery list and no serving scaling
--   * PK (meal_id, ingredient_id) -> a recipe couldn't use flour twice
--                                    ("1 cup for the dough, 2 tbsp to dust")

-- ============ STRUCTURED RECIPE INGREDIENTS ============

ALTER TABLE meal_ingredients RENAME TO meal_ingredients_old;

CREATE TABLE meal_ingredients (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    meal_id       BIGINT NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
    -- Optional: the catalog page this line was matched to. NULL means we kept
    -- the recipe's own wording without finding a match, which is a normal
    -- outcome for imports rather than an error.
    ingredient_id BIGINT REFERENCES ingredients(id) ON DELETE SET NULL,
    -- Always what the recipe itself called it ("cherry tomatoes"), even when
    -- matched to a differently-named catalog entry ("Tomatoes, grape, raw").
    -- Keeping it means the recipe still reads the way its author wrote it, and
    -- it's what survives if the catalog entry is later deleted.
    raw_name      TEXT NOT NULL,
    amount        NUMERIC(10,3),
    -- Normalised at write time (see units.rs): g, kg, ml, l, tsp, tbsp, cup,
    -- floz, oz, lb, piece, clove, pinch, ... NULL for "salt to taste".
    unit          TEXT,
    -- Preparation that isn't part of the quantity: "finely chopped", "divided".
    note          TEXT,
    position      INTEGER NOT NULL
);

-- Lossless carry-over: the old qty was free text, so it moves to `note` rather
-- than being guessed at. Both databases hold zero meals at the time of writing,
-- so this is a formality that keeps the migration replayable.
INSERT INTO meal_ingredients (meal_id, ingredient_id, raw_name, note, position)
SELECT o.meal_id, o.ingredient_id, i.name, o.qty, o.position
FROM meal_ingredients_old o
JOIN ingredients i ON i.id = o.ingredient_id;

DROP TABLE meal_ingredients_old;

-- Indexes come after the drop: RENAME TABLE leaves index names untouched, so
-- the old meal_ingredients_ingredient_idx still occupies that name until its
-- table is gone.
CREATE INDEX meal_ingredients_meal_idx ON meal_ingredients(meal_id, position);
CREATE INDEX meal_ingredients_ingredient_idx ON meal_ingredients(ingredient_id);

-- ============ MEAL PLANNING ============

-- Deliberately no unique constraint on (user_id, plan_date, slot): a dinner can
-- legitimately be two rows (a main plus a side).
CREATE TABLE meal_plan_entries (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_date  DATE NOT NULL,
    slot       TEXT NOT NULL CHECK (slot IN ('breakfast','lunch','dinner','snack')),
    meal_id    BIGINT NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
    servings   INTEGER NOT NULL DEFAULT 1 CHECK (servings > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX meal_plan_user_date_idx ON meal_plan_entries(user_id, plan_date);

-- ============ BEGINNER GUIDES ============

CREATE TABLE guides (
    id       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    slug     TEXT NOT NULL UNIQUE,
    title    TEXT NOT NULL,
    summary  TEXT NOT NULL,
    -- Plain paragraphs separated by blank lines; a leading "- " makes a step.
    body     TEXT NOT NULL,
    topic    TEXT NOT NULL,
    minutes  INTEGER,
    position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX guides_topic_idx ON guides(topic, position);

-- ============ RECIPE IMPORT PIPELINE ============

-- Every import attempt is recorded with the extractor that handled it, so
-- adding an LLM extractor later is a new `extractor` value and code path
-- rather than a schema change. `draft` holds the extracted recipe awaiting
-- the user's review; `meal_id` is set once they accept it.
CREATE TABLE recipe_imports (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_kind TEXT NOT NULL CHECK (source_kind IN ('url','text','image','video')),
    source_url  TEXT,
    source_text TEXT,
    extractor   TEXT NOT NULL CHECK (extractor IN ('jsonld','microdata','llm','manual')),
    status      TEXT NOT NULL CHECK (status IN ('extracted','failed','saved')),
    draft       JSONB,
    error       TEXT,
    meal_id     BIGINT REFERENCES meals(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX recipe_imports_user_idx ON recipe_imports(user_id, created_at DESC);

-- Where an imported recipe came from, shown as attribution on the meal page.
ALTER TABLE meals ADD COLUMN source_url  TEXT;
ALTER TABLE meals ADD COLUMN source_name TEXT;
