//! Heuristic diet-compatibility tags for catalog ingredients.
//!
//! Rule-based from name/category/food_group, not a nutrition database - it
//! will be wrong sometimes. That's an acceptable starting point for
//! vegetarian/vegan/pescatarian (a taste and ethics question, correctable by
//! a review-then-cook cycle) and a genuinely uncomfortable one for
//! gluten-free/dairy-free/nut-free (an allergy question, where "probably
//! fine" isn't good enough). The mitigation is the same one nutrition.rs
//! uses for partial data: never claim more than is actually known, and route
//! every tag through the existing community edit-and-vote system (see
//! ingredients.rs's `EDIT_FIELDS`) so a wrong one gets corrected rather than
//! sitting wrong forever. The UI copy on a diet badge should say so.

pub const ALL_DIET_FLAGS: [&str; 6] =
    ["vegetarian", "vegan", "pescatarian", "gluten-free", "dairy-free", "nut-free"];

const MEAT_WORDS: [&str; 15] = [
    "beef", "pork", "lamb", "veal", "chicken", "turkey", "duck", "goose", "bacon", "ham",
    "sausage", "salami", "pepperoni", "venison", "game meat",
];
const FISH_WORDS: [&str; 17] = [
    "fish", "shrimp", "prawn", "crab", "lobster", "salmon", "tuna", "cod", "shellfish", "clam",
    "oyster", "mussel", "scallop", "squid", "octopus", "anchov", "sardine",
];
const PLANT_MILK_WORDS: [&str; 6] =
    ["almond milk", "oat milk", "soy milk", "coconut milk", "rice milk", "cashew milk"];
const DAIRY_WORDS: [&str; 8] =
    ["milk", "cheese", "butter", "cream", "yogurt", "yoghurt", "whey", "custard"];
const EGG_WORDS: [&str; 1] = ["egg"];
// Baked goods and desserts default to containing butter/egg unless the name
// says otherwise - the honest default for an unlabeled "cookie" is "probably
// not vegan," not "no evidence of dairy, so assume vegan."
const LIKELY_BUTTER_EGG_WORDS: [&str; 4] = ["cookie", "cake", "pastry", "custard"];
const GLUTEN_WORDS: [&str; 15] = [
    "wheat", "barley", "rye", "malt", "spelt", "farro", "couscous", "semolina", "bulgur",
    "cracker", "noodle", "pasta", "bread", "cookie", "cake",
];
const NUT_WORDS: [&str; 11] = [
    "almond", "walnut", "pecan", "cashew", "pistachio", "hazelnut", "peanut", "macadamia",
    "brazil nut", "pine nut", "chestnut",
];
// Seeds sit in the same USDA "Nut and Seed Products" group as tree nuts but
// aren't the allergen tree-nut labeling covers - named explicitly rather than
// assumed, so a mislabeled item defaults to the conservative "not nut-free."
const SEED_WORDS: [&str; 6] = ["seed", "chia", "flax", "sunflower", "pumpkin seed", "sesame"];

fn contains_any(haystack: &str, words: &[&str]) -> bool {
    words.iter().any(|w| haystack.contains(w))
}

