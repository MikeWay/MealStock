# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies (first time)
npm install

# Compile TypeScript
npm run build

# Set up database tables and seed initial data (run once, after building)
npm run setup-db

# Start the server (after building)
npm start
```

The server runs on port 3000. Access the app at `http://localhost:3000` and the audit log JSON at `http://localhost:3000/audit`.

To watch for changes during development: `npx tsc --watch`

## Configuration

Edit `src/db-config.ts` before starting — it exports the PostgreSQL connection config (`host`, `port`, `database`, `user`, `password`). Default assumes a local PostgreSQL install with database named `mealstock`.

## Architecture

TypeScript sources live in `src/`, compiled output goes to `dist/` (gitignored). The app is a single Node.js process serving a static `client.html`.

**`src/server.ts`** combines three concerns in one process:
- An `http.Server` serving `client.html` at `/` and audit JSON at `/audit`
- A `WebSocketServer` (from the `ws` package) attached to the same HTTP server
- A PostgreSQL connection pool (`pg`) for all persistence

**State flow**: On each WebSocket connection, the server sends a `full_state` message containing all weeks, dishes, and session data. Clients send mutation messages (`cell_update`, `add_dish`, `add_week`, `log_order`, `reset_session`, `set_active_week`). The server writes to PostgreSQL in a transaction, updates its in-memory `cachedState`, then broadcasts the change to all other connected clients.

**In-memory cache**: `cachedState` (`AppState | null`) is a module-level variable. It's used to resolve `dbId` references when processing `cell_update` messages (clients reference items by array index, not database ID). The cache is reloaded from DB after structural mutations (`add_week`, `add_dish`, `reset_session`); for cell-level updates it's patched in place.

**Key types** (defined in `src/server.ts`):
- `Category` — `'Meat' | 'Non-Meat' | 'Desserts'`
- `MutableDishField` — `'start' | 'ordered' | 'corrections'`
- `Dish`, `Week`, `AppState` — the in-memory state tree
- `CellUpdateMsg` — shape of a `cell_update` WebSocket message

WebSocket messages from clients arrive as raw JSON and are handled with `any` casts in the message handler; types are enforced at the function boundary when passed to typed helpers like `applyCellUpdate`.

## Database Schema

Five tables:
- `weeks` — weekly meal plan periods (label, sort_order)
- `dishes` — one row per dish per week (week_id FK, category, name, diet, start, ordered, corrections)
- `sessions` — one row per dish per session slot (dish_id FK, session_idx 0–7, used)
- `audit_log` — append-only record of every field change (never updated or deleted)
- `app_settings` — key/value store, currently only holds `active_week_id`

The 8 session slots are fixed and named in order: `Tues Improv`, `Tues Cruisers`, `Wed Diners`, `Wed Dinghies`, `Thurs Diners`, `Thurs Juniors`, `Thurs Cruisers`, `Friday`. Session usage values are stored as negative integers (portions used are negative).

Dish categories are exactly three strings: `Meat`, `Non-Meat`, `Desserts`.

## Adding a New Week

`addWeek()` copies dish names and diet info from the previous week, setting each dish's `start` to the calculated remainder (`start + ordered + corrections + sum(sessions)`). All session `used` values reset to 0 for the new week. New dishes added via `add_dish` are inserted into **all** existing weeks simultaneously.
