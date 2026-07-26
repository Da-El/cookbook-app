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

Beyond the spec: a **Contributions** group on the Cookbook page listing the reviews you've
written and the ingredient edits you've submitted (with vote counts and which are currently
winning), and the ability to withdraw your own edit — deleting one recomputes that field's
winner, reverting the ingredient to no-photo / blank description if it was the only edit.

Not built: **Ask Chef** (the AI cooking assistant) — deliberately deferred, since it needs
an LLM API key decision (Claude vs OpenAI) that hasn't been made yet.

## Data attribution

Nutrition reference data is derived from the U.S. Department of Agriculture's
[FoodData Central](https://fdc.nal.usda.gov/), Foundation Foods dataset. As a
U.S. government work it's public domain — no attribution is legally required
and there's no restriction on commercial use, unlike the FooDB data this
replaced. See `backend/seed/README.md` for exactly how the raw USDA release
was transformed into this app's seed data.
