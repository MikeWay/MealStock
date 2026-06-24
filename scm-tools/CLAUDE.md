# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run Commands

- `npm run dev` — Start dev server with hot reload (tsx watch)
- `npm run build` — Compile TypeScript to `dist/`
- `npm start` — Run compiled output from `dist/`
- `bash deploy.sh` — Build, rsync to production server, and restart service

## Architecture

- **Express server** (`src/server.ts`) — Serves the dashboard and API routes on port 3000; registers scheduler jobs and background-prefetches SCM data on startup
- **Scraper** (`src/scraper/`) — Playwright-based browser automation for interacting with SCM (no public API)
- **Routes** (`src/routes/`) — API endpoints for the dashboard
- **Dashboard** (`src/public/index.html`) — Single-file vanilla JS/CSS/HTML frontend; no frontend framework

## Key Details

- TypeScript with ES2022 target, NodeNext module resolution, strict mode
- ESM project (`"type": "module"` in package.json)
- SCM has no public API; all interaction is via Playwright browser automation
- Playwright session state persisted at `.auth/users/{email}/state.json`

## Routes

| File | Prefix | Notes |
|------|--------|-------|
| `src/routes/auth.ts` | `/api/auth`, `/api/users` | Dashboard login, SCM login/MFA, password reset, user management, invite flow |
| `src/routes/contacts.ts` | `/api/contacts` | Duplicates, merge, name repair, non-duplicate tagging |
| `src/routes/consents.ts` | `/api/consents` | Consent scan (view+), withdraw/clear (full only) |
| `src/routes/tasks.ts` | `/api/tasks` | SCM attention items |
| `src/routes/emailIssues.ts` | `/api/email-issues` | Email bounce detection and reset |
| `src/routes/minutes.ts` | `/api/minutes` | Committee minutes sync |
| `src/routes/scheduler.ts` | `/api/scheduler` | Job status |
| `src/routes/dashboard.ts` | `/api/dashboard` | Summary tile counts (cache-only, fast) |
| `src/routes/roles.ts` | `/api/roles` | Role and permission management |

## Scraper Modules

| File | Purpose |
|------|---------|
| `src/scraper/client.ts` | Per-user `ScmClient` with `loggedIn`, `connecting` flags; `tryAutoConnect()` |
| `src/scraper/contacts.ts` | Load/parse contact CSV cache; `addTagToContactInCache`; `countContactNameIssues` |
| `src/scraper/duplicates.ts` | `findDuplicateGroups` — Dice-coefficient name similarity, definite vs possible with reason |
| `src/scraper/merge.ts` | Contact merge via SCM UI |
| `src/scraper/tags.ts` | Add tag via SCM view-page inline editor |
| `src/scraper/consents.ts` | Consent fetch; withdrawal records; cache freshness |
| `src/scraper/emailIssues.ts` | Fetch and reset email bounce records |
| `src/scraper/tasks.ts` | Fetch SCM attention items |
| `src/scraper/prefetch.ts` | Background prefetch of tasks + email issue counts on startup |

## Permissions

Roles assign one of `none` / `view` / `full` per area: `tasks`, `duplicates`, `emailIssues`, `minutes`, `consents`, `users`.

- `consents: view` — can see section, load cache, run Scan Consents
- `consents: full` — above + withdraw, restore, force refresh, clear cache
- `users: full` — required to create users, manage roles, invite users

## Frontend Patterns

- Single section shown at a time; hidden via `hideAllSections()` + `ALL_SECTIONS` array
- Nav is a dynamically built nav-bar with dropdown groups; leaf items (`Home`, `Help`) shown directly
- `applyPermissions(perms)` hides/shows buttons based on role; called after login and status check
- `requireScmLogin(callback)` checks SCM connection before SCM-dependent actions
- Dashboard home tiles fetched from `/api/dashboard/summary`; SCM-dependent counts prefetched on startup with orange flashing pill while connecting
- Invite flow: create user with `{ email, invite: true }` → server returns `draftEmail` → admin edits and sends via `/api/users/:email/send-invite`
