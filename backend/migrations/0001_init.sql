-- Cookbook schema
-- See design_handoff_cookbook_v3/README.md for the product spec this implements.

-- ============ USERS & SOCIAL ============

-- email/password_hash are nullable to support seed "chef" profiles (unclaimed accounts
-- backing prototype content like 'Nonna Lucia') that authored content but can't log in.
CREATE TABLE users (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email               TEXT,
    password_hash       TEXT,
    display_name        TEXT NOT NULL,
    bio                 TEXT,
    diet_prefs          TEXT[] NOT NULL DEFAULT '{}',

    -- Cookbook customization (Customize your Cookbook screen)
    cb_title            TEXT,
    cb_bio              TEXT,
    cb_page_theme       TEXT NOT NULL DEFAULT 'cream',
    cb_page_photo_url   TEXT,
    cb_hero_theme       TEXT NOT NULL DEFAULT 'cream',
    cb_hero_photo_url   TEXT,
    cb_avatar_theme     TEXT NOT NULL DEFAULT 'green',
    cb_avatar_photo_url TEXT,

    -- Per-section visibility (Settings screen)
    vis_mine            TEXT NOT NULL DEFAULT 'public' CHECK (vis_mine IN ('public','private')),
    vis_made            TEXT NOT NULL DEFAULT 'public' CHECK (vis_made IN ('public','private')),
    vis_want            TEXT NOT NULL DEFAULT 'public' CHECK (vis_want IN ('public','private')),
    vis_fridge          TEXT NOT NULL DEFAULT 'public' CHECK (vis_fridge IN ('public','private')),

    has_onboarded       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX users_email_lower_uq ON users (lower(email)) WHERE email IS NOT NULL;

-- cbSectionPhotos{} - per-subtab cover photo on the Cookbook page
CREATE TABLE user_section_photos (
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    section     TEXT NOT NULL CHECK (section IN ('cooked','saved','published','fridge','shopping')),
    photo_url   TEXT NOT NULL,
    PRIMARY KEY (user_id, section)
);

CREATE TABLE follows (
    follower_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    followee_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (follower_id, followee_id),
    CHECK (follower_id <> followee_id)
);
CREATE INDEX follows_followee_idx ON follows(followee_id);

-- ============ INGREDIENTS ============

-- description/photo_url/category are a materialized cache of the current winning
-- community edit for that field (see ingredient_edits + pickWinner logic below).
CREATE TABLE ingredients (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name            TEXT NOT NULL,
    category        TEXT NOT NULL,
    foodb_group     TEXT,
    foodb_subgroup  TEXT,
    description     TEXT NOT NULL DEFAULT '',
    photo_url       TEXT,
    stock_photo_url TEXT,
    rating          NUMERIC(3,1) NOT NULL DEFAULT 0,
    rating_count    INTEGER NOT NULL DEFAULT 0,
    author_id       BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ingredients_category_idx ON ingredients(category);
CREATE INDEX ingredients_name_idx ON ingredients (lower(name));

CREATE TABLE ingredient_nutrition (
    ingredient_id  BIGINT PRIMARY KEY REFERENCES ingredients(id) ON DELETE CASCADE,
    serving_size   TEXT NOT NULL DEFAULT '100 g',
    calories       INTEGER,
    protein        NUMERIC(5,1),
    carbs          NUMERIC(5,1),
    fat            NUMERIC(5,1),
    fiber          NUMERIC(5,1),
    sugar          NUMERIC(5,1),
    source         TEXT NOT NULL DEFAULT 'FooDB' CHECK (source IN ('FooDB','Community')),
    vit_c_mg       NUMERIC(6,1),
    calcium_mg     NUMERIC(6,1),
    iron_mg        NUMERIC(6,1),
    potassium_mg   NUMERIC(6,1),
    magnesium_mg   NUMERIC(6,1),
    sodium_mg      NUMERIC(7,1)
);

-- Community edit proposals for description/category/photo/nutrition. `value` is a
-- string for the first three, a nutrition-shaped object for 'nutrition'. Winner =
-- highest votes, ties go to the oldest edit (lowest id) - matches the prototype's
-- pickWinner(): linear max with strict '>' over insertion-ordered entries.
CREATE TABLE ingredient_edits (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ingredient_id  BIGINT NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
    field          TEXT NOT NULL CHECK (field IN ('description','category','photo','nutrition')),
    value          JSONB NOT NULL,
    author_id      BIGINT REFERENCES users(id) ON DELETE SET NULL,
    votes          INTEGER NOT NULL DEFAULT 1,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ingredient_edits_lookup_idx ON ingredient_edits(ingredient_id, field);

-- One vote per user per edit. Unlike a typical poll, a user CAN vote for multiple
-- competing edits of the same field at once - the prototype doesn't prevent this.
CREATE TABLE edit_votes (
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    edit_id     BIGINT NOT NULL REFERENCES ingredient_edits(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, edit_id)
);

-- ============ MEALS ============

CREATE TABLE meals (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name            TEXT NOT NULL,
    author_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    cuisine         TEXT NOT NULL,
    meal_type       TEXT NOT NULL,
    time_minutes    INTEGER NOT NULL,
    serves          TEXT,
    description     TEXT NOT NULL DEFAULT '',
    steps           TEXT[] NOT NULL DEFAULT '{}',
    photo_url       TEXT,
    stock_photo_url TEXT,
    rating          NUMERIC(3,1) NOT NULL DEFAULT 0,
    rating_count    INTEGER NOT NULL DEFAULT 0,
    visibility      TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','personal')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX meals_author_idx ON meals(author_id);
CREATE INDEX meals_cuisine_idx ON meals(cuisine);
CREATE INDEX meals_meal_type_idx ON meals(meal_type);

-- qty is free text (e.g. '2 cups') to match the prototype's ingQtys map; position
-- preserves display/step order since seeded meals carry no quantities at all.
CREATE TABLE meal_ingredients (
    meal_id       BIGINT NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
    ingredient_id BIGINT NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,
    qty           TEXT,
    position      INTEGER NOT NULL,
    PRIMARY KEY (meal_id, ingredient_id)
);
CREATE INDEX meal_ingredients_ingredient_idx ON meal_ingredients(ingredient_id);

-- ============ RATINGS & REVIEWS ============

-- Generic 1-10 rating, shared by meals and ingredients (subject_type discriminates).
-- meals.rating/ingredients.rating are materialized averages kept in sync on write.
CREATE TABLE ratings (
    user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject_type  TEXT NOT NULL CHECK (subject_type IN ('meal','ingredient')),
    subject_id    BIGINT NOT NULL,
    value         SMALLINT NOT NULL CHECK (value BETWEEN 1 AND 10),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, subject_type, subject_id)
);

-- The prototype's Chef-page "Reviews" tab is entirely fabricated at render time.
-- This table makes it real: a note+score left after cooking (cookJournal + rating).
CREATE TABLE reviews (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    meal_id     BIGINT NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
    score       SMALLINT CHECK (score BETWEEN 1 AND 10),
    note        TEXT,
    is_public   BOOLEAN NOT NULL DEFAULT TRUE,
    cooked_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX reviews_meal_idx ON reviews(meal_id);
CREATE INDEX reviews_user_idx ON reviews(user_id);

-- ============ USER'S KITCHEN ============

-- Either ingredient_id (a real catalog page) or custom_name (free text, no page yet).
CREATE TABLE fridge_items (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ingredient_id  BIGINT REFERENCES ingredients(id) ON DELETE CASCADE,
    custom_name    TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((ingredient_id IS NULL) <> (custom_name IS NULL))
);
CREATE UNIQUE INDEX fridge_items_user_ingredient_uq ON fridge_items(user_id, ingredient_id) WHERE ingredient_id IS NOT NULL;
CREATE UNIQUE INDEX fridge_items_user_custom_uq ON fridge_items(user_id, lower(custom_name)) WHERE custom_name IS NOT NULL;

CREATE TABLE shopping_items (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ingredient_id  BIGINT REFERENCES ingredients(id) ON DELETE CASCADE,
    custom_name    TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((ingredient_id IS NULL) <> (custom_name IS NULL))
);
CREATE UNIQUE INDEX shopping_items_user_ingredient_uq ON shopping_items(user_id, ingredient_id) WHERE ingredient_id IS NOT NULL;
CREATE UNIQUE INDEX shopping_items_user_custom_uq ON shopping_items(user_id, lower(custom_name)) WHERE custom_name IS NOT NULL;

CREATE TABLE cooked_meals (
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    meal_id     BIGINT NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
    cooked_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, meal_id)
);

CREATE TABLE saved_meals (
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    meal_id     BIGINT NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
    saved_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, meal_id)
);

-- Home feed likes, on either a meal post or an ingredient-edit post.
CREATE TABLE post_likes (
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_type   TEXT NOT NULL CHECK (post_type IN ('meal','ingredient_edit')),
    subject_id  BIGINT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, post_type, subject_id)
);

-- ============ ACTIVITY ============

-- The prototype computes the Activity tab on the fly from other state. Persisting
-- it as real rows lets it survive/scale instead of being recomputed every load.
CREATE TABLE notifications (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    recipient_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    actor_id      BIGINT REFERENCES users(id) ON DELETE SET NULL,
    type          TEXT NOT NULL CHECK (type IN ('edit_suggested','edit_won','meal_cooked','meal_saved','new_follower')),
    subject_type  TEXT CHECK (subject_type IN ('meal','ingredient','edit')),
    subject_id    BIGINT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    seen_at       TIMESTAMPTZ
);
CREATE INDEX notifications_recipient_idx ON notifications(recipient_id, created_at DESC);

-- ============ ASK CHEF (AI) ============

CREATE TABLE ask_chef_messages (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role        TEXT NOT NULL CHECK (role IN ('user','assistant')),
    content     TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ask_chef_messages_user_idx ON ask_chef_messages(user_id, created_at);
