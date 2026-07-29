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

---

## Batch 4 — Iterations 16–20

**Commit:** `1e4b243` (local only — not pushed/deployed this batch, per standing
instruction) · **Migrations:** 0017–0019 · **Tests:** 53 backend, passing

16. **Review discussion threads** — an inline reply list under every review
    (expand/collapse form, author-only delete), notifying the review's author
    when someone replies. A genuine hard-delete, unlike everything else in this
    app — a reply reads as closer to a chat message than catalog content, so it
    doesn't need a revision trail.
17. **Meal collections** — private, user-owned folders for organizing saved
    recipes, separate from the single flat "saved" list. An `AddToCollection`
    bottom-sheet picker on every meal page (with an inline "+ New collection"
    that auto-adds the current meal), and a detail page reusing the same
    `MealCard`/`MealGrid` components the rest of the app already uses.
    Ownership is checked on every route — verified directly that another
    user's request gets a 404, not a peek at someone else's collection.
18. **Two-factor authentication** — an optional per-account email code
    (10-minute expiry, 5-attempt cap, then the challenge is discarded and
    treated as expired rather than "wrong code," to force a fresh login).
    `login()` now returns either a normal profile or a `{two_factor_required,
    challenge}` payload with no session cookie set until the code is
    verified. A new durable sign-in log (separate from the existing
    rate-limiting table, which clears on success) backs a "Recent sign-in
    activity" section in Settings next to the 2FA toggle.
19. **Ingredient comparison tool** — put up to three ingredients side by
    side, with a shareable `?ids=` URL, full nutrition/micro/diet-flag rows,
    and per-row highlighting of the best value (aware that "best" flips
    direction — lower is better for calories/carbs/fat/sugar/sodium, higher
    for protein/fiber/rating).
