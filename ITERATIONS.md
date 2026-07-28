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
