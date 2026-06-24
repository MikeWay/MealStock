import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import path from "path";
import type { Page } from "playwright";
import { DOWNLOAD_USER_NAME, SCM_BASE_URL } from "../config.js";

const CACHE_DIR = ".cache";
const CACHE_FILE = path.join(CACHE_DIR, "consents-cache.json");
const WITHDRAWALS_FILE = path.join(CACHE_DIR, "consents-withdrawn.json");
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export type ConsentStatus = "consented" | "not_consented" | "no_record";

export interface ContactConsentRecord {
  contactId: string;
  name: string;
  email: string;
  status: ConsentStatus;
}

export interface ConsentCache {
  scannedAt: string;
  contacts: ContactConsentRecord[];
}

export interface WithdrawalRecord {
  contactId: string;
  contactName: string;
  withdrawnAt: string;
}

// ── Cache & withdrawal file helpers ────────────────────────────────────────

export function loadConsentCache(): ConsentCache | null {
  if (!existsSync(CACHE_FILE)) return null;
  try {
    return JSON.parse(readFileSync(CACHE_FILE, "utf-8")) as ConsentCache;
  } catch {
    return null;
  }
}

export function isConsentCacheFresh(cache: ConsentCache): boolean {
  return Date.now() - new Date(cache.scannedAt).getTime() < CACHE_MAX_AGE_MS;
}

export function saveConsentCache(cache: ConsentCache): void {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), "utf-8");
}

export function clearConsentCache(): void {
  if (existsSync(CACHE_FILE)) unlinkSync(CACHE_FILE);
}

export function loadWithdrawals(): WithdrawalRecord[] {
  if (!existsSync(WITHDRAWALS_FILE)) return [];
  try {
    return JSON.parse(readFileSync(WITHDRAWALS_FILE, "utf-8")) as WithdrawalRecord[];
  } catch {
    return [];
  }
}

export function recordWithdrawal(
  contactId: string,
  contactName: string
): { record: WithdrawalRecord; alreadyExisted: boolean } {
  const withdrawals = loadWithdrawals();
  const existing = withdrawals.find((w) => w.contactId === contactId);
  if (existing) return { record: existing, alreadyExisted: true };

  const record: WithdrawalRecord = {
    contactId,
    contactName,
    withdrawnAt: new Date().toISOString(),
  };
  withdrawals.push(record);
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(WITHDRAWALS_FILE, JSON.stringify(withdrawals, null, 2), "utf-8");
  return { record, alreadyExisted: false };
}

export function removeWithdrawal(contactId: string): { success: boolean; message: string } {
  const withdrawals = loadWithdrawals();
  const idx = withdrawals.findIndex((w) => w.contactId === contactId);
  if (idx === -1) return { success: false, message: "No withdrawal record found" };
  withdrawals.splice(idx, 1);
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(WITHDRAWALS_FILE, JSON.stringify(withdrawals, null, 2), "utf-8");
  return { success: true, message: "Withdrawal reversed" };
}

// ── Bookings bulk export scraping ───────────────────────────────────────────

interface ConsentRow {
  contactId: string;
  firstName: string;
  lastName: string;
  /** ISO string of the booking "When" date, used to pick the latest booking */
  when: string | null;
  /** null = no IMAGE CONSENT field present in this booking */
  consented: boolean | null;
}

/**
 * Navigates to /booking/bookings, clicks Export…, selects "This year", and
 * queues the export. The resulting CSV will appear in /active_jobs.
 */
