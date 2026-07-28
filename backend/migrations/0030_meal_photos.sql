-- Additional gallery photos beyond meals.photo_url, which stays the cover
-- shown everywhere a thumbnail is needed (MealCard, Browse, feed, chef
-- pages). This table is purely additive extra views of the finished dish,
-- shown only on the meal's own detail page.
CREATE TABLE meal_photos (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    meal_id     BIGINT NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
    photo_url   TEXT NOT NULL,
    position    INT NOT NULL DEFAULT 0
);
CREATE INDEX meal_photos_meal_idx ON meal_photos(meal_id, position);
