import "dotenv/config";

export const SCM_BASE_URL = "https://exesc.clubmin.net";
export const AUTH_STATE_DIR = ".auth";
export function getStatePath(userEmail: string): string {
  return `${AUTH_STATE_DIR}/users/${userEmail}/state.json`;
}
export const PLAYWRIGHT_HEADLESS = process.env.PLAYWRIGHT_HEADLESS === "true";

export const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD ?? "";
export const SESSION_SECRET = process.env.SESSION_SECRET ?? "";

if (!DASHBOARD_PASSWORD) console.warn("Warning: DASHBOARD_PASSWORD not set.");
if (!SESSION_SECRET) console.warn("Warning: SESSION_SECRET not set.");

export const DOWNLOAD_USER_NAME = process.env.DOWNLOAD_USER_NAME ?? "";

export const SSH_HOST              = process.env.SSH_HOST              ?? "";
export const SSH_USER              = process.env.SSH_USER              ?? "";
export const SSH_KEY_PATH          = process.env.SSH_KEY_PATH          ?? "";
export const MINUTES_REMOTE_PATH   = process.env.MINUTES_REMOTE_PATH   ?? "";
export const MINUTES_PUBLIC_URL_BASE = process.env.MINUTES_PUBLIC_URL_BASE ?? "";
export const MINUTES_SCM_PAGE_URL  = process.env.MINUTES_SCM_PAGE_URL  ?? "";

if (!SSH_HOST)                console.warn("Warning: SSH_HOST not set.");
if (!SSH_USER)                console.warn("Warning: SSH_USER not set.");
if (!SSH_KEY_PATH)            console.warn("Warning: SSH_KEY_PATH not set.");
if (!MINUTES_REMOTE_PATH)     console.warn("Warning: MINUTES_REMOTE_PATH not set.");
if (!MINUTES_PUBLIC_URL_BASE) console.warn("Warning: MINUTES_PUBLIC_URL_BASE not set.");
if (!MINUTES_SCM_PAGE_URL)    console.warn("Warning: MINUTES_SCM_PAGE_URL not set.");

export const SMTP_HOST = process.env.SMTP_HOST ?? "";
export const SMTP_PORT = parseInt(process.env.SMTP_PORT ?? "587", 10);
export const SMTP_USER = process.env.SMTP_USER ?? "";
export const SMTP_PASS = process.env.SMTP_PASS ?? "";
export const SMTP_FROM = process.env.SMTP_FROM ?? SMTP_USER;
export const APP_BASE_URL = process.env.APP_BASE_URL ?? "http://localhost:3000";

export const STACKCP_URL  = process.env.STACKCP_URL  ?? "";
export const STACKCP_USER = process.env.STACKCP_USER ?? "";
export const STACKCP_PASS = process.env.STACKCP_PASS ?? "";
export const ALERT_EMAIL  = process.env.ALERT_EMAIL  ?? "";
export const FTP_CRON     = process.env.FTP_CRON     ?? "0 8 * * 1";
