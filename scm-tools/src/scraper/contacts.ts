import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "fs";
import path from "path";
import type { Page } from "playwright";
import { SCM_BASE_URL } from "../config.js";

export interface Contact {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  tags: string[];
  dob: string;
  membershipStatus: string;
  membershipStart: string;
  membershipEnd: string;
}

const CACHE_DIR = ".cache";
const IGNORE_FILE = path.join(CACHE_DIR, "name-repair-ignored.json");

export interface IgnoredContactRecord {
  contactId: string;
  name: string;
  ignoredAt: string;
}

export function loadIgnoredContacts(): IgnoredContactRecord[] {
  if (!existsSync(IGNORE_FILE)) return [];
  try { return JSON.parse(readFileSync(IGNORE_FILE, "utf-8")) as IgnoredContactRecord[]; }
  catch { return []; }
}

export function setContactIgnored(contactId: string, name: string, ignored: boolean): void {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  const records = loadIgnoredContacts();
  if (ignored) {
    if (!records.find(r => r.contactId === contactId)) {
      records.push({ contactId, name, ignoredAt: new Date().toISOString() });
    }
  } else {
    const idx = records.findIndex(r => r.contactId === contactId);
    if (idx >= 0) records.splice(idx, 1);
  }
  writeFileSync(IGNORE_FILE, JSON.stringify(records, null, 2), "utf-8");
}

const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function getContactsCacheInfo(): { exists: boolean; ageMs: number; stale: boolean } {
  if (!existsSync(CACHE_DIR)) return { exists: false, ageMs: Infinity, stale: true };
  const files = readdirSync(CACHE_DIR)
    .filter(f => f.startsWith("contact-export") && f.endsWith(".csv"))
    .sort().reverse();
  if (files.length === 0) return { exists: false, ageMs: Infinity, stale: true };
  const ageMs = Date.now() - statSync(path.join(CACHE_DIR, files[0])).mtimeMs;
  return { exists: true, ageMs, stale: ageMs > CACHE_MAX_AGE_MS };
}

/**
 * Loads contacts from the most recent cached CSV without hitting SCM.
 * Returns null if no cache files exist.
 */
export function loadContactsFromCache(): Contact[] | null {
  if (!existsSync(CACHE_DIR)) return null;
  const files = readdirSync(CACHE_DIR)
    .filter((f) => f.startsWith("contact-export") && f.endsWith(".csv"))
    .sort()
    .reverse();
  if (files.length === 0) return null;
  const csvContent = readFileSync(path.join(CACHE_DIR, files[0]), "utf-8");
  return parseCsv(csvContent);
}

/** Removes all cached contact export CSVs. */
export function clearContactsCache(): number {
  if (!existsSync(CACHE_DIR)) return 0;
  const files = readdirSync(CACHE_DIR).filter((f) => f.startsWith("contact-export") && f.endsWith(".csv"));
  for (const f of files) {
    unlinkSync(path.join(CACHE_DIR, f));
  }
  return files.length;
}

/** Removes a contact row by ID from the most recent cached CSV. */
export function removeContactFromCache(contactId: string): void {
  if (!existsSync(CACHE_DIR)) return;
  const files = readdirSync(CACHE_DIR)
    .filter((f) => f.startsWith("contact-export") && f.endsWith(".csv"))
    .sort()
    .reverse();
  if (files.length === 0) return;

  const filePath = path.join(CACHE_DIR, files[0]);
  const csvContent = readFileSync(filePath, "utf-8");
  const lines = csvContent.split("\n");
  if (lines.length < 2) return;

  const header = parseRow(lines[0]);
  const uidIdx = header.indexOf("uid");
  if (uidIdx < 0) return;

  const newLines = lines.filter((line, i) => {
    if (i === 0 || !line.trim()) return true;
    return parseRow(line)[uidIdx] !== contactId;
  });

  if (newLines.length !== lines.length) {
    writeFileSync(filePath, newLines.join("\n"), "utf-8");
  }
}

/**
 * Adds a tag to a contact's tags field in the most recent cached CSV.
 * No-ops if no cache exists or the contact/tag is not found.
 */
export function addTagToContactInCache(contactId: string, tag: string): void {
  if (!existsSync(CACHE_DIR)) return;
  const files = readdirSync(CACHE_DIR)
    .filter((f) => f.startsWith("contact-export") && f.endsWith(".csv"))
    .sort()
    .reverse();
  if (files.length === 0) return;

  const filePath = path.join(CACHE_DIR, files[0]);
  const csvContent = readFileSync(filePath, "utf-8");
  const lines = csvContent.split("\n");
  if (lines.length < 2) return;

  const header = parseRow(lines[0]);
  const uidIdx = header.indexOf("uid");
  const tagsIdx = header.indexOf("tags");
  if (uidIdx < 0 || tagsIdx < 0) return;

  let changed = false;
  const newLines = lines.map((line, i) => {
    if (i === 0 || !line.trim()) return line;
    const fields = parseRow(line);
    if ((fields[uidIdx] ?? "") !== contactId) return line;
    const tagsRaw = fields[tagsIdx] ?? "";
    const existing = tagsRaw.split(/[,/]/).map((t) => t.trim()).filter(Boolean);
    if (existing.some((t) => t.toLowerCase() === tag.toLowerCase())) return line;
    fields[tagsIdx] = tagsRaw ? `${tagsRaw}/${tag}` : tag;
    changed = true;
    return fields.map((f) =>
      f.includes(",") || f.includes('"') || f.includes("\n")
        ? `"${f.replace(/"/g, '""')}"` : f
    ).join(",");
  });

  if (changed) writeFileSync(filePath, newLines.join("\n"), "utf-8");
}

