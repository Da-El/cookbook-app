-- Search, community ingredient aliases, and a ranking score that isn't a raw mean.
--
-- Three problems this fixes, in order of how badly they hurt:
--
--   1. Ranking. `ORDER BY rating DESC, rating_count DESC` puts a meal with one
--      10/10 above a meal with fifty 9s, which is exactly backwards - one
--      person's enthusiasm is not stronger evidence than fifty people's. The
--      Bayesian shrink below pulls thinly-rated meals toward the site-wide
--      average until they've earned the right to move.
--
--   2. Search. `name ILIKE '%term%'` can't rank, can't stem ("tomatoes" misses
--      "tomato"), and can't see a recipe's own description or steps. Real
--      tsvector search fixes all three; pg_trgm covers the typos tsvector can't.
--
--   3. Naming. USDA calls it "Coriander, raw"; half the world calls it
--      cilantro. Neither is wrong, so aliases are community-owned rather than
--      a fixed synonym table someone has to maintain.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============ 1. RANKING ============

-- Materialized rather than computed per query: the formula needs a site-wide
-- aggregate as its prior, and a STABLE function returning that would be
-- re-evaluated per row in an ORDER BY - an accidental O(n^2). Ratings are
-- written far less often than they're read, so paying on write is the cheap side.
ALTER TABLE meals ADD COLUMN ranked_score NUMERIC(6,3) NOT NULL DEFAULT 0;
CREATE INDEX meals_ranked_idx ON meals(ranked_score DESC) WHERE status = 'live';

ALTER TABLE ingredients ADD COLUMN ranked_score NUMERIC(6,3) NOT NULL DEFAULT 0;
CREATE INDEX ingredients_ranked_idx ON ingredients(ranked_score DESC);

-- (confidence * prior + mean * n) / (confidence + n)
--
-- `confidence` is how many votes of pure site-average opinion every subject is
-- treated as starting with. At 5, a lone 10/10 lands near 7 while fifty 9s land
-- near 8.8 - the well-attested score wins, which is the whole point.
--
-- Reconstructing the sum as mean*n leans on the cached, 1-decimal `rating`
-- rather than re-summing `ratings`. Worst-case error is under 0.05 of a point
-- and it keeps this a pure arithmetic function over one row.
CREATE FUNCTION bayesian_score(mean NUMERIC, n INTEGER, prior NUMERIC, confidence NUMERIC)
RETURNS NUMERIC AS $$
    SELECT CASE
        WHEN n <= 0 THEN 0::NUMERIC
        ELSE round((confidence * prior + mean * n) / (confidence + n), 3)
    END
$$ LANGUAGE SQL IMMUTABLE;

-- Rewrites every row because the prior itself moves when any rating lands.
-- Recomputing only the rated meal would let the rest silently drift out of
-- order against a prior that no longer exists.
CREATE FUNCTION recompute_meal_rankings() RETURNS void AS $$
    UPDATE meals SET ranked_score = bayesian_score(
        rating, rating_count,
        (SELECT COALESCE(avg(value), 6.0) FROM ratings WHERE subject_type = 'meal'),
        5
    );
$$ LANGUAGE SQL;

CREATE FUNCTION recompute_ingredient_rankings() RETURNS void AS $$
    UPDATE ingredients SET ranked_score = bayesian_score(
        rating, rating_count,
        (SELECT COALESCE(avg(value), 6.0) FROM ratings WHERE subject_type = 'ingredient'),
        5
    );
$$ LANGUAGE SQL;

SELECT recompute_meal_rankings();
SELECT recompute_ingredient_rankings();

-- ============ 2. SEARCH ============

-- Former names, appended on rename so a recipe stays findable by what someone
-- remembers calling it. The edit history already records renames; this is the
-- slice of it search needs, kept denormalised so the tsvector can be generated.
ALTER TABLE meals ADD COLUMN former_names TEXT NOT NULL DEFAULT '';

-- `array_to_string` is only STABLE - it takes anyarray, so in general it calls
-- an element output function that needn't be immutable, and a generated column
-- refuses it. Narrowed to TEXT[] the element output function is `textout`,
-- which is immutable, so this wrapper's claim is true rather than a promise to
-- the planner we can't keep. Do not widen the parameter type.
CREATE FUNCTION text_array_to_string(arr TEXT[]) RETURNS TEXT AS $$
    SELECT array_to_string(arr, ' ')
