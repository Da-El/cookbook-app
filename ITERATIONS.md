# Iteration log

A running record of the 200-iteration improvement plan for this app. Iterations are
built and deployed in batches of ~5; each iteration touches its own focus area plus
the rating, voting, ranking, review, and editing systems that run through the whole
app. This file gets a new section after every batch ships to production.

For the full technical detail of any batch, see its commit on `master` — this file
is the readable summary; the commit message is the exhaustive one.

---

## Batch 1 — Iterations 1–5

**Commit:** `625fb27` · **Migrations:** 0005–0008 · **Tests:** 43 backend, passing

1. **Editing system** — soft-delete + full revision history for meals, revision
   voting (did this change make it better or worse?), author-only revert and
   restore. Fixed a live ingredient-name-parsing bug in the picker UI found during
   verification.
2. **Nutrition + serving scaling** — per-serving macros computed only from
   mass-unit, catalog-matched ingredient lines (honest partial coverage, never
   guessed), a servings stepper that scales quantities and batch totals, a rating
   distribution histogram with a median-vs-mean divergence note.
3. **Real search + community aliases** — Postgres full-text + trigram search
   (weighted title/description/steps, typo-tolerant) replacing substring
   matching; Bayesian-shrunk ranked score replacing raw-mean sort everywhere;
   community-proposed ingredient aliases, threshold-gated before affecting
   search or the recipe-import matcher.
4. **Account recovery + sessions** — password reset (single-use hashed tokens,
   rate-limited, no account enumeration), session list/revoke/revoke-others,
   reputation-weighted voting (capped 1–3x, weight never exposed to clients), a
   rating audit + unified vote history tab, public multi-author meal reviews
   with a stale-version flag, clickable edit/revision attribution.
5. **Loading/empty/error states, onboarding, accessibility** — a real first-run
   onboarding flow (diet prefs + suggested chefs), honest loading/error states
   instead of a blank screen on 404s and network failures, review helpfulness
   voting, a "top rated in cuisine" rank badge, aria-label/aria-pressed coverage
   on vote and rating controls.

**Bug found in verification:** a new ranking column was missing from the
meal-detail query, which would have 500'd every recipe page in production. Caught
by live-testing a real meal before shipping, not by the type checker or test
suite — `sqlx`'s dynamic queries aren't checked at compile time.

---

## Batch 2 — Iterations 6–10

**Commit:** `59cf779` · **Migrations:** 0009–0012 · **Tests:** 53 backend, passing

6. **Diet-aware personalization** — rule-based diet-flag heuristic for every
   catalog ingredient (vegetarian/vegan/pescatarian/gluten-free/dairy-free/
   nut-free), community-correctable through the existing edit-and-vote system.
   Meal-level diet tags computed as a strict intersection across matched
   ingredients — never vacuously "compatible with everything." Diet filter
   chips on Browse and a "from the guides" strip surfacing search hits.
7. **Educational guides deepening** — full-text search vector + helpfulness
   voting on guides, "try it in a recipe" related-meals surfaced by search
   match, and a full guide-edit propose-and-vote system mirroring how
   ingredient edits already work.
8. **Meal planner + grocery list polish** — swap a planned meal without losing
   its slot, a partial-update endpoint for plan entries, rating shown inline on
   the plan, the grocery list grouped into aisle sections instead of one flat
   list.
9. **Cook Mode polish + substitutions** — screen wake lock during cooking
   (re-acquired on visibility change), swipe-left/right step navigation, and a
   community ingredient-substitutes system ("no X? try Y," with an optional
   note and directional this-works/doesn't-work voting).
10. **Moderation tools** — a polymorphic `content_flags` table covering all six
    kinds of community content (meal revisions, reviews, ingredient edits,
    aliases, substitutes, guide edits). Any signed-in user can flag something
    for review; an admin-only queue (`/admin`, gated on a new `is_admin` flag)
    shows each flag hydrated with a live preview of the content. Resolving a
    flag as "removed" performs the right type-specific cleanup by reusing the
    same mechanisms real users already trigger — revert, withdraw,
    delete-and-recompute-winner — rather than a separate moderation-only code
    path. "⚑ Flag" entry points added to reviews, revision history, aliases,
    substitutes, ingredient edits, and guide edits.

**Verified:** every moderation removal path tested end-to-end against live data
(curl + real browser UI) before test-data cleanup, including the trickiest one —
a moderator removing a bad recipe revision correctly restores the prior version
and records who did it and why.

**Known gap found, not fixed this batch:** if a guide's only community edit gets
removed (by its author, or now by a moderator), the guide body doesn't fall back
to the original seed text — nothing currently preserves it. Filed as a follow-up;
needs a small schema/seed change to fix properly.

---

## Batch 3 — Iterations 11–15

**Commit:** `7ee37b8` (local only — not pushed/deployed this batch, per standing
instruction) · **Migrations:** 0013–0016 · **Tests:** 53 backend, passing

11. **Contributor recognition** — the reputation-weight tiers that have quietly
    decided how much a vote counts since Batch 1 are now a visible
    novice/trusted/veteran badge (never the raw weight or an activity count,
    just the tier), shown on chef profiles and every byline — reviews,
    revision history, ingredient edits. New "Top contributors" leaderboard
    ranked by the same three activity signals the weight itself is computed
    from.
12. **Recipe forking** — any user can fork a public recipe into their own
    fully-owned, independently editable copy, with "Adapted from X by Y"
    attribution back to the source. Distinct from the propose-and-vote edit
    system: a real fork, not a suggestion on someone else's recipe.
13. **Notifications** — the notifications table, bell icon, unread badge, and
    Activity tab all existed since the original build, but four of five
    reserved types were never actually triggered. Wired up
    meal_cooked/meal_saved/edit_won (the last deduped via a `notified_win`
    flag so re-voting an already-won edit doesn't spam its author), plus two
    new types for the moderation system: content_removed and flag_resolved.
14. **Discovery + advanced filtering** — a heuristic difficulty label
    (easy/medium/hard, derived from step count and time, nobody self-rates
    anything), time and difficulty filters on Browse, a "rising" sort that
    boosts recent meals for two weeks before they compete purely on
    ranked_score, real Open Graph tags (server-spliced into the SPA shell for
    meal/ingredient/guide pages, so a shared link actually previews that
    recipe) and a print stylesheet for the recipe page.
15. **Auth + settings hardening** — a pluggable email-sending abstraction
    (logs to stdout with no provider configured — the same real fallback
    password reset always had — but every caller starts actually delivering
    the moment a provider key exists, no code change needed). Password reset
    is the first caller. A new "Recent sign-in activity" section in Settings
    shows every login attempt, success and failure, against the account —
    separate from the live-sessions list.

**Verified:** every new endpoint tested end-to-end against live data (curl +
real browser UI, including a real OG-tag-injected page load and a genuine
failed-then-successful login pair) before test-data cleanup.