/**
 * Exports all contacts via SCM's CSV export and parses the result.
 * Caches the downloaded CSV locally to avoid re-exporting on repeated calls.
 *
 * Flow: select all contacts → export → queue for download → poll job
 * queue → download CSV → parse.
 */
export async function fetchContacts(page: Page, onPollAttempt?: (attempt: number) => void): Promise<Contact[]> {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const cacheFile = path.join(CACHE_DIR, `contact-export${today}.csv`);

  // Use cached CSV if available
  if (existsSync(cacheFile)) {
    console.log(`Using cached contacts export: ${cacheFile}`);
    const csvContent = readFileSync(cacheFile, "utf-8");
    return parseCsv(csvContent);
  }

  // Step 1: Navigate to contacts, reset any active filter, and select all
  await page.goto(`${SCM_BASE_URL}/contacts`, { waitUntil: "networkidle" });
  await page.locator("ul.contacts").waitFor({ timeout: 15_000 });

  // If a filter is active, click the reset link to ensure we export all contacts
  const filterForm = page.locator("#filter-form");
  if ((await filterForm.count()) > 0) {
    const resetLink = filterForm.locator('li#reset a');
    if ((await resetLink.count()) > 0) {
      await resetLink.click();
      await page.waitForLoadState("networkidle");
      await page.locator("ul.contacts").waitFor({ timeout: 15_000 });
    }
  }

  await page.evaluate(() => (window as any).select_all_contacts());
  await page.waitForTimeout(300);
  await page.evaluate(() => (window as any).global_select_all());
  await page.waitForTimeout(300);

  // Step 2: Choose "Export" from the actions dropdown and click Go
  await page.locator("#do_action").selectOption("export");
  await page.waitForTimeout(300);
  await page.locator('#contact-actions input[type="submit"]').click();
  await page.waitForLoadState("domcontentloaded");

  // Step 3: On the export config page, select extra fields then queue
  await page.locator("#submit_button").waitFor({ timeout: 10_000 });
  await page.locator("#export_tags").check();
  await page.locator("#export_dob").check();
  await page.locator("#export_mem_started").check();
  await page.locator("#export_mem_ending").check();
  await page.locator("#export_mem_status").check();
  await page.locator("#submit_button").click();
  await page.waitForLoadState("domcontentloaded");

  // Step 4: Poll /active_jobs until the CSV is ready
  const csvFilename = await waitForExportReady(page, 5 * 60_000, 5_000, onPollAttempt);

  // Step 5: Download the CSV by clicking its link
  const csvContent = await downloadExport(page, csvFilename);

  // Step 6: Cache the CSV for later reuse
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cacheFile, csvContent, "utf-8");
  console.log(`Cached contacts export to: ${cacheFile}`);

  // Step 7: Parse the CSV
  return parseCsv(csvContent);
}

async function waitForExportReady(
  page: Page,
  maxWaitMs = 5 * 60_000,
  pollIntervalMs = 5_000,
  onPollAttempt?: (attempt: number) => void
): Promise<string> {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const expectedPrefix = `contact-export${today}`;

  const deadline = Date.now() + maxWaitMs;
  let attempt = 0;

  while (Date.now() < deadline) {
    await page.goto(`${SCM_BASE_URL}/active_jobs`, {
      waitUntil: "domcontentloaded",
    });

    // Look for a download link matching today's export in the "Ready" table
    const link = page.locator(`a:has-text("${expectedPrefix}")`).first();
    if ((await link.count()) > 0) {
      const text = (await link.textContent())?.trim() ?? "";
      return text;
    }

    attempt++;
    onPollAttempt?.(attempt);
    await page.waitForTimeout(pollIntervalMs);
  }

  throw new Error("Timed out waiting for contact export to be ready");
}

async function downloadExport(page: Page, filename: string): Promise<string> {
  await page.goto(`${SCM_BASE_URL}/active_jobs`, {
    waitUntil: "domcontentloaded",
  });

  const link = page.locator(`a:has-text("${filename}")`).first();
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 30_000 }),
    link.click(),
  ]);

  const filePath = await download.path();
  if (!filePath) throw new Error("Download failed — no file path");
  const content = readFileSync(filePath, "utf-8");

  // Clean up the export job from SCM's active_jobs
  await page.goto(`${SCM_BASE_URL}/active_jobs`, { waitUntil: "domcontentloaded" });
  const row = page.locator(`tr:has(a:has-text("${filename}"))`).first();
  if ((await row.count()) > 0) {
    const forgetForm = row.locator('form[id^="forget"]').first();
    if ((await forgetForm.count()) > 0) {
      await forgetForm.evaluate((f) => (f as HTMLFormElement).submit());
      await page.waitForLoadState("domcontentloaded");
    }
  }

  return content;
}

