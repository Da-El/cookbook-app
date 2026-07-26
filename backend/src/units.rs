//! Parsing and arithmetic for recipe quantities.
//!
//! Recipes are written for humans ("2 1/2 cups flour, sifted"), but a grocery
//! list has to add them up. This turns a written line into `amount + unit +
//! name + note`, and knows enough about units to sum compatible ones.

use serde::{Deserialize, Serialize};

/// What a unit can be added to. Mass and volume convert within themselves;
/// every countable unit is its own dimension, so "2 cloves" and "1 can" stay
/// apart instead of collapsing into a meaningless "3".
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Dimension {
    Mass,
    Volume,
    Count(&'static str),
}

struct UnitDef {
    canonical: &'static str,
    dimension: Dimension,
    /// Multiplier into the dimension's base unit (grams / millilitres / 1).
    to_base: f64,
    aliases: &'static [&'static str],
}

/// Ordered longest-alias-first at lookup time so "fl oz" wins over "oz".
const UNITS: &[UnitDef] = &[
    // -- mass, base = gram
    UnitDef { canonical: "g",  dimension: Dimension::Mass, to_base: 1.0,
              aliases: &["g", "gram", "grams", "gm", "gs"] },
    UnitDef { canonical: "kg", dimension: Dimension::Mass, to_base: 1000.0,
              aliases: &["kg", "kilo", "kilos", "kilogram", "kilograms"] },
    UnitDef { canonical: "oz", dimension: Dimension::Mass, to_base: 28.349_523,
              aliases: &["oz", "ounce", "ounces"] },
    UnitDef { canonical: "lb", dimension: Dimension::Mass, to_base: 453.592_37,
              aliases: &["lb", "lbs", "pound", "pounds"] },
    // -- volume, base = millilitre
    UnitDef { canonical: "ml",   dimension: Dimension::Volume, to_base: 1.0,
              aliases: &["ml", "millilitre", "millilitres", "milliliter", "milliliters", "cc"] },
    UnitDef { canonical: "l",    dimension: Dimension::Volume, to_base: 1000.0,
              aliases: &["l", "litre", "litres", "liter", "liters"] },
    UnitDef { canonical: "tsp",  dimension: Dimension::Volume, to_base: 4.928_922,
              aliases: &["tsp", "tsps", "teaspoon", "teaspoons", "t"] },
    UnitDef { canonical: "tbsp", dimension: Dimension::Volume, to_base: 14.786_765,
              aliases: &["tbsp", "tbsps", "tablespoon", "tablespoons", "tbs", "tbl"] },
    UnitDef { canonical: "cup",  dimension: Dimension::Volume, to_base: 236.588_236,
              aliases: &["cup", "cups", "c"] },
    UnitDef { canonical: "floz", dimension: Dimension::Volume, to_base: 29.573_53,
              aliases: &["floz", "fl oz", "fluid ounce", "fluid ounces", "fl. oz", "fl.oz"] },
    UnitDef { canonical: "pint", dimension: Dimension::Volume, to_base: 473.176_473,
              aliases: &["pint", "pints", "pt"] },
    UnitDef { canonical: "quart", dimension: Dimension::Volume, to_base: 946.352_946,
              aliases: &["quart", "quarts", "qt"] },
    UnitDef { canonical: "gallon", dimension: Dimension::Volume, to_base: 3785.411_784,
              aliases: &["gallon", "gallons", "gal"] },
    // -- countable
    UnitDef { canonical: "clove",   dimension: Dimension::Count("clove"),   to_base: 1.0,
              aliases: &["clove", "cloves"] },
    UnitDef { canonical: "can",     dimension: Dimension::Count("can"),     to_base: 1.0,
              aliases: &["can", "cans"] },
    UnitDef { canonical: "package", dimension: Dimension::Count("package"), to_base: 1.0,
              aliases: &["package", "packages", "pkg", "pack", "packs"] },
    UnitDef { canonical: "bunch",   dimension: Dimension::Count("bunch"),   to_base: 1.0,
              aliases: &["bunch", "bunches"] },
    UnitDef { canonical: "slice",   dimension: Dimension::Count("slice"),   to_base: 1.0,
              aliases: &["slice", "slices"] },
    UnitDef { canonical: "head",    dimension: Dimension::Count("head"),    to_base: 1.0,
              aliases: &["head", "heads"] },
    UnitDef { canonical: "stalk",   dimension: Dimension::Count("stalk"),   to_base: 1.0,
              aliases: &["stalk", "stalks"] },
    UnitDef { canonical: "sprig",   dimension: Dimension::Count("sprig"),   to_base: 1.0,
              aliases: &["sprig", "sprigs"] },
    UnitDef { canonical: "pinch",   dimension: Dimension::Count("pinch"),   to_base: 1.0,
              aliases: &["pinch", "pinches"] },
    UnitDef { canonical: "dash",    dimension: Dimension::Count("dash"),    to_base: 1.0,
              aliases: &["dash", "dashes"] },
    UnitDef { canonical: "piece",   dimension: Dimension::Count("piece"),   to_base: 1.0,
              aliases: &["piece", "pieces", "pc", "whole", "large", "medium", "small"] },
];

