# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies (first time)
npm install

# Set up database tables and seed initial data (run once)
node setup-db.js

# Start the server
npm start
# or
node server.js
```

The server runs on port 3000. Access the app at `http://localhost:3000` and the audit log JSON at `http://localhost:3000/audit`.

## Configuration

Edit `db-config.js` before starting — it exports the PostgreSQL connection config (`host`, `port`, `database`, `user`, `password`). Default assumes a local PostgreSQL install with database named `mealstock`.

## Architecture

This is a minimal two-file Node.js app: a server (`server.js`) and a single-page client (`client.html`) served over HTTP.

**server.js** combines three concerns in one process:
- An `http.Server` serving `client.html` at `/` and audit JSON at `/audit`
- A `WebSocketServer` (from the `ws` package) attached to the same HTTP server
- A PostgreSQL connection pool (`pg`) for all persistence

**State flow**: On each WebSocket connection, the server sends a `full_state` message containing all weeks, dishes, and session data. Clients send mutation messages (`cell_update`, `add_dish`, `add_week`, `log_order`, `reset_session`, `set_active_week`). The server writes to PostgreSQL in a transaction, updates its in-memory `cachedState`, then broadcasts the change to all other connected clients.

**In-memory cache**: `cachedState` is a module-level variable holding the full application state. It's used to resolve `dbId` references when processing `cell_update` messages (clients reference items by index, not database ID). The cache is reloaded from DB after structural mutations (`add_week`, `add_dish`, `reset_session`); for cell-level updates it's patched in place.

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