function parseCsv(csv: string): Contact[] {
  const lines = csv.split("\n");
  if (lines.length < 2) return [];

  const header = parseRow(lines[0]);
  const col = (name: string) => header.indexOf(name);

  const uidIdx = col("uid");
  const firstIdx = col("first_name");
  const lastIdx = col("last_name");
  const emailIdx = col("email");
  const phoneIdx = col("phone");
  const mobileIdx = col("mobile");
  const streetIdx = col("street");
  const cityIdx = col("city");
  const countyIdx = col("county");
  const postCodeIdx = col("post_code");
  const tagsIdx = col("tags");
  const dobIdx = col("birthday");
  const membershipStatusIdx = col("membership_status");
  const membershipStartIdx = col("membership_started");
  const membershipEndIdx = col("membership_ending");

  const contacts: Contact[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const fields = parseRow(line);
    const first = fields[firstIdx] ?? "";
    const last = fields[lastIdx] ?? "";
    const name = [first, last].filter(Boolean).join(" ");
    if (!name) continue;

    const phone = fields[mobileIdx] || fields[phoneIdx] || "";
    const addressParts = [
      fields[streetIdx],
      fields[cityIdx],
      fields[countyIdx],
      fields[postCodeIdx],
    ].filter(Boolean);

    const tagsRaw = tagsIdx >= 0 ? (fields[tagsIdx] ?? "") : "";
    const tags = tagsRaw
      ? tagsRaw.split(/[,/]/).map((t) => t.trim()).filter(Boolean)
      : [];

    const dob = dobIdx >= 0 ? (fields[dobIdx] ?? "") : "";
    const membershipStatus = membershipStatusIdx >= 0 ? (fields[membershipStatusIdx] ?? "") : "";
    const membershipStart = membershipStartIdx >= 0 ? (fields[membershipStartIdx] ?? "") : "";
    const membershipEnd = membershipEndIdx >= 0 ? (fields[membershipEndIdx] ?? "") : "";

    contacts.push({
      id: fields[uidIdx] ?? "",
      name,
      firstName: first,
      lastName: last,
      email: fields[emailIdx] ?? "",
      phone,
      address: addressParts.join(", "),
      tags,
      dob,
      membershipStatus,
      membershipStart,
      membershipEnd,
    });
  }

  return contacts;
}

export function countContactNameIssues(contacts: Contact[], ignoredIds?: Set<string>): number {
  function toProperCase(value: string, isLastName: boolean): string {
    if (value.length === 0) return value;
    let s = value.toLowerCase();
    s = s[0].toUpperCase() + s.slice(1);
    s = s.replace(/ ([a-z])/g, (_m, c: string) => " " + c.toUpperCase());
    s = s.replace(/-([a-z])/g, (_m, c: string) => "-" + c.toUpperCase());
    s = s.replace(/'([a-z])/g, (_m, c: string) => "'" + c.toUpperCase());
    if (isLastName) {
      s = s.replace(/^Mc([a-z])/, (_m, c: string) => "Mc" + c.toUpperCase());
      s = s.replace(/^Mac([a-z])/, (_m, c: string) => "Mac" + c.toUpperCase());
    }
    return s;
  }
  function hasIssue(val: string, isLastName: boolean): boolean {
    const trimmed = val.trim();
    if (val !== trimmed) return true;
    return trimmed.length > 0 && trimmed !== toProperCase(trimmed, isLastName);
  }
  return contacts.filter(c =>
    !ignoredIds?.has(c.id) &&
    (hasIssue(c.firstName, false) || hasIssue(c.lastName, true))
  ).length;
}

/** Simple CSV row parser that handles quoted fields with commas and escaped quotes. */
function parseRow(line: string): string[] {
  const fields: string[] = [];
  let i = 0;
  while (i <= line.length) {
    if (i === line.length) {
      fields.push("");
      break;
    }
    if (line[i] === '"') {
      // Quoted field
      let value = "";
      i++; // skip opening quote
      while (i < line.length) {
        if (line[i] === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') {
            value += '"';
            i += 2;
          } else {
            i++; // skip closing quote
            break;
          }
        } else {
          value += line[i];
          i++;
        }
      }
      fields.push(value);
      if (i < line.length && line[i] === ",") i++; // skip comma
    } else {
      // Unquoted field
      const commaIdx = line.indexOf(",", i);
      if (commaIdx === -1) {
        fields.push(line.substring(i));
        break;
      } else {
        fields.push(line.substring(i, commaIdx));
        i = commaIdx + 1;
      }
    }
  }
  return fields;
}