async function queueBookingsExport(page: Page): Promise<void> {
  await page.goto(`${SCM_BASE_URL}/booking/bookings`, { waitUntil: "domcontentloaded" });
  console.log(`queueBookingsExport: on page ${page.url()}`);

  // Click the Export… button/link and wait for the modal/form to appear
  const exportBtn = page
    .locator('a:has-text("Export..."), button:has-text("Export..."), input[value*="Export..." i]')
    .first();
  await exportBtn.click();

  // Wait for a modal, dropdown, or any new visible content to settle
  await page.waitForTimeout(1000);
  console.log(`queueBookingsExport: after Export... click, url=${page.url()}`);

  // Dump visible page text to diagnose what appeared
  const bodyText = await page.locator("body").innerText();
  console.log(`queueBookingsExport: body text (first 500 chars): ${bodyText.slice(0, 500)}`);

  // Dump all links (modals often use <a> for options)
  const allLinks = page.locator("a");
  const linkCount = await allLinks.count();
  console.log(`queueBookingsExport: ${linkCount} link(s) on page after Export... click:`);
  for (let i = 0; i < Math.min(linkCount, 30); i++) {
    const txt = (await allLinks.nth(i).textContent())?.trim() ?? "";
    const href = await allLinks.nth(i).getAttribute("href") ?? "";
    if (txt) console.log(`  a[${i}] href="${href}" text="${txt}"`);
  }

  // Try clicking a "This year" link or option (modal/dropdown style)
  const thisYearLink = page.locator('a, li, button, option').filter({ hasText: /^this\s+year$/i }).first();
  if ((await thisYearLink.count()) > 0) {
    console.log("queueBookingsExport: clicking 'This year' link/option");
    await thisYearLink.click();
    await page.waitForTimeout(500);
  } else {
    // Fallback: radio button via associated label
    const label = page.locator("label").filter({ hasText: /this.?year/i }).first();
    if ((await label.count()) > 0) {
      const forAttr = await label.getAttribute("for");
      console.log(`queueBookingsExport: found 'This year' label with for="${forAttr}"`);
      if (forAttr) await page.locator(`[id="${forAttr}"]`).check();
    } else {
      console.warn("queueBookingsExport: could not find 'This year' option");
    }
  }

  // Debug: log all buttons/submits visible on the page
  const allBtns = page.locator('input[type="submit"], button[type="submit"], button, input[type="button"]');
  const btnCount = await allBtns.count();
  console.log(`queueBookingsExport: ${btnCount} button(s) on page after selecting This year:`);
  for (let i = 0; i < btnCount; i++) {
    const el = allBtns.nth(i);
    const tag = await el.evaluate((n) => n.tagName);
    const val = await el.getAttribute("value") ?? "";
    const txt = (await el.textContent()) ?? "";
    const id = await el.getAttribute("id") ?? "";
    console.log(`  [${i}] <${tag}> id="${id}" value="${val}" text="${txt.trim()}"`);
  }

  // Submit to queue
  const submitBtn = page.locator(
    '#submit_button, input[type="submit"], button[type="submit"], button:has-text("Export"), input[value*="Export" i], a:has-text("Export")'
  ).first();
  await submitBtn.click();
  await page.waitForLoadState("domcontentloaded");
}

/**
 * Clicks "Remove & cleanup" for each job row in /active_jobs where the
 * displayed username matches DOWNLOAD_USER_NAME (or all rows if unset).
 */
async function clearActiveJobs(page: Page): Promise<void> {
  await page.goto(`${SCM_BASE_URL}/active_jobs`, { waitUntil: "networkidle" });

  const CLEANUP_SELECTOR = [
    'a:has-text("Remove")',
    'button:has-text("Remove")',
    'input[type="submit"][value*="Remove" i]',
    'input[type="button"][value*="Remove" i]',
  ].join(", ");

  for (let attempt = 0; attempt < 50; attempt++) {
    // Find all Remove buttons, then pick the first one whose row matches the username
    const buttons = page.locator(CLEANUP_SELECTOR);
    const total = await buttons.count();
    console.log(`clearActiveJobs attempt ${attempt + 1}: total buttons=${total}`);
    if (total === 0) break;

    let clicked = false;
    for (let i = 0; i < total; i++) {
      const btn = buttons.nth(i);
      if (DOWNLOAD_USER_NAME) {
        // Walk up to the nearest tr ancestor and check its text
        const row = btn.locator("xpath=ancestor::tr[1]");
        const rowCount = await row.count();
        if (rowCount > 0) {
          const rowText = (await row.textContent()) ?? "";
          if (!rowText.includes(DOWNLOAD_USER_NAME)) {
            console.log(`clearActiveJobs: skipping row (username mismatch)`);
            continue;
          }
        }
      }

      page.once("dialog", (dialog) => dialog.accept());
      await btn.click();
      await page.waitForLoadState("networkidle");
      clicked = true;
      break; // restart the outer loop to re-query fresh DOM
    }

    if (!clicked) break; // no matching rows remain
  }
}

/**
 * Returns CSV download link texts visible in /active_jobs whose filename
 * contains today's date in any common format (YYYYMMDD or YYYY-MM-DD).
 */
/**
 * Returns CSV download link texts visible in /active_jobs whose filename
 * starts with "bookings" and contains today's date in any common format
 * (YYYYMMDD, YYYY-MM-DD, or DDMMYYYY). This ensures we only match the bulk
 * /booking/bookings export, not per-bookable exports.
 */
