# Cookbook

A social recipe app: follow chefs, build a personal cookbook, cook from what's in your fridge,
and browse community-editable ingredient pages with FooDB nutrition data.

Built from the `design_handoff_cookbook_v3` design spec.

## Stack

| Layer | Tech |
|---|---|
| Frontend | React + Vite + TypeScript, plain CSS Modules, installable PWA |
| Backend | Rust (Axum) + sqlx |
| Database | PostgreSQL |
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

The app is at http://localhost:5173; Vite proxies `/api` to the backend on :8090.
Migrations and the ingredient seed run automatically on backend startup.

## Deployment

`render.yaml` provisions a web service plus a Postgres instance. The Dockerfile builds the
frontend, compiles the backend, and serves the built frontend as static files from the same
service, so there is no cross-origin setup in production.

## Status

Working: accounts (register/login/logout with server-side sessions), ingredient catalog
(118 FooDB ingredients) with search, category filters, and detail pages including
macronutrients and micronutrient %DV.

Next: meals CRUD, the Cookbook screens (cooked/saved/published, fridge, shopping),
the social feed, community ingredient edits and voting, and Ask Chef.

## Data attribution

Nutrition reference data is derived from [FooDB](https://foodb.ca/), licensed
CC BY-NC 4.0 — attribution required, commercial use needs permission from the
FooDB rights holders.
