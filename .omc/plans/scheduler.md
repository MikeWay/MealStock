# Plan: Background Job Scheduler

## Requirements Summary

- A lightweight scheduler framework supporting both **cron/recurring** and **manually triggered background** jobs
- First concrete job: **weekly re-enable FTP** on the StackCP hosting panel via Playwright
- No dashboard UI — failures send an email alert via existing SMTP; all runs log to stdout (captured by journald)
- StackCP uses separate credentials stored in `.env`

---

## Acceptance Criteria

1. Server starts without error after scheduler is wired in (`src/server.ts`)
2. `node-cron` schedules the FTP job; it runs automatically each week at a configured time
3. If the FTP job succeeds, a success line is printed to stdout: `[scheduler] ftpEnable: OK`
4. If the FTP job throws, an error is logged to stdout and an email is sent to `ALERT_EMAIL` within 30 seconds
5. Two concurrent invocations of the same job cannot overlap (guarded by an in-flight flag)
6. Adding a new job requires only: creating a job file in `src/scheduler/jobs/` and registering it in `src/scheduler/index.ts`
7. StackCP credentials (`STACKCP_URL`, `STACKCP_USER`, `STACKCP_PASS`) are documented in `.env` and `config.ts`

---

## Implementation Steps

### Step 1 — Add `node-cron` dependency

```
npm install node-cron
npm install --save-dev @types/node-cron
```

### Step 2 — Extract shared email utility

**New file: `src/email.ts`**

Extract the nodemailer `createTransport` + `sendMail` logic currently duplicated in `src/routes/auth.ts` into a shared helper:

```typescript
export async function sendEmail(opts: { to: string; subject: string; text: string }): Promise<void>
```

- Reuse `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` from `src/config.ts`
- Include `tls: { rejectUnauthorized: false }` (already established fix)
- Update `src/routes/auth.ts` to use this shared helper instead of inline transport

### Step 3 — Add config values

**`src/config.ts`** — add:

```typescript
export const STACKCP_URL  = process.env.STACKCP_URL  ?? "";
export const STACKCP_USER = process.env.STACKCP_USER ?? "";
export const STACKCP_PASS = process.env.STACKCP_PASS ?? "";
export const ALERT_EMAIL  = process.env.ALERT_EMAIL  ?? "";
export const FTP_CRON     = process.env.FTP_CRON     ?? "0 8 * * 1"; // Monday 08:00
```

**`.env`** — add (values to be filled in):

```
STACKCP_URL=https://panel.stackcp.com
STACKCP_USER=
STACKCP_PASS=
ALERT_EMAIL=mikeway@webwrights.co.uk
FTP_CRON=0 8 * * 1
```

### Step 4 — Create scheduler framework

**New file: `src/scheduler/index.ts`**

```typescript
interface Job {
  name: string;
  schedule: string;   // cron expression
  fn: () => Promise<void>;
}

export function registerJobs(): void
// - Imports all jobs from src/scheduler/jobs/
// - For each job: schedule with node-cron
// - Wraps fn() with: in-flight guard, stdout logging, email-on-failure
```

In-flight guard pattern:
```typescript
const running = new Set<string>();
// skip if running.has(job.name); add on start, delete in finally
```

Email-on-failure:
```typescript
// catch (err) → console.error + sendEmail({ to: ALERT_EMAIL, subject: `[scm-tools] ${job.name} failed`, text: err.message })
```

### Step 5 — StackCP FTP enable scraper

**New file: `src/scraper/stackcp.ts`**

Playwright automation (headless, separate browser context — does not use SCM client):

1. Launch browser, new context
2. Navigate to `STACKCP_URL`
3. Fill username/password, submit login form
4. Navigate to FTP section (exact selectors TBD during implementation — inspect live panel)
5. Check if FTP is already enabled; if not, click enable
6. Close browser
7. Throws on failure (scheduler catches and emails)

### Step 6 — FTP enable job

**New file: `src/scheduler/jobs/ftpEnable.ts`**

```typescript
import { enableFtp } from "../../scraper/stackcp.js";

export const name = "ftpEnable";
export const schedule = FTP_CRON;   // from config
export async function run(): Promise<void> {
  await enableFtp();
}
```

### Step 7 — Wire scheduler into server

**`src/server.ts`** — add after `app.listen(...)`:

```typescript
import { registerJobs } from "./scheduler/index.js";
// ...
registerJobs();
```

---

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| StackCP login UI changes (selectors break) | Job throws → email alert; fix selectors in `stackcp.ts` |
| STACKCP credentials not set | `config.ts` warns on startup; job checks and throws early with a clear message |
| FTP panel flow unknown until inspected live | Step 5 selectors are marked TBD; must inspect StackCP panel before coding scraper |
| Playwright takes long, blocks event loop | Runs in async fn; does not block Express; in-flight guard prevents overlap |
| Email alert fails (SMTP down) | Error is still logged to stdout/journald |

---

## Verification Steps

1. `npm run build` — compiles with no TypeScript errors
2. `npm run dev` — server starts; stdout shows `[scheduler] registered: ftpEnable (0 8 * * 1)`
3. Temporarily set `FTP_CRON=* * * * *`, restart server, observe job runs and logs within 60 seconds
4. Trigger a deliberate failure (wrong credentials), confirm email arrives at `ALERT_EMAIL`
5. Revert cron to weekly, redeploy