fn find_unit(token: &str) -> Option<&'static UnitDef> {
    let t = token.trim().trim_end_matches('.').to_lowercase();
    UNITS.iter().find(|u| u.aliases.contains(&t.as_str()))
}

pub fn unit_dimension(unit: &str) -> Option<Dimension> {
    find_unit(unit).map(|u| u.dimension.clone())
}

/// Value of `amount` in the dimension's base unit, for summing.
pub fn to_base(amount: f64, unit: &str) -> Option<f64> {
    find_unit(unit).map(|u| amount * u.to_base)
}

/// Inverse of `to_base`, for rendering a total back in a familiar unit.
pub fn from_base(base_amount: f64, unit: &str) -> Option<f64> {
    find_unit(unit).map(|u| base_amount / u.to_base)
}

/// "1/2" -> 0.5, "½" -> 0.5, "2 1/2" -> 2.5. Returns None for anything else.
fn parse_number(text: &str) -> Option<f64> {
    let text = text.trim();
    if text.is_empty() {
        return None;
    }

    // Vulgar fractions appear both alone ("½ cup") and glued to a whole
    // number ("1½ cups"), so peel them off the end first.
    let (lead, vulgar) = split_vulgar(text);
    if let Some(v) = vulgar {
        let whole = if lead.trim().is_empty() { 0.0 } else { lead.trim().parse::<f64>().ok()? };
        return Some(whole + v);
    }

    if let Some((whole, frac)) = text.split_once(' ') {
        if let (Ok(w), Some(f)) = (whole.trim().parse::<f64>(), parse_fraction(frac)) {
            return Some(w + f);
        }
    }
    if let Some(f) = parse_fraction(text) {
        return Some(f);
    }
    text.parse::<f64>().ok()
}

fn parse_fraction(text: &str) -> Option<f64> {
    let (n, d) = text.trim().split_once('/')?;
    let n: f64 = n.trim().parse().ok()?;
    let d: f64 = d.trim().parse().ok()?;
    if d == 0.0 { None } else { Some(n / d) }
}