async function getTodaysCsvTexts(page: Page): Promise<string[]> {
  const d = new Date();
  const yyyy = d.getFullYear().toString();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const formats = [
    `${yyyy}${mm}${dd}`,   // 20260328
    `${yyyy}-${mm}-${dd}`, // 2026-03-28
    `${dd}${mm}${yyyy}`,   // 28032026
  ];

  await page.goto(`${SCM_BASE_URL}/active_jobs`, { waitUntil: "domcontentloaded" });

  const links = page.locator("a");
  const count = await links.count();
  const allCsvs: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < count; i++) {
    const text = (await links.nth(i).textContent())?.trim() ?? "";
    if (!text.endsWith(".csv")) continue;
    allCsvs.push(text);
    if (text.startsWith("bookings") && formats.some((f) => text.includes(f))) seen.add(text);
  }
  console.log(`getTodaysCsvTexts: all CSVs on page: ${allCsvs.join(", ")}`);
  const csvTexts = [...seen];
  console.log(`getTodaysCsvTexts: found ${csvTexts.length} matching today: ${csvTexts.join(", ")}`);
  return csvTexts;
}

/**
 * Polls /active_jobs until the total number of today's CSV download links
 * reaches `expectedCount`. Calls `onPoll` on each poll for progress/keepalive.
 */
async function waitForCsvCount(
  page: Page,
  expectedCount: number,
  onPoll: (ready: number, expected: number) => void,
  isCancelled: () => boolean = () => false,
  maxWaitMs = 10 * 60_000,
  pollIntervalMs = 5_000
): Promise<string[]> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    if (isCancelled()) throw new Error("__cancelled__");
    const csvTexts = await getTodaysCsvTexts(page);
    console.log(`waitForCsvCount: ${csvTexts.length}/${expectedCount}`);
    onPoll(csvTexts.length, expectedCount);
    if (csvTexts.length >= expectedCount) return csvTexts;
    await page.waitForTimeout(pollIntervalMs);
    if (isCancelled()) throw new Error("__cancelled__");
  }
  throw new Error("Timed out waiting for bookable exports to be ready");
}

/**
 * Downloads a bookable export by clicking its link in /active_jobs.
 * Excludes event navigation links (/events/) to target the download link.
 */
async function downloadExportByText(page: Page, linkText: string): Promise<string> {
  await page.goto(`${SCM_BASE_URL}/active_jobs`, { waitUntil: "domcontentloaded" });
  // Prefer a link that is NOT an event navigation link
  const link = page
    .locator(`a:has-text("${linkText}"):not([href*="/events/"])`)
    .first();
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 30_000 }),
    link.click(),
  ]);
  const filePath = await download.path();
  if (!filePath) throw new Error(`Download failed for "${linkText}"`);
  return readFileSync(filePath, "utf-8");
}

/**
 * Parses the bookings export CSV.
 *
 * Extra fields are exported as label/value column pairs. We scan each row for
 * an Extra column whose value is "IMAGE CONSENT" and read the next column for
 * "yes" or "no". The "When" column is used to determine the most recent booking.
 */
function parseConsentCsv(csv: string): ConsentRow[] {
  const lines = csv.split("\n");
  if (lines.length < 2) return [];

  const header = parseRow(lines[0]);

  // Prefer the specific "Made for/by (SCM ID)" column over other "Made for" columns
  const uidIdx = header.findIndex((h) => /scm.?id/i.test(h));
  const firstIdx = header.findIndex((h) => /first.?name/i.test(h));
  const lastIdx = header.findIndex((h) => /last.?name/i.test(h));
  const whenIdx = header.findIndex((h) => /^when$/i.test(h.trim()));

  // Indices of all columns whose header starts with "Extra"
  const extraIndices = header
    .map((h, i) => (/^extra/i.test(h.trim()) ? i : -1))
    .filter((i) => i >= 0);

  const rows: ConsentRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const fields = parseRow(line);

    const CONSENT_VALUES = /^(?:image\s+consent|photo\s+consent|photograph\s+consent|photograph\s+and\s+medical\s+consent|yes\s+to\s+photo)$/i;
    const CONSENT_LABEL = /image\s*consent|photo(?:graph(?:ic)?)?\s*(?:and\s+medical\s+)?consent/i;

    let consented: boolean | null = null;
    for (const idx of extraIndices) {
      const labelVal = (fields[idx] ?? "").trim();
      const valueStr = (fields[idx + 1] ?? "").trim();

      // Value IS one of the recognised consent phrases → consented
      if (CONSENT_VALUES.test(valueStr)) {
        consented = true;
        break;
      }
      // Label identifies a consent field with an explicit yes/no answer
      if (CONSENT_LABEL.test(labelVal)) {
        consented = valueStr.toLowerCase() === "yes";
        break;
      }
    }

    const whenRaw = whenIdx >= 0 ? (fields[whenIdx] ?? "").trim() : "";
    // CSV format is DD/MM/YYYY HH:MM — parse manually to avoid MM/DD ambiguity
    const whenMatch = whenRaw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/);
    const whenDate = whenMatch
      ? new Date(+whenMatch[3], +whenMatch[2] - 1, +whenMatch[1], +whenMatch[4], +whenMatch[5])
      : null;

    rows.push({
      contactId: fields[uidIdx] ?? "",
      firstName: fields[firstIdx] ?? "",
      lastName: fields[lastIdx] ?? "",
      when: whenDate && !isNaN(whenDate.getTime()) ? whenDate.toISOString() : null,
      consented,
    });
  }

  return rows;
}

