# Cookbook

A social recipe app: follow chefs, build a personal cookbook, cook from what's in your fridge,
and browse community-editable ingredient pages with USDA nutrition data.

Built from the `design_handoff_cookbook_v3` design spec.

## Stack

| Layer | Tech |
|---|---|
| Frontend | React + Vite + TypeScript, plain CSS Modules, installable PWA |
| Backend | Rust (Axum) + sqlx |
| Database | PostgreSQL, hosted on [Neon](https://neon.tech) |
| Hosting | Render (Docker) |

## Local development

Requires Rust, Node 22+, and a local PostgreSQL.

```bash
createdb cookbook
cp backend/.env.example backend/.env   # then set your real DATABASE_URL
```

Run the two servers in separate terminals:

```bash
cd backend && cargo run
```

```bash
cd frontend && npm install && npm run dev
```

The app is at http://localhost:5180; Vite proxies `/api` to the backend on :8090.
Migrations and the ingredient seed run automatically on backend startup.

(Port 5180 is pinned rather than Vite's default 5173, which collides with another
project on this machine.)

## Deployment

The database is Neon, not Render's own Postgres — Render allows only one free-tier Postgres
per account, and that slot was already used by an unrelated project. `render.yaml` provisions
just the web service; `DATABASE_URL` is set directly on it, pointing at Neon. The Dockerfile
builds the frontend, compiles the backend, and serves the built frontend as static files from
the same service, so there is no cross-origin setup in production.

## Status

Every screen in the design spec is built and wired to real data: accounts, the ingredient
catalog (363 USDA Foundation Foods) with community-edit voting on description/category/photo/
nutrition, meals (create/browse/cook/save/rate), the Home feed (following, activity, stories,
chefs-to-follow), Browse (meals/ingredients/chefs), the full Cookbook (recipes + kitchen +
contributions sub-tabs, fridge, shopping), Meal Detail, Cook Mode, chef profiles, Settings,
and Customize (live-applied themes).

### Planning, import and cooking

- **Recipe import** (`/import`). Reads `schema.org/Recipe` JSON-LD from a URL, or parses pasted
  text using layout rules. Every attempt is recorded in `recipe_imports` with the extractor that
  handled it. Imported recipes save **privately** with a link back to the source.
  - The URL fetcher is SSRF-guarded: scheme allow-list, DNS resolution checked against private/
    loopback/link-local/CGNAT ranges (including IPv4-mapped IPv6), capped size and timeout, and
    redirect re-validation. Without it the endpoint is a proxy into the container's network.
  - A growing number of large recipe sites block server-side fetching at the CDN (Cloudflare
    returns `402`). That's why paste-text exists and is offered as the fallback in the UI.
- **Meal planner** (`/plan`) — week grid with four slots a day, plus per-entry servings.
- **Aggregated grocery list** — sums a week's ingredients, converting within a dimension
  (mass/volume) and keeping incompatible ones apart, scaling by servings, flagging what's already
  in the fridge, and pushing selected lines to the shopping list.
- **Ingredient-reuse suggestions** — ranks unplanned meals by overlap with what the week already
  needs, so one bunch of coriander gets used three times instead of wilting.
- **Multiple timers** in Cook Mode — concurrent, named, wake-lock backed, and derived from
  wall-clock timestamps so a throttled or backgrounded tab still shows the truth on return.
- **Discover** (`/discover`) and **Guides** (`/guides`) — an inspiration gallery and six seeded
  beginner guides.

Not built: **cost estimation**, deliberately skipped — prices vary too much by region, store and
season for a "rough" figure to be trustworthy, and USDA Foundation Foods carries no price data.

### LLM: wired, not switched on

The AI importer is scaffolded end to end — route, staging table, extractor tag, draft shape and
review UI — but `llm_extract` in `backend/src/import.rs` returns `LlmNotConfigured`. Turning it on
means implementing that one function and setting `LLM_API_KEY`; no schema or API change. Failed
imports are recorded, so they double as the evaluation set for it. `GET /api/import/capabilities`
reports `ai_import: false` and the UI labels the manual path honestly rather than offering
something that 422s.

Beyond the spec:

- A **Contributions** group on the Cookbook page listing the reviews you've written and the
  ingredient edits you've submitted (with vote counts and which are currently winning), and
  the ability to withdraw your own edit — deleting one recomputes that field's winner,
  reverting the ingredient to no-photo / blank description if it was the only edit.
- An **account menu** on the topbar avatar (cookbook, customize, settings, legal, log out).
- A **Legal & privacy** page at `/legal`, written against the real schema and auth code
  rather than boilerplate. It's the one route that resolves signed-out, but nothing links
  to it from the sign-in screen. It is *not* lawyer-reviewed and says so.
- An **install prompt** for the PWA (`src/pwa/InstallContext.tsx`). Chrome fires the real
  `beforeinstallprompt`; iOS Safari has no such API, so that branch shows Share → Add to
  Home Screen steps instead. Dismissal persists, and an "Install app" entry stays in the
  account menu so declining isn't a one-way door.

Not built: **Ask Chef** (the AI cooking assistant) — deliberately deferred, since it needs
an LLM API key decision (Claude vs OpenAI) that hasn't been made yet.

Also missing, and worth adding before this is shared widely: `screenshots` in the web app
manifest, which is what makes desktop Chrome/Edge show a rich install dialog instead of a
bare one. It needs real captures of the app, so drop them in `frontend/public/` and add
them to the `manifest.icons` sibling `screenshots` array in `vite.config.ts`.

## Data attribution

Nutrition reference data is derived from the U.S. Department of Agriculture's
[FoodData Central](https://fdc.nal.usda.gov/), Foundation Foods dataset. As a
U.S. government work it's public domain — no attribution is legally required
and there's no restriction on commercial use, unlike the FooDB data this
replaced. See `backend/seed/README.md` for exactly how the raw USDA release
was transformed into this app's seed data.
