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

## Pass 2 — One rating control instead of four copies of ten buttons

**Commit:** local only, not pushed

**Problem:** Meals, ingredients, and guides each rate 1-10, and each had its
own copy-pasted row of ten individually-bordered pill buttons - four
near-identical implementations (`MealDetail.tsx`'s main widget and its
review-edit form, `IngredientDetail.tsx`, `Guides.tsx`) that only
highlighted the exact selected number rather than filling up to it, so
"is my rating 6 or 7" required reading which single button was dark rather
than counting a filled bar. On a 375px phone the buttons were 29px wide -
under Apple/Google's 44px touch-target guidance, with gaps between them
inviting a miss entirely.

**Fix:** One shared `RatingInput` component - segments read as a single
connected bar (no gaps, shared border, `flex: 1` so it fills its container
at any width), filling solid up to the chosen value like a volume slider,
42px tall for a better tap target. All four call sites now use it; each
duplicated `.rateBtn`/`.rateBtnOn`/`.editScoreBtn` CSS block was deleted
rather than left dead, and the surrounding `.rateRow` classes were trimmed
to pure spacing wrappers instead of removed outright, since each context
needed a different margin the shared component correctly stays agnostic
about.

**Verified:** `npx tsc --noEmit` and a full `vite build` both clean (the
build step matters here specifically - editing four `.module.css` files by
hand to remove blocks is exactly the kind of change a stray brace slips
into, and tsc doesn't parse CSS); confirmed in-browser on the meal page
(single 10-segment bar, 42px tall, clicking segment 7 fills 1-7 and posts
"You: 7/10", Remove clears it) and the guide page (same bar renders and is
interactive); ingredient and review-edit call sites are the identical
component with identical wiring, not independently re-tested.

## Pass 3 — Meal plan: one day at a time on mobile, not all seven at once

**Commit:** local only, not pushed

**Problem:** The week view rendered all 7 days stacked in a single column
on mobile (the grid only becomes 7-across at 900px+), each with 4 meal
slots - 28 "+ Add" targets and 7 day headers on screen simultaneously,
requiring a long scroll to reach Thursday let alone act on it. Functionally
fine on a desktop-width screen with room for 7 columns; on a phone it's the
same "show every dimension at once" problem Browse had, just spatial
instead of filter-shaped.

**Fix:** A horizontal day-strip (Mon-Sun pills showing weekday + date, a
small dot marking a day with something already planned) replaces the
stacked cards on mobile - tapping a day shows only that day's 4 slots
below, the same one-day-at-a-time-behind-a-strip pattern Google/Apple
Calendar use on a phone. Implemented as a single `daysToRender` array that's
either all 7 days (desktop) or just the active one (mobile), so the actual
slot-rendering JSX - add/swap/reorder/remove, the picker sheet - is exactly
the same code path for both, not a duplicated mobile branch. Falls back to
today if it's in the visible week, otherwise the week's first day, so
paging forward/back never strands the selection off-screen. Desktop is
untouched - gated on `isDesktop`, same 7-column grid as before.

**Result:** 28 "+ Add" buttons → 4; whole week view now fits one 812px
viewport with zero scroll before you can act on the visible day.

**Verified:** `npx tsc --noEmit` and `vite build` both clean; in-browser at
375px confirmed 4 add-buttons (not 28) and zero scroll height beyond the
viewport; clicked a different day-strip cell and confirmed the active state
moved and the slots re-rendered for that day; opened the "+ Add" sheet and
confirmed it still reads the correct day/slot ("Add to breakfast"); resized
to 1280px and confirmed the day-strip disappears, all 28 add-buttons and
all 7 day headers return - desktop path provably unchanged.

## Pass 4 — Meal detail: occasion voting collapsed to an expand button

**Commit:** local only, not pushed

**Problem:** A signed-in viewer saw all 8 occasion-tag voting options as
chips by default, on top of up to 5 diet badges - up to 13 small chips
above the description, before the recipe itself. A logged-out viewer
already only saw whichever tags the community had actually confirmed
("applied"); the signed-in default was strictly noisier for no real reason
other than "you're allowed to vote, so here's every option."

**Fix:** Signed-in viewers now see the same compact default a logged-out
viewer does - only applied tags - plus a single "+ Tag an occasion" chip
that reveals the full votable set in place when tapped. No backend change;
this is purely which rows of the same `occasions` array render by default.

**Verified:** `npx tsc --noEmit` and `vite build` clean; in-browser at 375px
confirmed only "+ Tag an occasion" renders initially (none of the 8
occasion labels present), and clicking it reveals all 8 as votable chips.