pub fn compute_diet_flags(name: &str, category: &str, food_group: Option<&str>) -> Vec<String> {
    let n = name.to_lowercase();
    let fg = food_group.unwrap_or_default();

    let is_meat_group = category == "Protein"
        && (fg.contains("Beef")
            || fg.contains("Poultry")
            || fg.contains("Pork")
            || fg.contains("Lamb")
            || fg.contains("Sausages"));
    let is_fish_group = category == "Protein" && (fg.contains("Finfish") || fg.contains("Shellfish"));
    let is_nut_seed_group = category == "Protein" && fg.contains("Nut and Seed");
    let is_plant_milk = contains_any(&n, &PLANT_MILK_WORDS);

    let has_meat = is_meat_group || contains_any(&n, &MEAT_WORDS);
    let has_fish = is_fish_group || contains_any(&n, &FISH_WORDS);
    let has_egg = contains_any(&n, &EGG_WORDS);
    let has_dairy = !is_plant_milk
        && ((category == "Dairy" && !has_egg)
            || contains_any(&n, &DAIRY_WORDS)
            || contains_any(&n, &LIKELY_BUTTER_EGG_WORDS));
    let has_gluten = contains_any(&n, &GLUTEN_WORDS) && !n.contains("gluten-free") && !n.contains("gluten free");
    let has_nut = contains_any(&n, &NUT_WORDS) || (is_nut_seed_group && !contains_any(&n, &SEED_WORDS));

    let vegetarian = !has_meat && !has_fish;
    let vegan = vegetarian && !has_dairy && !has_egg;
    let pescatarian = !has_meat;
    let gluten_free = !has_gluten;
    let dairy_free = !has_dairy;
    let nut_free = !has_nut;

    [
        (vegetarian, "vegetarian"),
        (vegan, "vegan"),
        (pescatarian, "pescatarian"),
        (gluten_free, "gluten-free"),
        (dairy_free, "dairy-free"),
        (nut_free, "nut-free"),
    ]
    .into_iter()
    .filter_map(|(ok, flag)| ok.then(|| flag.to_string()))
    .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn flags(name: &str, category: &str, food_group: &str) -> Vec<String> {
        compute_diet_flags(name, category, Some(food_group))
    }

    #[test]
    fn meat_is_excluded_from_every_meat_free_diet() {
        let f = flags("Chicken, breast, meat and skin, raw", "Protein", "Poultry Products");
        assert!(!f.contains(&"vegetarian".to_string()));
        assert!(!f.contains(&"vegan".to_string()));
        assert!(!f.contains(&"pescatarian".to_string()));
        // Plain chicken has none of the other three excluded properties.
        assert!(f.contains(&"gluten-free".to_string()));
        assert!(f.contains(&"dairy-free".to_string()));
        assert!(f.contains(&"nut-free".to_string()));
    }

    #[test]
    fn fish_is_vegetarian_and_vegan_excluded_but_pescatarian_included() {
        let f = flags("Salmon, raw", "Protein", "Finfish and Shellfish Products");
        assert!(!f.contains(&"vegetarian".to_string()));
        assert!(!f.contains(&"vegan".to_string()));
        assert!(f.contains(&"pescatarian".to_string()), "pescatarians eat fish");
    }

    #[test]
    fn dairy_is_vegetarian_but_not_vegan() {
        let f = flags("Cheese, cheddar", "Dairy", "Dairy and Egg Products");
        assert!(f.contains(&"vegetarian".to_string()));
        assert!(!f.contains(&"vegan".to_string()));
        assert!(!f.contains(&"dairy-free".to_string()));
    }

    #[test]
    fn eggs_are_vegetarian_but_not_vegan_and_not_flagged_as_dairy() {
        let f = flags("Egg, whole, raw", "Dairy", "Dairy and Egg Products");
        assert!(f.contains(&"vegetarian".to_string()));
        assert!(!f.contains(&"vegan".to_string()));
        // The USDA groups eggs under "Dairy and Egg Products", but an egg is
        // not dairy - this is the one case that needs a name check to avoid
        // a false dairy-allergy flag.
        assert!(f.contains(&"dairy-free".to_string()), "an egg is not dairy");
    }

    #[test]
    fn plant_milk_is_vegan_despite_the_dairy_category() {
        let f = flags("Almond milk, unsweetened, plain, shelf stable", "Dairy", "Beverages");
        assert!(f.contains(&"vegan".to_string()));
        assert!(f.contains(&"dairy-free".to_string()));
    }

    #[test]
    fn a_named_meat_exception_overrides_a_vegetable_category() {
        // Restaurant dishes land wherever their primary ingredient sorts them
        // in this catalog, so the meat word in the name is the only real signal.
        let f = flags("Restaurant, Latino, tamale, pork", "Protein", "Restaurant Foods");
        assert!(!f.contains(&"vegetarian".to_string()));
    }

    #[test]
    fn a_dish_explicitly_naming_no_meat_stays_vegetarian() {
        let f = flags("Restaurant, Chinese, fried rice, without meat", "Grain", "Restaurant Foods");
        assert!(f.contains(&"vegetarian".to_string()));
    }

    #[test]
    fn wheat_flour_is_not_gluten_free_but_rice_flour_is() {
        let wheat = flags("Flour, bread, white, enriched, unbleached", "Grain", "Cereal Grains and Pasta");
        assert!(!wheat.contains(&"gluten-free".to_string()));
        let rice = flags("Rice, white, long-grain, raw", "Grain", "Cereal Grains and Pasta");
        assert!(rice.contains(&"gluten-free".to_string()));
    }

    #[test]
    fn tree_nuts_are_excluded_but_seeds_in_the_same_group_are_not() {
        let almond = flags("Almonds, raw", "Protein", "Nut and Seed Products");
        assert!(!almond.contains(&"nut-free".to_string()));
        let chia = flags("Seeds, chia, dried", "Protein", "Nut and Seed Products");
        assert!(chia.contains(&"nut-free".to_string()));
    }

    #[test]
    fn unlabeled_baked_goods_default_to_not_vegan_not_gluten_free() {
        let f = flags("Cookies, oatmeal, soft, with raisins", "Pantry", "Baked Products");
        assert!(f.contains(&"vegetarian".to_string()));
        assert!(!f.contains(&"vegan".to_string()), "unlabeled cookies likely contain butter/egg");
        assert!(!f.contains(&"gluten-free".to_string()));
    }
}