/** Simple CSV row parser (handles quoted fields and escaped quotes). */
function parseRow(line: string): string[] {
  const fields: string[] = [];
  let i = 0;
  while (i <= line.length) {
    if (i === line.length) { fields.push(""); break; }
    if (line[i] === '"') {
      let value = "";
      i++;
      while (i < line.length) {
        if (line[i] === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') { value += '"'; i += 2; }
          else { i++; break; }
        } else { value += line[i]; i++; }
      }
      fields.push(value);
      if (i < line.length && line[i] === ",") i++;
    } else {
      const commaIdx = line.indexOf(",", i);
      if (commaIdx === -1) { fields.push(line.substring(i)); break; }
      else { fields.push(line.substring(i, commaIdx)); i = commaIdx + 1; }
    }
  }
  return fields;
}

// ── Public entry point ──────────────────────────────────────────────────────

/**
 * Fetches photo consent status for all contacts via a single bulk bookings
 * export from /booking/bookings (This year).
 *
 * Returns a map of SCM contact ID → ConsentStatus.
 * Consent is determined by the contact's most recent booking that includes an
 * IMAGE CONSENT field.
 */
export async function fetchAllConsents(
  page: Page,
  onProgress: (done: number, total: number, name: string) => void,
  isCancelled: () => boolean = () => false
): Promise<Map<string, ConsentStatus>> {
  // Always clear our own old jobs first
  await clearActiveJobs(page);

  // Check if today's CSV is already present from a previous run
  let csvTexts = await getTodaysCsvTexts(page);

  if (csvTexts.length >= 1) {
    onProgress(1, 1, `Using existing export from today…`);
  } else {
    onProgress(0, 1, "Queuing bookings export…");
    await queueBookingsExport(page);

    csvTexts = await waitForCsvCount(
      page,
      1,
      (ready, expected) => onProgress(ready, expected, `Waiting for export… (${ready} of ${expected} ready)`),
      isCancelled
    );
  }

  // Download and parse the CSV
  const consentMap = new Map<string, ConsentStatus>();
  const linkText = csvTexts[0];
  onProgress(0, 1, `Downloading: ${linkText}`);
  const csv = await downloadExportByText(page, linkText);
  const rows = parseConsentCsv(csv);
  console.log(`fetchAllConsents: parsed ${rows.length} rows`);

  // For each contact keep only the row with the most recent "When" date
  const latestByContact = new Map<string, ConsentRow>();
  for (const row of rows) {
    if (!row.contactId) continue;
    const existing = latestByContact.get(row.contactId);
    if (!existing) {
      latestByContact.set(row.contactId, row);
    } else {
      const existingTime = existing.when ? new Date(existing.when).getTime() : 0;
      const rowTime = row.when ? new Date(row.when).getTime() : 0;
      if (rowTime > existingTime) latestByContact.set(row.contactId, row);
    }
  }

  let consented = 0, notConsented = 0, noRecord = 0;
  for (const [contactId, row] of latestByContact) {
    if (row.consented === true) {
      consentMap.set(contactId, "consented");
      consented++;
    } else if (row.consented === false) {
      consentMap.set(contactId, "not_consented");
      notConsented++;
    } else {
      noRecord++;
    }
  }
  console.log(`fetchAllConsents: ${latestByContact.size} contacts — consented=${consented}, not_consented=${notConsented}, no_record=${noRecord}`);

  // Debug: log first few rows to verify parsing
  const sample = rows.slice(0, 3);
  for (const r of sample) {
    console.log(`  sample row: contactId="${r.contactId}" when="${r.when}" consented=${r.consented}`);
  }

  onProgress(1, 1, "Done");
  return consentMap;
}
