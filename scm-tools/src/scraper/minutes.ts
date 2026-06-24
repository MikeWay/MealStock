import type { Page } from "playwright";
import { SCM_BASE_URL } from "../config.js";

export interface MinutesSection {
  heading: string;
  description?: string;
  links: Array<{ text: string; url: string }>;
}

function toDate(year: number, month: number, day: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900 || year > 2099) return null;
  return new Date(year, month - 1, day);
}

// Parse a date from a filename. Handles dd/mm/yy(yy) with separators - or .
// or no separator, and yyyy/mm/dd variants. Date may be embedded in a longer name.
export function parseDateFromFilename(filename: string): Date | null {
  const stem = filename.replace(/\.pdf$/i, "");

  // yyyy[sep]mm[sep]dd with - . or _
  let m = stem.match(/(\d{4})[.\-_](\d{1,2})[.\-_](\d{1,2})/);
  if (m) { const d = toDate(+m[1], +m[2], +m[3]); if (d) return d; }

  // dd[sep]mm[sep]yyyy with - . or _
  m = stem.match(/(\d{1,2})[.\-_](\d{1,2})[.\-_](\d{4})/);
  if (m) { const d = toDate(+m[3], +m[2], +m[1]); if (d) return d; }

  // dd[sep]mm[sep]yy with - . or _ (1 or 2 digit day/month)
  m = stem.match(/(\d{1,2})[.\-_](\d{1,2})[.\-_](\d{2})(?!\d)/);
  if (m) {
    const yy = +m[3];
    const d = toDate(yy >= 70 ? 1900 + yy : 2000 + yy, +m[2], +m[1]);
    if (d) return d;
  }

  // No separator — find an isolated run of exactly 8 digits
  m = stem.match(/(?<!\d)(\d{8})(?!\d)/);
  if (m) {
    const s = m[1];
    const d1 = toDate(+s.slice(0, 4), +s.slice(4, 6), +s.slice(6, 8)); // yyyymmdd
    if (d1) return d1;
    const d2 = toDate(+s.slice(4, 8), +s.slice(2, 4), +s.slice(0, 2)); // ddmmyyyy
    if (d2) return d2;
  }

  // No separator — isolated run of exactly 6 digits: ddmmyy
  m = stem.match(/(?<!\d)(\d{6})(?!\d)/);
  if (m) {
    const s = m[1];
    const yy = +s.slice(4, 6);
    const d = toDate(yy >= 70 ? 1900 + yy : 2000 + yy, +s.slice(2, 4), +s.slice(0, 2));
    if (d) return d;
  }

  return null;
}

// Return link text in dd-mm-yyyy form from a filename, or filename stem if unparseable
export function linkTextFromFilename(filename: string): string {
  const date = parseDateFromFilename(filename);
  if (!date) return filename.replace(/\.pdf$/i, "");
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${date.getFullYear()}`;
}

export async function regenerateMinutesPage(
  page: Page,
  scmPageUrl: string,
  sections: MinutesSection[]
): Promise<void> {
  const url = scmPageUrl.startsWith("http")
    ? scmPageUrl
    : SCM_BASE_URL + scmPageUrl;

  await page.goto(url, { waitUntil: "domcontentloaded" });

  // Derive year from first parseable filename across all sections
  let year: number | null = null;
  outer: for (const section of sections) {
    for (const link of section.links) {
      const filename = link.url.split("/").pop() ?? "";
      const date = parseDateFromFilename(filename);
      if (date) { year = date.getFullYear(); break outer; }
    }
  }

  // Try to set the page title/heading field
  if (year !== null) {
    const titleInput = page
      .locator('input[name="cms_content[heading]"], input#cms_content_heading')
      .first();
    if (await titleInput.count() > 0) {
      await titleInput.fill(`Committee Meeting Minutes ${year}`);
    }
  }

  const textareaLocator = page
    .locator('#cms_content_content, textarea[name="cms_content[content]"]')
    .first();
  await textareaLocator.waitFor();

  // Build Textile content: h3 bold heading + optional description + links per section
  const sectionText = sections
    .map((s) => {
      const heading = `h3. *${s.heading}*`;
      const desc = s.description ? `\n\n${s.description}` : "";
      const links = s.links.map((l) => `"${l.text}":${l.url}`).join("\n");
      return `${heading}${desc}\n\n${links}`;
    })
    .join("\n\n<hr/>\n\n");

  const footer =
    `\n\n"Previous year's minutes":https://exe-sailing-club.org/untitled/committee-meeting-minutes-2025`;

  await textareaLocator.fill(sectionText + footer);

  await page.click(
    'input[type="submit"][value="Update"], input[type="submit"][value="Save"]'
  );

  const errorAlert = page.locator(".ui-alert.ui-danger");
  if (await errorAlert.count() > 0) {
    const msg = await errorAlert.textContent();
    throw new Error(`SCM reported an error: ${msg?.trim()}`);
  }
}