20. **Accessibility + motion polish** — a reusable Escape-to-close hook wired
    into every modal and sheet built this session (collection picker, plan
    picker, account menu), a site-wide keyboard-only focus ring (`box-shadow`
    so it isn't clipped by `overflow:hidden` containers and follows each
    element's own border-radius instead of overriding it), a global
    `prefers-reduced-motion` override, and a skip-to-content link on every
    page.

**Verified:** review replies, collections, and ingredient comparison tested
end-to-end via curl and real browser UI (including the cross-user 404
authorization boundary on collections). Two-factor auth tested via curl
through the full challenge/verify/wrong-code/replay-rejection/max-attempts
lockout sequence, then again through a real browser login. Accessibility
work verified where the tooling allows it — Escape-to-close confirmed live
on all three modals by dispatching real keydown events, and the
`:focus-visible`/`prefers-reduced-motion` rules confirmed present and
correctly parsed in the loaded stylesheet — but the automated browser pane
in this environment reports `document.hasFocus() === false`, so the actual
keyboard-driven focus ring couldn't be observed rendering; the CSS was
instead hand-verified against the same clipping/border-radius pitfalls
called out in Batch 1's onboarding a11y work.

---

## Batch 5 — Iterations 21–25

**Commit:** `11cb35d` (local only — not pushed/deployed this batch, per standing
instruction) · **Migrations:** 0020–0022 · **Tests:** 55 backend, passing

21. **Review quality + sorting** — reviews turned out to already be
    cook-gated by construction (the only insert path runs inside `cook()`),
    so this iteration built what was actually missing: sort options
    (helpful/recent/highest/lowest) and author-only review editing with an
    "(edited)" indicator. Caught a real bug while building it — a note-only
    edit was about to null out the review's existing score by always
    binding the edit's `Option<i16>` regardless of whether a new score was
    sent — fixed before it shipped.
22. **Notification preferences** — every notification type has landed in
    the bell/Activity tab since the original build, but none had ever sent
    email. A new opt-in `notification_email_prefs` table plus a shared
    `notify.rs` module wires real email delivery into all seven types
    across five files. `apply_winner()` in ingredients.rs/guides.rs now
    returns who just won an edit vote instead of emailing from inside a
    bare transaction, so the caller sends it only once the win is actually
    committed.
23. **Dark mode** — a real second theme via CSS custom properties,
    `prefers-color-scheme` plus a persisted Settings toggle (Light/Dark/
    System), with a flash-prevention inline script. Caught and fixed a
    genuine cross-cutting bug along the way: ~20 "filled dark pill"
    components (active chips, primary buttons, toasts) styled
    `background: var(--ink); color: #fff`, which goes white-on-white the
    moment dark mode inverts `--ink` — fixed with a new fixed
    `--ink-solid`/`--on-ink-solid` pair. Also caught the Cookbook hero card
    rendering literal dark-ink text over a literal light gradient
    regardless of theme. Verified with an automated contrast-ratio sweep
    across 7 pages, not just eyeballing it.
24. **Command palette (Cmd/Ctrl+K)** — an app-wide search-and-navigate
    overlay that reuses the existing ranked `/search` endpoint rather than
    building a second search implementation, with quick actions when
    empty and arrow-key/Enter navigation through live results.
25. **Measurement units + shopping list export** — a per-account
    `unit_system` preference (as written/metric/imperial) that the grocery
    list's existing unit-summing logic now honors via a magnitude-based
    `preferred_unit()` chooser, overriding the prior "whichever unit
    recipes used most" heuristic only when a system is explicitly set.
    Plus a "Share list" button (Web Share on mobile, clipboard elsewhere)
    producing a plain-text, aisle-grouped copy of the list.

**Verified:** all five iterations tested end-to-end against live data —
review sort/edit and the note-preserves-score fix via curl and real
browser UI; all seven notification-email paths confirmed actually firing
(and correctly suppressed when not opted in) by checking the log-only
email fallback; dark mode's automated contrast sweep across 7 pages in
both themes; the command palette's keyboard shortcut, live search, and
Enter-to-navigate through a real browser session; and unit conversion
confirmed at the API level for both metric and imperial before checking
the same numbers rendered correctly in the Plan page and its exported text.

---

## Batch 6 — Iterations 26–30

**Commit:** `c63ad2d` (local only — not pushed/deployed this batch, per standing
instruction) · **Migrations:** 0023–0026 · **Tests:** 55 backend, passing

26. **Ingredient reviews** — ingredients have had `rating`/`rating_count`
    columns since the original schema, and `upsert_rating()` already
    branched on `subject_type='ingredient'`, but nothing had ever called
    it — there was no way to rate an ingredient at all, anywhere in the
    app. Adds the missing action (a score, an optional note, one row per
    user per ingredient) plus helpfulness voting, mirroring meal reviews.
    Caught and fixed the exact same note-only-edit-nulls-the-score bug
    from Iteration 21, this time in ingredients.rs, before it shipped.
27. **Guide discussion comments** — guides have had propose-and-vote
    editing for the guide's own body since Batch 2, but no way for a
    reader to just say something about it. A flat, one-level comment
    list, author-only hard delete — the same "closer to a chat message
    than catalog content" reasoning review_replies already used.
28. **Nutrition goals + daily tracking** — optional daily calorie/protein/
    carbs/fat targets in Settings, plus a "Today" card on the feed once
    any goal is set (or a meal's been logged). Required genuinely new
    plumbing, not just a UI on existing data: neither `cooked_meals`
    (upserted once, no repeat timestamp) nor `reviews` (only written with
    a note or score) could answer "what did I eat today," so `cook()` now
    also writes a plain append-only `meal_log` entry every time.
29. **Data export** — a GDPR/CCPA-style "download my data," bundling a
    user's own profile, published meals, meal and ingredient reviews,
    collections, and saved/cooked lists into one downloadable JSON file
    from Settings.
30. **Occasion tags for meals** ("quick weeknight," "meal prep," "date
    night," ...) — crowd-voted rather than propose-and-pick-a-winner like
    ingredient_edits/guide_edits, since an occasion is a judgment call
    about the dish with no single "right" answer to converge on. A tag
    counts as applied — and becomes filterable on Browse — once 2+ people
    vote for it, the same "don't let one vote decide it" instinct behind
    reputation-weighted voting elsewhere in the app.

**Verified:** ingredient rating/review end-to-end via curl and real
browser UI, including confirming the meal-review score-preservation fix
generalizes correctly to the new code path; guide comments' full
post/list/delete cycle plus the cross-user delete-authorization boundary;
nutrition goals confirmed at the API level with a purpose-built test meal
(200g of a known ingredient → exact expected calorie/macro totals), then
the same numbers checked rendering correctly in both Settings and the
Home feed, including the goal-cleared fallback; data export's JSON
structure verified via curl and the actual browser download trigger
(blob + filename) confirmed firing; occasion tags' vote-threshold
behavior (1 vote = not applied, 2 = applied) confirmed at the API level
for both the meal page and the Browse filter, then spot-checked through
the real UI.

---

## Batch 7 — Iterations 31–35

**Commit:** local only — not pushed/deployed this batch, per standing
instruction · **Migrations:** 0027–0028 · **Tests:** 61 backend, passing

31. **Public collections** — `meal_collections` gained an `is_public` flag
    and an owner-only visibility toggle plus a "copy link" action. Any
    signed-in user can now open a public collection (`detail()` switched
    from requiring `CurrentUser` to accepting `viewer: Option<CurrentUser>`);
    a private collection still 404s for everyone but its owner. The
    detail view is read-only for non-owners — no remove button, no
    visibility control — gated on a new `is_mine` field in the response.
32. **Revision diff view** — meal edit history (`MealHistory.tsx`, from
    Iteration 1's revision system) gained a per-row "View changes" toggle
    that renders a structured, field-by-field diff instead of just a
    timestamp and author. The tricky part was pairing: each revision's
    `snapshot` captures the meal's state *before* that revision's own
    edit, so the edit that produced `revisions[i]` is the diff between
    `revisions[i].snapshot` and `revisions[i-1].snapshot` — or the current
    live meal for the newest row, which has no newer revision to supply
    an "after" state. Traced through a concrete 3-revision example before
    writing any code, having first drafted the pairing backwards.
33. **Rate limiting** — a generic per-user, per-action limiter
    (`rate_limit_events` table + `ratelimit::check()`) applied to four
    previously-unbounded write endpoints: content flags (20/hour), review
    replies and guide comments (20/10min each), and ingredient reviews
    (30/10min). A rejected request isn't itself recorded, so a blocked
    burst can't extend its own lockout. Found and fixed a real pre-existing
    gap as a byproduct: `IngredientDetail.tsx`'s review form and
    `Guides.tsx`'s comment form had no error handling at all, so a 429 (or
    any failure) would fail completely silently — both now toast the error.
34. **"Surprise me" + featured pick** — a `GET /meals/random` endpoint
    (`ORDER BY random() LIMIT 1` over live public meals, with optional
    `exclude` and `min_rating_count` params) backs two new spots: a "🎲
    Surprise me" button on Browse that jumps straight to a random recipe,
    and a "✨ Featured" card on the Home feed showing a random *rated*
    pick (`min_rating_count=1`, so an unproven, unrated recipe never gets
    the editorial-sounding "Featured" label). The card renders nothing at
    all once the catalog has no rated meals yet, rather than a
    broken-feeling empty state.
35. **Cooking streak** — a "consecutive days cooked" tracker on the
    Cookbook page, built on the `meal_log` table from Iteration 28. The
    streak math (`compute_streak()` in `kitchen.rs`) is a small pure
    function over a list of calendar days, unit-tested directly rather
    than only through the database: a day missed *today* doesn't zero the
    streak until tomorrow arrives with still nothing logged, so a
    yesterday-ending run still shows as alive. Longest streak is tracked
    separately from current, so a broken streak still shows what the
    user's best was rather than just resetting to zero and forgetting.

**Verified:** public collections' full authorization matrix (private
404s for a non-owner, a non-owner can't toggle visibility, the owner can,
and a public collection is viewable by a second signed-in user with
correct `is_mine`/`owner_name`); the revision diff view's two pairing
cases against a real 3-revision chain on a test meal, both the
"vs current" and "vs an older revision" paths; rate limiting's exact
threshold boundary via 21 sequential requests confirming the 20th
succeeds and the 21st 429s, the error surfacing via toast in a real
browser session, and a different action key staying unaffected; `/meals/
random`'s `exclude` and `min_rating_count` filters against a purpose-made
second test meal (both were untestable against the single-meal seed data
alone), plus the "Surprise me" button and "Featured" card in both desktop
and mobile layouts through a real browser session; and the cooking
streak's three real states — an active streak, a streak broken by a
gap (current resets, longest is preserved), and no history at all (card
renders nothing) — each driven by real `meal_log` rows through curl, then
the active and broken states re-confirmed visually in the browser in
both light and dark mode.

---

## Batch 8 — Iterations 36–40

**Commit:** local only — not pushed/deployed this batch, per standing
instruction · **Migrations:** 0029–0030 · **Tests:** 61 backend, passing

36. **Followers/following lists** — the chef profile's follower/following
    counts were always displayed but never browsable. New `GET /chefs/{id}
    /followers` and `/following` endpoints (viewer-relative `is_following`
    per row, reusing the existing `ChefCard` shape) back a new
    `ChefConnections` page, reusing the `ChefRow`/`ChefList` components
    Browse's Chefs tab already had. The one real wrinkle: the signed-in
    viewer can legitimately appear as a row in someone else's list, and a
    "Follow" button on your own row would just 400 on click - `ChefRow`
    gained an `isViewer` flag that swaps the button for a plain "You" tag.
37. **Block a user** — trust-and-safety gap: reviews, ratings, follows, and
    moderation flags all existed, but no way to just stop seeing someone.
    A `blocked_users` table + `toggle_block()` (mirroring `toggle_follow`)
    severs any existing follow in *either* direction the moment a block is
    made, and blocks re-following in either direction afterward. Blocked
    authors' meals are filtered out of Browse and chef search/suggestions
    for the blocker; `ChefPage` shows a reduced "blocked" state (no follow
    button, no content tabs) instead of a normal profile; Settings gained
    a "Blocked accounts" list with per-row unblock. Deliberately scoped to
    discovery surfaces only, not a full content firewall - a blocked
    user's existing reviews on a meal you navigate to directly still show,
    same as most apps' block semantics.
38. **Multiple photos per meal** — `meals.photo_url` remains the cover
    shown everywhere a thumbnail appears (MealCard, Browse, feed, chef
    pages), left untouched so none of those query sites needed to change.
    A new `meal_photos` table holds purely additive gallery photos, shown
    only on the meal's own detail page; `create`/`update` handle them with
    the same delete-then-reinsert wholesale-replace pattern the ingredient
    list already used, and `fork` copies the gallery alongside everything
    else it duplicates.
39. **Draft autosave for meal creation** — a `localStorage`-backed draft
    of the New Meal form, so a closed tab or a crashed browser doesn't
    lose an in-progress recipe. Only saves once the form actually has
    content (name, description, a step, an ingredient, or a photo) - a
    fresh, untouched visit never nags with a "resume draft?" prompt.
    Cleared on successful publish or explicit discard.
40. **Search history** — recent search terms persisted client-side
    (`localStorage`, capped at 8, most-recent-first, case-insensitive
    de-duped) and surfaced in two places: the Cmd/Ctrl+K command palette's
    empty state (above Quick Actions, with per-term remove and a Clear
    action, arrow-key navigable like every other palette row) and Browse's
    mobile search bar (a chip row shown once the search box is empty).
    Recorded on a genuine commit signal (selecting a palette result,
    pressing Enter, or blurring Browse's search field) rather than on
    every keystroke, so typing "chicken" doesn't leave "c", "ch", "chi"
    behind as separate history entries.

**Verified:** followers/following lists confirmed correct for both
directions of a real 3-user follow graph, including the self-appears-in-
someone-elses-list edge case rendering "You" instead of a broken follow
button; blocking's full effect chain via curl - an existing mutual follow
severed, re-follow rejected with 403 in both directions, a blocked
author's meal disappearing from Browse for the blocker and reappearing
for an unrelated third user, then reappearing for the blocker too after
unblocking - plus the ChefPage blocked-state banner and Settings' blocked-
accounts list (with working unblock) confirmed in a real browser session;
multi-photo create/update/fork all confirmed via curl against a real
multi-photo meal (wholesale replace on update, correct copy on fork),
then the gallery strip on the meal page and the add/remove UI on the
edit form confirmed in the browser, including a removed photo actually
persisting after save; draft autosave's full cycle - typing content,
navigating away, returning to see the resume prompt, resuming to recover
the exact typed content, discarding to clear it, and publishing clearing
it automatically - all confirmed in a real browser session; and search
history's recording-on-commit-not-on-keystroke behavior, per-term
removal, and the "Clear all" action confirmed in both the command
palette and Browse's mobile search, including that selecting a recent
term actually re-runs the search rather than just closing the panel.

---

## Batch 9 — Iterations 41–45

**Commit:** local only — not pushed/deployed this batch, per standing
instruction · **Migrations:** 0031–0034 · **Tests:** 61 backend, passing

41. **Guide ratings** — guides had a helpful-vote toggle but no numeric
    score. Extended the shared `ratings` table (`subject_type` CHECK) and
    `upsert_rating()` with a `"guide"` branch, deliberately *not* wired
    into any ranking recompute - guides are curator-ordered by topic and
    reading sequence, never re-sorted by score (see guides.rs's own doc
    comment), so a guide's rating is a trust signal next to the helpful
    count, not a sort key the way it is for meals/ingredients.
42. **Report a user profile** — flags existed for six kinds of community
    content but not for an account itself, as a report distinct from
    blocking. Added `"user_profile"` as a seventh flaggable type reusing
    the existing `FlagButton` (now takes optional `label`/`placeholder`
    props) and the same admin queue, with "Remove" specifically disabled
    for profile reports (an account isn't something this flow deletes -
    that needs a human, not an automated action) while "Dismiss" works
    as normal.
43. **Follow a public collection** — collections gained `is_public` in
    Iteration 31 with a "a follow mechanism is a natural follow-up, not
    folded in here" note in its own migration; this is that follow-up. A
    `collection_follows` table, a "Following" section on the Collections
    page, and a notification (`collection_meal_added`) to every follower
    when the owner adds a new meal to a public collection they follow.
    Caught and fixed a real bug during verification: the notification
    INSERT had three `$` placeholders but only two `.bind()` calls, so
    every notification silently failed via the `.ok()` error-swallow -
    traced with a temporary debug trace, confirmed by testing the exact
    SQL by hand, then fixed and re-verified end to end.
44. **Shareable meal plans** — a `vis_plan` visibility setting (private by
    default, unlike the other `vis_*` columns which default public - a
    weekly cooking schedule is a different kind of exposure than "what
    I've made"), a `GET /chefs/{id}/plan` endpoint reusing the existing
    `can_view()` privacy gate, and a fourth "Plan" tab on the chef profile
    page showing their public plan for the current week.
45. **Recently viewed** — client-side history (`localStorage`, capped at
    12, de-duped and moved-to-front on a repeat visit) recorded on every
    meal and ingredient detail-page visit, surfaced as a small thumbnail
    rail on the Home feed. Renders nothing until there's real history,
    the same graceful-absence pattern `FeaturedMeal`/`TodayNutrition`
    already established.

**Verified:** guide rating's full cycle via curl (rate, average/count
update, `your_rating` on repeat visits, out-of-range rejection) then the
1–10 widget and list-page average confirmed in the browser, plus cleaned
up two pieces of stale test data left over from an earlier session found
along the way (orphaned guide comments, an unresolved test flag);
reporting a profile's self-report guard, duplicate-report guard, and the
full flag-to-admin-queue-to-dismiss cycle via curl, then the report form
and the disabled "Remove" button (with its explanatory tooltip) confirmed
in the browser; collection following's real bug caught mid-verification
and fixed (see above), then the complete corrected flow re-verified -
follow/self-follow-rejection, follower count, the notification firing
exactly once per genuine new addition and not on a re-add or after an
unfollow - via curl, and the "Following" section and notification
click-through confirmed in the browser; shareable plans' private-by-
default and public-after-toggle visibility confirmed via curl (including
that the owner always sees their own plan regardless of the setting),
then the Plan tab and the Settings toggle confirmed in the browser; and
recently-viewed's recording, ordering, and de-duplication-on-revisit
confirmed in the browser across both a meal and an ingredient page.

---

## Batch 10 — Iterations 46–50

**Commit:** local only — not pushed/deployed this batch, per standing
instruction · **Migrations:** 0035–0036 · **Tests:** 61 backend, passing

46. **Pantry staples** — fridge items gained an `is_staple` flag (salt,
    oil, flour - things always on hand that shouldn't clutter a grocery
    list) with a star toggle on the fridge tab. `grocery_list()`'s
    accumulation loop skips staple rows entirely rather than just
    de-emphasizing them, so a planned recipe calling for olive oil
    doesn't add "olive oil" to the shopping list just because it's a
    planner ingredient - the shopping list stays a list of things to
    actually buy.
47. **Cook-count badge** — `cooked_meals` already recorded who cooked
    what, but nothing surfaced *how many* people had. A shared
    `meal_cook_count_sql!` macro fragment (matching the existing
    `is_top_in_cuisine_sql!`/`meal_diet_tags_sql!` pattern) spliced into
    all four `MealCard`-shaped query sites adds a `🍳 N` chip next to a
    meal's rating everywhere a card renders, plus the same count on the
    meal detail page's meta line.
48. **Duplicate your own recipe** — forking already covered "start from
    someone else's recipe," but an author had no quick way to spin off a
    variant of their *own* meal (a spicier version, a halved-batch
    version) without hand-retyping it. `duplicate()` is fork's mirror
    image: author-only instead of anyone-but-the-author, no
    `forked_from_*` attribution since it's not a fork, ` (copy)` name
    suffix, always `visibility: 'personal'` regardless of the
    original's, and lands straight on the new copy's edit form instead
    of its detail page since the point is to change something right
    away.
49. **Ingredient health highlights** — the micronutrient bars already
    showed raw values, but reading "42.6 mg" against nothing requires
    already knowing the FDA %DV table. A pure `nutritionHighlights()`
    function applies the same excellent-source (≥20% DV) / good-source
    (10–19% DV) convention labels use, as colored chips above the macro
    grid; sodium is the one exception, framed as "High in sodium" rather
    than a positive highlight since a high %DV there is a caution, not a
    selling point.
50. **Nested review replies** — review replies were one level deep
    (reply to a review, never to a reply). Added a self-referencing
    `parent_reply_id` on `review_replies` (`ON DELETE CASCADE`, so
    deleting a reply quietly takes its sub-thread with it - no orphaned
    replies-to-a-reply-that-no-longer-exists) and rebuilt the frontend
    component around a client-built tree instead of a flat list, with a
    "Replying to {name}" pill once you're threading under a specific
    reply rather than the review itself. Notifications now go to
    whoever the reply is actually addressed to - the parent reply's
    author when nested, the review's author when not - rather than
    always the review's author regardless of who's actually being
    replied to.

**Verified:** pantry staples' full cycle via curl - a staple ingredient
present in a planned recipe correctly excluded from the grocery list
while a non-staple with the same planner entry still appears - then the
star toggle and its "· Staple" subtitle confirmed in the browser;
cook-count confirmed correct at all four `MealCard` construction sites
via curl against a meal cooked by a known number of users, then the
`🍳 N` chip confirmed on both a Browse card and the meal detail page;
duplication's authorization boundary (403 for a non-author) and content
correctness (name suffix, `personal` visibility, no fork attribution)
confirmed via curl, then the browser flow of duplicating landing
directly on the pre-filled edit form confirmed end to end; health
highlights' tier thresholds confirmed against real seeded ingredients
spanning all three tiers in one page load (Anchovies: good-source
calcium and iron, excellent-source magnesium, and the sodium caution,
all four chips correct against their actual %DV) plus a clean excellent-
and-good-only case (Arugula) and a single-chip case (avocado), all
confirmed in the browser with computed chip colors matching their tier;
and nested replies' full chain via curl - a top-level reply, a reply
threaded under it, the cross-review parent-injection guard rejecting a
parent from a different review with 400, notification recipients
resolving correctly for both the top-level and nested case, and
`ON DELETE CASCADE` removing a child reply when its parent is deleted -
then the threaded UI (indentation, the "Replying to" pill, inline reply
triggers at every depth, and delete) confirmed in a real two-user
browser session.

---

## Batch 11 — Iterations 51–55

**Commit:** local only — not pushed/deployed this batch, per standing
instruction · **Migrations:** 0037–0040 · **Tests:** 61 backend, passing

51. **2FA recovery codes** — email-code 2FA had no fallback if the inbox
    behind it became unreachable. Enabling 2FA now mints ten one-time
    recovery codes (`ABCDE-FGHIJ` format, ambiguous characters like
    0/O and 1/I excluded), shown exactly once in a dismiss-only sheet;
    `verify_two_factor` accepts one in place of the emailed code,
    consuming it and resolving the notification recipient the same way
    a correct code would. A "Regenerate" action in Settings discards
    the old batch and mints a fresh one; disabling 2FA discards
    whatever's left.
52. **Guide bookmarking** — guides had no save-for-later the way meals
    do. A `saved_guides` table plus a `toggle_save` mirroring
    `meals::toggle_save`'s shape, a bookmark icon on the guide page,
    and a "Saved (N)" filter chip on the guides list that only appears
    once there's something to filter to.
53. **Review photos** — a `photo_url` column on `reviews`, wired into
    the same cook-with-a-note flow the "Nice — how'd it go?" prompt
    already had, plus the review edit form. Unlike `score`'s
    don't-touch-unless-included handling, `photo_url` always replaces
    on edit - the edit form shows and resubmits the review's current
    photo (or lack of one) every time, so there's no "wasn't part of
    this edit" case to protect.
54. **Meal plan entry reordering** — multiple entries can already share
    a day and slot (two snacks), but their order was just insertion
    order with no way to change it. A `position` column plus a
    `POST /plan/{id}/move` endpoint that swaps position with the
    adjacent sibling in the same day+slot group; a no-op (still 204)
    at either edge so the frontend's up/down buttons don't need to
    precompute whether a move is legal, just disable at the edges.
55. **Saved filter presets** — Browse's meal filters (type, diet, sort,
    difficulty, time, occasion) had no way to name and reapply a
    combination. `localStorage`-backed, mirroring iteration 40's recent-
    searches lib exactly (capped at 10, most-recent-first); "Save this
    search" only appears once at least one filter is non-default, so
    there's nothing to name at the default "everything" view.

**Verified:** recovery codes' full lifecycle via curl - a code
consuming correctly on login, a used code rejected on reuse, an
unused-but-since-regenerated code rejected, regeneration blocked while
2FA is off, and codes actually gone from the table after disabling -
then the enable-time reveal sheet, the Settings "Regenerate" action,
and a full password-then-recovery-code sign-in confirmed in the
browser; guide bookmarking's toggle cycle and unauthenticated-request
rejection via curl, then the save/unsave button and the list page's
"Saved (N)" filter (including its count updating live) confirmed in
the browser; review photos' storage, retrieval, and edit-time swap/
clear all confirmed via curl against a real review, then the photo
attach flow, the edit form correctly seeding the existing photo, and
removal persisting after a reload all confirmed in the browser; plan
entry reordering's swap-with-neighbor, both-edges-are-safe-no-ops,
cross-user rejection (404), and invalid-direction rejection (400) all
confirmed via curl against three real snack entries, then the ▲/▼
buttons - including their disabled state at each edge of the group -
confirmed in the browser; and saved filter presets' save/apply/delete
cycle, including that applying a preset actually restores every
filter's value and that the "Save this search" control only appears
once a filter is non-default, confirmed in the browser with direct
`localStorage` inspection alongside the UI.

---

## Batch 12 — Iterations 56–60

**Commit:** local only — not pushed/deployed this batch, per standing
instruction · **Migrations:** none (56, 59, 60) / 0041–0042 (57–58) ·
**Tests:** 61 backend, passing

56. **Un-rate meals and guides** — `rate()` on both meals and guides
    could only ever change a rating's value, never withdraw it. A new
    `remove_rating()` helper mirrors `upsert_rating()`'s cache-recompute
    logic (both now delegate to a shared `recompute_rating_cache()`)
    but deletes the row instead of writing one; a "Remove" link next to
    the "You: N/10" pill calls it via `DELETE /meals/{id}/rate` and
    `DELETE /guides/{slug}/rate`.
57. **Reorder meals within a collection** — collections had an implicit,
    unchangeable insertion order. Same `position` + swap-with-neighbor
    pattern as iteration 54's meal-plan reordering, applied to
    `meal_collection_items`; ▲/▼ buttons overlay each card's top-left
    corner (the existing × remove button already owns top-right).
58. **Guide progress tracking** — deliberately distinct from iteration
    52's bookmarking: saving is "come back to this," a new
    `guide_progress` table is "I've actually read this." A "Mark as
    read" toggle on the guide page, an "N of M read" count per topic on
    the list page computed client-side from the same `is_completed`
    flag bookmarking's `is_saved` already established the pattern for.
59. **Password strength meter** — signup and the account password-
    change form enforced `minLength=8` server-side but gave no feedback
    beyond a rejected submission. A length-and-character-variety
    heuristic (not real entropy estimation - no dictionary attack
    modeling, just enough to nudge away from "password1") scores 0-4,
    rendered as a 4-segment bar plus a text label; a short common-
    password list clamps straight to "Very weak" regardless of what the
    heuristic alone would say.
60. **Bulk shopping list actions** — clearing a shopping list after a
    real trip meant removing rows one at a time. A single
    `DELETE /shopping/clear` (scoped to the caller, a no-op on an
    already-empty list) backs a "Clear list" button that arms a confirm
    card before executing - the same "explicit second step for a bulk-
    destructive action" pattern Settings' "log out of all other
    sessions" already uses.

**Verified:** un-rating's full cycle via curl for both meals and guides
- rating cache correctly recomputing to 0/0 and `your_rating` returning
to null, a second un-rate correctly 404ing - then the "Remove"
affordance confirmed in the browser on both pages;
collection reordering's swap, both-edges-no-op, and cross-user 404 all
confirmed via curl against three real meals in a real collection, then
the ▲/▼ overlay buttons (including disabled state at the edges)
confirmed in the browser; guide progress's independent per-guide
toggle state confirmed via curl across two guides sharing a topic, then
the "N of M read" topic count, the card checkmark, and the "Mark as
read" ↔ "✓ Read" button confirmed in the browser; the password
strength meter's tiering confirmed directly against known inputs (a
blocklisted password forced to "Very weak" despite passing the length
check, a repetitive-but-long password landing at "Weak," a long
high-variety password reaching "Strong") on both the signup form and
the Settings password field, plus the meter correctly not rendering at
all against an empty field; and bulk shopping clear's per-user scoping
(clearing one account's list via curl left an unrelated account's item
untouched) and the empty-list no-op confirmed via curl, then the arm-
then-confirm card and the list actually emptying confirmed in the
browser.

## Batch 13 — Iterations 61–65

**Commit:** local only — not pushed/deployed this batch, per standing
instruction · **Migrations:** 0043–0044 (61, 63) / none (62, 64, 65) ·
**Tests:** 61 backend, passing

61. **Collection cover photo** — collections had no visual identity beyond
    a name. A new `cover_photo_url` column plus an owner-only
    `POST /collections/{id}/cover` (`photo_url: Option<String>`, omitted or
    null clears it) surfaced on both `CollectionRow` and `CollectionDetail`
    and on `FollowedCollectionRow` for followers too; the existing
    `pickImage` helper backs a "+ Add cover photo"/"Change cover" affordance
    on the detail page, and a `CollectionThumb` component (image or a
    `FolderIcon` placeholder) renders it in both the owned- and
    followed-collections list rows.
62. **Guide share button** — guides had a bookmark toggle but no quick way
    to hand one to someone else. A Share button next to the bookmark icon
    copies the current page URL via `navigator.clipboard.writeText` and
    confirms with the existing toast pattern - no backend change, purely a
    frontend addition alongside iteration 52's bookmarking.
63. **Meal plan templates** — a full week of planning had to be rebuilt
    from scratch every time. New `plan_templates`/`plan_template_entries`
    tables store a template's entries by `day_offset` (0-6) relative to its
    own reference week rather than real dates, so one saved template can be
    applied starting on any future week; `apply_template` joins
    `meals WHERE status='live'` so a since-deleted meal is silently skipped
    rather than failing the whole apply. Save/list/delete/apply endpoints
    plus a template chip row on the Plan page's week view.
64. **Substitute top-pick badge** — a substitute list already sorted by
    community vote score with no visual signal for which one actually won.
    Purely frontend: since `substitutes.rs`'s `list()` already orders by
    `score DESC`, `SubstituteSection.tsx` marks the first row a "★ Top
    pick" whenever there's more than one substitute and the leader has an
    actual positive score - never crowning a winner off a single default
    self-vote with nothing to beat.
65. **Trending-this-week Discover shelf** — the existing Discover shelves
    (best rated, fastest, just added) are all-time or static; nothing
    surfaced what people are actually cooking *right now*. A new
    "Trending this week" shelf queries `meal_log` (one row per cook event,
    including repeats - unlike `cooked_meals`, which only records the
    first) for cook counts in the trailing 7 days, ordered by that count
    with `ranked_score` as tiebreaker, reusing the `discover()` handler's
    existing `shelf_sql!` macro and `MealCard` projection. The shelf is
    simply omitted when nothing's been cooked in the window, same as every
    other shelf's empty-state handling.

**Verified:** collection cover set/clear/cross-user-404 and its
appearance on `list_followed` all confirmed via curl, then the list
thumbnail and detail-page banner with "Change cover" confirmed in the
browser; the guide share button's clipboard write and "Link copied"
toast confirmed in the browser (via an explicit `Promise`/`setTimeout`
wrapper - React's batched state update from a click handler isn't
observable in the same synchronous script); meal plan templates' save,
list, apply-with-correct-day-offset-math (checked against real dates),
empty-week rejection, >7-day-range rejection, soft-deleted-meal skip on
re-apply (count dropped 2→1 after soft-deleting one template meal), and
cross-user 404 on both apply and delete all confirmed via curl, then
save-as-template, the template chip applying to the right day/slot, and
delete (with `window.confirm` monkey-patched to bypass the native
dialog) confirmed in the browser; the top-pick badge's ordering
confirmed via curl (a second account's upvote moved "Butter, stick,
unsalted" to score 2, ahead of "Almond butter, creamy" at score 1) then
the badge rendering on exactly the leading row confirmed in the browser;
and the trending shelf confirmed via curl in both directions - logging a
cook event surfaced the shelf with the correct `cook_count`, and
backdating that same `meal_log` row past 7 days made the shelf
disappear entirely - then "Trending this week" rendering as the first
shelf on the Discover page confirmed in the browser.

## Batch 14 — Iterations 66–68

**Commit:** local only, not pushed · **Migrations:** 0045 (66) / 0046 (67)
/ none (68) · **Tests:** 61 backend, passing

66. **Collection discussion comments** — a flat, one-level comment thread
    on public meal collections, mirroring guide_comments' pattern exactly
    (same hard-delete-for-author, `user_id` `SET NULL` on account
    deletion). Gated on `is_public` the same way `detail()` already is,
    so a private collection's comments stay just as private as its meal
    list - the owner can always comment on their own, nobody else can
    read or write until it's public.
67. **Flaggable content-type gaps** — five content types had shipped
    across earlier iterations with no flagging story at all: ingredient
    reviews, review replies, guide comments, collections, and (as of
    iteration 66, the same batch) collection comments. Extended
    moderation.rs's `CONTENT_TYPES`/`describe()`/`remove_content()` to
    cover all five, each removal action reusing an existing mechanism
    rather than a moderation-only code path - hard delete for the
    chat-like content types, the owner's own visibility toggle for a
    flagged collection.
68. **Un-rate ingredients** — the missing counterpart to iteration 56's
    meal/guide un-rate; ingredients were the only rating surface left
    without one. Score and note travel together on one `ingredient_reviews`
    row here (unlike meals' separate rate/review endpoints), so
    withdrawing means: clear just the score if a note is still standing
    behind it - never leaving the row in a shape `submit_review` itself
    wouldn't have accepted - otherwise delete the row outright. Always
    retracts the number from the shared `ratings` table and recomputes
    the ingredient's cached average either way.

**Verified:** collection comments' visibility gating confirmed via curl
(private collection 404s a non-owner's GET/POST, owner can always post,
flipping to public opens both), then posting/deleting a comment and its
Flag button confirmed in the browser; all five newly-flaggable content
types confirmed via curl end to end - flag creation, `describe()`
producing a correct preview for each, `resolve_flag` with "removed"
actually performing the right cleanup (ingredient_review and
collection_comment rows deleted, review_reply deleted with its
notification correctly pointing at the parent meal, guide_comment
deleted with no subject per the guide-routes-by-slug precedent,
collection flipped to private) - then the Flag button's presence on a
non-own guide comment confirmed in the browser; ingredient un-rate's
three cases confirmed via curl (score+note → score cleared, note kept,
rating cache reset to 0/0; score-only → row deleted outright, cache
reset; second un-rate on nothing left → real 404) and the "Remove"
button confirmed in the browser on a note-bearing review, including
confirming the review card correctly stays visible sans star rating
after removal - not just that a button click didn't error.

## Iteration 69: guide edit diff view

**Commit:** local only, not pushed · **Migrations:** none

Meal revisions got a real diff view in iteration 32 - what changed between
this version and the last, not just the two full snapshots side by side.
Guide edits never got the equivalent: a proposed edit rendered as its
entire raw body text with nothing marking what was actually different from
the guide as it reads right now, so voting on a multi-paragraph proposal
meant re-reading the whole thing and mentally spotting the difference
yourself. New `wordDiff()` (`frontend/src/lib/textDiff.ts`, a hand-rolled
LCS word-level diff - guides are free-form paragraphs, not the structured
fields meal revisions diff, so there's no named-field comparison to lean
on) powers a "View changes" toggle per proposed edit, collapsed by
default, comparing the proposal's body against the guide's current live
body with additions marked and removals struck through.

**Verified:** `npx tsc --noEmit` and `vite build` clean; confirmed the
toggle is correctly absent for an edit whose body already matches the
live guide (nothing to diff) and present for a genuinely different
proposal; clicked "View changes" and confirmed both `<mark>` (added) and
`<del>` (removed) spans render with the right word counts, then "Hide
changes" collapses it back; cleaned up by restarting the dev server,
which re-seeds guide bodies from their canonical source on every boot
(confirmed the test guide's body was restored exactly, not left
polluted by the test edit).

## Iteration 70: show the current value on ingredient description edits

**Commit:** local only, not pushed · **Migrations:** none

A proposed ingredient description edit rendered as only the new text -
nothing showing what the description currently reads, so judging "is this
actually better" meant scrolling up to the description already on the
page and holding it in memory while reading each competing proposal below.
`TextEditSection` now takes an optional `currentValue` prop (wired from
`IngredientDetail.tsx`'s already-loaded `data.description`) and renders
"Current: …" once above the list of proposals - every pending edit is
being judged against the same live value, so it only needs stating once,
not per row. Skipped entirely when there's nothing live yet (a fresh
ingredient with no description at all), matching the existing "No
description yet" empty state rather than showing an empty "Current:" line.

**Verified:** `npx tsc --noEmit` and `vite build` clean; curl-submitted a
competing description proposal on an ingredient with a real live
description, then confirmed in the browser that "Current: Small, sweet
grape tomatoes great for salads and snacking." renders once above both
the pre-existing proposal and the new one.
