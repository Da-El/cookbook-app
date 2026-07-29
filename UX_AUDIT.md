# Mobile-first UX audit

A running record of a full pass over the app for mobile usability: what to
keep, what to upgrade, and what to delete. Unlike `ITERATIONS.md` (which
logs new features), most of the entries here are *reductions* - less chrome,
fewer simultaneous choices, patterns borrowed from the best mobile social
and marketplace apps (Instagram, TikTok, Airbnb, DoorDash, Pinterest).

Every pass is verified at a 375×812 mobile viewport before being logged here.

---

## Pass 1 — Browse: collapse the filter wall

**Commit:** local only, not pushed

**Problem:** Browse rendered six separate always-visible chip rows before a
single result appeared - meal type, diet, time+difficulty, occasion, sort,
plus presets. On a 375px-wide screen that measured 44 buttons and pushed the
first result card to 581px down (71% of the initial viewport was filter
chrome), even though each row scrolled horizontally on its own. Six rows
stacked is still six rows, regardless of whether each one individually
scrolls.

**Fix:** New reusable `FilterSheet` component (bottom sheet: backdrop,
slide-up panel, sectioned body, sticky "Clear all" / "Show N results"
footer) - the same collapse-behind-one-trigger pattern Airbnb, DoorDash, and
Pinterest all use on mobile. Browse's mobile branch now shows only: search,
the Meals/Ingredients/Chefs segmented control, the meal-type chip row (kept
visible - it's the single most-changed dimension), and one row of two pills
("⚙ Filters (N)" with an active-count badge, "↕ Sort by X"). Diet, time,
difficulty, occasion, and sort all moved inside the sheet, each as its own
labeled section that wraps instead of horizontal-scrolls now that there's
vertical room. Desktop is untouched - gated on `!isDesktop`, the four rows
render exactly as before above 900px, where a wrapping wall of chips is a
normal, expected pattern with more screen to spend.

**Result:** 44 buttons → 17 on first paint; first result card 581px → 417px;
whole page now fits one 812px viewport with zero scroll before content.

**Verified:** button/scroll-height counts before and after via
`getBoundingClientRect`; opened the sheet and confirmed all five sections
(Diet/Time/Difficulty/Occasion/Sort) render; selected a filter and confirmed
the trigger badge updated to "(1)"; "Clear all" resets state without closing
the sheet; the × and "Show N results" both close it; re-widened to 1280px
and confirmed the four rows render exactly as before with no filter-sheet
trigger present - desktop path provably unchanged.