fn split_vulgar(text: &str) -> (&str, Option<f64>) {
    const VULGAR: &[(char, f64)] = &[
        ('½', 0.5), ('⅓', 1.0 / 3.0), ('⅔', 2.0 / 3.0), ('¼', 0.25), ('¾', 0.75),
        ('⅕', 0.2), ('⅖', 0.4), ('⅗', 0.6), ('⅘', 0.8), ('⅙', 1.0 / 6.0),
        ('⅚', 5.0 / 6.0), ('⅛', 0.125), ('⅜', 0.375), ('⅝', 0.625), ('⅞', 0.875),
    ];
    for (ch, val) in VULGAR {
        if let Some(idx) = text.find(*ch) {
            return (&text[..idx], Some(*val));
        }
    }
    (text, None)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ParsedIngredient {
    pub amount: Option<f64>,
    pub unit: Option<String>,
    pub name: String,
    pub note: Option<String>,
}

/// Best-effort parse of one written ingredient line.
///
/// Anything it can't confidently split stays in `name`, so a bad parse
/// degrades to "the line as written" rather than losing information.
pub fn parse_ingredient_line(line: &str) -> ParsedIngredient {
    let line = line.trim();
    if line.is_empty() {
        return ParsedIngredient { amount: None, unit: None, name: String::new(), note: None };
    }

    // Parentheticals come out first, wherever they sit. Doing this before the
    // comma split matters: "oil (peanut, vegetable or canola)" would otherwise
    // break at the comma inside the brackets and leave the name as "oil (".
    let (without_parens, paren_notes) = extract_parentheticals(line);

    // Trailing preparation after a comma ("flour, sifted") is a note, not part
    // of the name. Only the first comma splits, so "salt, pepper, to taste"
    // keeps its tail together.
    let (head, comma_note) = match without_parens.split_once(',') {
        Some((h, n)) if !n.trim().is_empty() => (h.trim().to_string(), Some(n.trim().to_string())),
        _ => (without_parens.clone(), None),
    };
    let head = head.trim().to_string();

    let mut rest = head.as_str();
    let mut amount = None;

    // Ranges ("2-3 cloves") take the lower bound: under-buying is recoverable,
    // over-buying is waste, and the shopper can see the original line anyway.
    if let Some(cut) = leading_quantity_len(rest) {
        let (num_text, tail) = rest.split_at(cut);
        let num_text = num_text.split(['-', '–']).next().unwrap_or(num_text);
        amount = parse_number(num_text);
        rest = tail.trim_start();
    }

    // A unit only counts if something follows it; "2 eggs" means two eggs, not
    // two of a unit called "eggs" with no ingredient.
    let mut unit = None;
    if amount.is_some() {
        if let Some((first, tail)) = split_first_word(rest) {
            // Two-word units ("fl oz") get a look before single words.
            let two = split_first_word(tail)
                .map(|(second, t2)| (format!("{first} {second}"), t2));
            if let Some((pair, t2)) = two {
                if !t2.trim().is_empty() {
                    if let Some(u) = find_unit(&pair) {
                        unit = Some(u.canonical.to_string());
                        rest = t2.trim_start();
                    }
                }
            }
            if unit.is_none() && !tail.trim().is_empty() {
                if let Some(u) = find_unit(first) {
                    unit = Some(u.canonical.to_string());
                    rest = tail.trim_start();
                }
            }
        }
    }

    // Bracketed asides come first - they qualify the quantity ("14 oz"), while
    // a comma tail is usually preparation ("finely chopped"). Source lines are
    // messy enough to leave stray or doubled separators behind, so each part is
    // trimmed of them and empties dropped rather than joined into ", , ".
    let mut note_parts = paren_notes;
    if let Some(n) = comma_note {
        note_parts.push(n);
    }
    let note_parts: Vec<String> = note_parts
        .into_iter()
        .map(|p| p.trim().trim_matches(|c: char| c == ',' || c.is_whitespace()).to_string())
        .filter(|p| !p.is_empty())
        .collect();
    let note = if note_parts.is_empty() { None } else { Some(note_parts.join(", ")) };

    let name = rest
        .trim()
        .trim_start_matches("of ")
        .trim()
        .trim_matches(|c: char| c == '(' || c == ')' || c == '-')
        .trim()
        .to_string();
    let name = if name.is_empty() { head.clone() } else { name };

    ParsedIngredient { amount, unit, name, note }
}

/// Pulls every `(...)` group out of a line, returning the remainder and the
/// contents of each group. Unbalanced brackets are left alone rather than
/// swallowing the rest of the line.
fn extract_parentheticals(line: &str) -> (String, Vec<String>) {
    let mut out = String::with_capacity(line.len());
    let mut notes = Vec::new();
    let mut depth = 0usize;
    let mut current = String::new();

    for ch in line.chars() {
        match ch {
            '(' => {
                depth += 1;
                if depth == 1 {
                    current.clear();
                    continue;
                }
            }
            ')' if depth > 0 => {
                depth -= 1;
                if depth == 0 {
                    let t = current.trim();
                    if !t.is_empty() {
                        notes.push(t.to_string());
                    }
                    continue;
                }
            }
            _ => {}
        }
        if depth > 0 { current.push(ch) } else { out.push(ch) }
    }

    // An opening bracket that never closed: restore it so nothing is lost.
    if depth > 0 {
        out.push('(');
        out.push_str(&current);
    }

    (out.split_whitespace().collect::<Vec<_>>().join(" "), notes)
}

/// Byte length of the leading numeric run, if the line starts with one.
fn leading_quantity_len(s: &str) -> Option<usize> {
    let mut end = 0;
    let mut seen_digit = false;
    for (i, ch) in s.char_indices() {
        if ch.is_ascii_digit() {
            seen_digit = true;
            end = i + ch.len_utf8();
        } else if matches!(ch, '.' | '/' | '-' | '–') || split_vulgar(&ch.to_string()).1.is_some() {
            if !seen_digit && split_vulgar(&ch.to_string()).1.is_none() {
                return None;
            }
            seen_digit = true;
            end = i + ch.len_utf8();
        } else if ch == ' ' {
            // A space continues the run only for "2 1/2" style mixed numbers.
            let tail = &s[i + 1..];
            let next_is_fraction = tail
                .split_whitespace()
                .next()
                .map(|w| w.contains('/') || split_vulgar(w).1.is_some())
                .unwrap_or(false);
            if seen_digit && next_is_fraction {
                continue;
            }
            break;
        } else {
            break;
        }
    }
    if seen_digit { Some(end) } else { None }
}

fn split_first_word(s: &str) -> Option<(&str, &str)> {
    let s = s.trim_start();
    if s.is_empty() {
        return None;
    }
    match s.find(char::is_whitespace) {
        Some(i) => Some((&s[..i], &s[i..])),
        None => Some((s, "")),
    }
}

/// Trims float noise so totals read like a recipe: 2.5 not 2.4999999.
pub fn tidy_amount(v: f64) -> f64 {
    let r = (v * 1000.0).round() / 1000.0;
    if (r - r.round()).abs() < 0.005 { r.round() } else { r }
}

/// Renders an amount the way a shopping list would: "2", "1.5", "0.25".
pub fn format_amount(v: f64) -> String {
    let v = tidy_amount(v);
    if (v - v.round()).abs() < f64::EPSILON {
        format!("{}", v.round() as i64)
    } else {
        format!("{v}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(line: &str) -> ParsedIngredient {
        parse_ingredient_line(line)
    }

    #[test]
    fn plain_amount_unit_name() {
        let r = p("2 cups flour");
        assert_eq!(r.amount, Some(2.0));
        assert_eq!(r.unit.as_deref(), Some("cup"));
        assert_eq!(r.name, "flour");
    }

    #[test]
    fn mixed_number_and_note() {
        let r = p("2 1/2 cups all-purpose flour, sifted");
        assert_eq!(r.amount, Some(2.5));
        assert_eq!(r.unit.as_deref(), Some("cup"));
        assert_eq!(r.name, "all-purpose flour");
        assert_eq!(r.note.as_deref(), Some("sifted"));
    }

    #[test]
    fn vulgar_fractions() {
        assert_eq!(p("½ tsp salt").amount, Some(0.5));
        assert_eq!(p("1½ cups milk").amount, Some(1.5));
    }

    #[test]
    fn count_without_unit() {
        let r = p("3 eggs");
        assert_eq!(r.amount, Some(3.0));
        assert_eq!(r.unit, None, "eggs is the ingredient, not a unit");
        assert_eq!(r.name, "eggs");
    }

    #[test]
    fn range_takes_lower_bound() {
        assert_eq!(p("2-3 cloves garlic").amount, Some(2.0));
    }

    #[test]
    fn parenthetical_becomes_note() {
        let r = p("1 (14 oz) can diced tomatoes");
        assert_eq!(r.amount, Some(1.0));
        assert_eq!(r.unit.as_deref(), Some("can"));
        assert_eq!(r.name, "diced tomatoes");
        assert_eq!(r.note.as_deref(), Some("14 oz"));
    }

    #[test]
    fn commas_inside_brackets_do_not_split_the_name() {
        // Real line from an imported recipe: splitting on the bracketed comma
        // used to leave the name as "oil (".
        let r = p("2 tbsp oil (peanut, vegetable or canola)");
        assert_eq!(r.amount, Some(2.0));
        assert_eq!(r.unit.as_deref(), Some("tbsp"));
        assert_eq!(r.name, "oil");
        assert_eq!(r.note.as_deref(), Some("peanut, vegetable or canola"));
    }

    #[test]
    fn trailing_bracket_and_comma_notes_combine() {
        let r = p("150 g chicken breast (5oz), thinly sliced");
        assert_eq!(r.amount, Some(150.0));
        assert_eq!(r.unit.as_deref(), Some("g"));
        assert_eq!(r.name, "chicken breast");
        assert_eq!(r.note.as_deref(), Some("5oz, thinly sliced"));
    }

    #[test]
    fn unbalanced_bracket_keeps_the_text() {
        let r = p("2 cups flour (sifted");
        assert!(r.name.contains("flour"), "got {:?}", r.name);
    }

    #[test]
    fn stray_separators_do_not_survive_into_notes() {
        // Imported lines really do contain doubled and dangling commas.
        let r = p("150 g (5oz) chicken breast, , finely sliced");
        assert_eq!(r.name, "chicken breast");
        assert_eq!(r.note.as_deref(), Some("5oz, finely sliced"));

        let r2 = p("2 tbsp oil (, peanut or canola)");
        assert_eq!(r2.name, "oil");
        assert_eq!(r2.note.as_deref(), Some("peanut or canola"));
    }

    #[test]
    fn unquantified_line_survives_intact() {
        let r = p("Salt and pepper to taste");
        assert_eq!(r.amount, None);
        assert_eq!(r.unit, None);
        assert_eq!(r.name, "Salt and pepper to taste");
    }

    #[test]
    fn two_word_unit() {
        let r = p("8 fl oz heavy cream");
        assert_eq!(r.unit.as_deref(), Some("floz"));
        assert_eq!(r.name, "heavy cream");
    }

    #[test]
    fn of_is_dropped() {
        assert_eq!(p("2 cups of milk").name, "milk");
    }

    #[test]
    fn conversions_round_trip() {
        let grams = to_base(1.0, "kg").unwrap();
        assert_eq!(grams, 1000.0);
        assert!((from_base(grams, "lb").unwrap() - 2.204_62).abs() < 0.001);
    }

    #[test]
    fn dimensions_keep_incompatible_units_apart() {
        assert_eq!(unit_dimension("cup"), Some(Dimension::Volume));
        assert_eq!(unit_dimension("g"), Some(Dimension::Mass));
        assert_ne!(unit_dimension("clove"), unit_dimension("can"));
    }

    #[test]
    fn amounts_read_cleanly() {
        assert_eq!(format_amount(2.0), "2");
        assert_eq!(format_amount(1.5), "1.5");
        assert_eq!(format_amount(0.999_999), "1");
    }
}