$$ LANGUAGE SQL IMMUTABLE;

-- Weights are the ranking signal inside a match: A=name, B=former names and
-- cuisine/type, C=description, D=steps. A recipe whose *title* is "carbonara"
-- should outrank one that merely mentions carbonara in step 4.
--
-- 'english'::regconfig, not 'english' - the text form resolves the config at
-- runtime and is only STABLE, which a generated column also rejects.
ALTER TABLE meals ADD COLUMN search_vector tsvector
    GENERATED ALWAYS AS (
        setweight(to_tsvector('english'::regconfig, name), 'A') ||
        setweight(to_tsvector('english'::regconfig, former_names), 'B') ||
        setweight(to_tsvector('english'::regconfig, cuisine || ' ' || meal_type), 'B') ||
        setweight(to_tsvector('english'::regconfig, description), 'C') ||
        setweight(to_tsvector('english'::regconfig, text_array_to_string(steps)), 'D')
    ) STORED;
CREATE INDEX meals_search_idx ON meals USING GIN(search_vector);
CREATE INDEX meals_name_trgm_idx ON meals USING GIN(name gin_trgm_ops);

ALTER TABLE ingredients ADD COLUMN search_vector tsvector
    GENERATED ALWAYS AS (
        setweight(to_tsvector('english'::regconfig, name), 'A') ||
        setweight(to_tsvector('english'::regconfig, category), 'B') ||
        setweight(to_tsvector('english'::regconfig,
                  coalesce(food_group, '') || ' ' || coalesce(food_subgroup, '')), 'C') ||
        setweight(to_tsvector('english'::regconfig, description), 'D')
    ) STORED;
CREATE INDEX ingredients_search_idx ON ingredients USING GIN(search_vector);
CREATE INDEX ingredients_name_trgm_idx ON ingredients USING GIN(name gin_trgm_ops);

-- ============ 3. INGREDIENT ALIASES ============

-- Alternate names, proposed and judged by the people who cook. Unlike
-- ingredient_edits - where the top-voted value overwrites a column and every
-- rival disappears - aliases are additive: "cilantro" and "Chinese parsley"
-- are both correct and both should survive.
--
-- Nothing is hard-deleted here either; withdrawing sets status and leaves the
-- row, so a withdrawn-then-resubmitted alias can't be used to launder history.
CREATE TABLE ingredient_aliases (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ingredient_id BIGINT NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    author_id     BIGINT REFERENCES users(id) ON DELETE SET NULL,
    -- Denormalised so attribution survives the author deleting their account.
    author_name   TEXT,
    -- Net of up and down votes. Cached from alias_votes on every write.
    score         INTEGER NOT NULL DEFAULT 0,
    vote_count    INTEGER NOT NULL DEFAULT 0,
    status        TEXT NOT NULL DEFAULT 'live' CHECK (status IN ('live','withdrawn')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- One proposal per name per ingredient, case-insensitively: re-proposing an
-- existing alias should be a vote on it, not a duplicate row that splits it.
CREATE UNIQUE INDEX ingredient_aliases_unique_idx
    ON ingredient_aliases(ingredient_id, lower(name));
CREATE INDEX ingredient_aliases_lookup_idx
    ON ingredient_aliases(ingredient_id) WHERE status = 'live';
-- Aliases are searched by name, so give that its own trigram index.
CREATE INDEX ingredient_aliases_name_trgm_idx
    ON ingredient_aliases USING GIN(name gin_trgm_ops);

-- Directional, unlike edit_votes' single undirected toggle: "that's wrong" is a
-- distinct and necessary statement from "I have no opinion", and without it a
-- bad alias can only ever be ignored, never rejected.
CREATE TABLE alias_votes (
    alias_id   BIGINT NOT NULL REFERENCES ingredient_aliases(id) ON DELETE CASCADE,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    value      SMALLINT NOT NULL CHECK (value IN (-1, 1)),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (alias_id, user_id)
);
CREATE INDEX alias_votes_alias_idx ON alias_votes(alias_id);
