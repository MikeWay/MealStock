import type { Page } from "playwright";
import { SCM_BASE_URL } from "../config.js";

export interface Application {
  status: string;
  name: string;
  memberships: string;
  period: string;
  proposer: string;
  seconder: string;
  approver: string;
  concession: string;
  giftAid: string;
  additionalMembers: string;
  personalDetails: string;
  confirmations: string;
  consent: string;
  supportingInformation: string;
}

async function collectAppLinks(page: Page, seen: Set<string>, results: string[]): Promise<void> {
  const links = await page.evaluate((base) => {
    const out: string[] = [];
    for (const a of Array.from(document.querySelectorAll("a[href]"))) {
      const href = a.getAttribute("href") ?? "";
      const full = href.startsWith("http") ? href : base + href;
      if (/\/apps\/\d+/.test(full)) out.push(full);
    }
    return out;
  }, SCM_BASE_URL);
  for (const l of links) {
    if (!seen.has(l)) { seen.add(l); results.push(l); }
  }
}

export async function fetchApplications(
  page: Page,
  onApplication: (app: Application) => void,
): Promise<void> {
  await page.goto(`${SCM_BASE_URL}/apps`, { waitUntil: "domcontentloaded" });

  // Discover all paginated page URLs from the pagination nav
  const pageUrls = await page.evaluate((base) => {
    const nav = document.querySelector('[role="navigation"][aria-label="Pagination"]');
    if (!nav) return [] as string[];
    const seen = new Set<string>();
    const results: string[] = [];
    for (const a of Array.from(nav.querySelectorAll("a[href]"))) {
      const href = a.getAttribute("href") ?? "";
      if (!/[?&]page=\d+/.test(href)) continue;
      const full = href.startsWith("http") ? href : base + href;
      if (!seen.has(full)) { seen.add(full); results.push(full); }
    }
    return results;
  }, SCM_BASE_URL);

  // Collect all application detail URLs across every page
  const seen = new Set<string>();
  const hrefs: string[] = [];
  await collectAppLinks(page, seen, hrefs);
  for (const pageUrl of pageUrls) {
    await page.goto(pageUrl, { waitUntil: "domcontentloaded" });
    await collectAppLinks(page, seen, hrefs);
  }

  // Scrape each detail page and call onApplication immediately
  for (const url of hrefs) {
    await page.goto(url, { waitUntil: "domcontentloaded" });

    const app = await page.evaluate(() => {
      function clean(s: string | null | undefined): string {
        const t = (s ?? "").trim().replace(/\s+/g, " ");
        return t === "-" || t === "–" || t === "—" ? "" : t;
      }

      function tryFind(...labelVariants: string[]): string {
        for (const labelText of labelVariants) {
          const lower = labelText.toLowerCase();

          for (const dt of Array.from(document.querySelectorAll("dt"))) {
            if (dt.textContent?.trim().toLowerCase().includes(lower)) {
              const dd = dt.nextElementSibling;
              if (dd?.tagName === "DD") return clean(dd.textContent);
            }
          }
          for (const th of Array.from(document.querySelectorAll("th"))) {
            if (th.textContent?.trim().toLowerCase().includes(lower)) {
              const td = th.nextElementSibling;
              if (td?.tagName === "TD") return clean(td.textContent);
            }
          }
          for (const el of Array.from(document.querySelectorAll("label, strong, b, .label, .field-label"))) {
            if (el.textContent?.trim().toLowerCase().includes(lower)) {
              const next = el.nextElementSibling ?? el.parentElement?.nextElementSibling;
              if (next) {
                const v = clean(next.textContent);
                if (v) return v;
              }
            }
          }
        }
        return "";
      }

      return {
        status:                tryFind("current status", "status"),
        name:                  tryFind("name"),
        memberships:           tryFind("memberships", "membership"),
        period:                tryFind("period"),
        proposer:              tryFind("proposer"),
        seconder:              tryFind("seconder"),
        approver:              tryFind("approver"),
        concession:            tryFind("concession"),
        giftAid:               tryFind("gift-aid", "gift aid"),
        additionalMembers:     tryFind("additional members"),
        personalDetails:       tryFind("personal details"),
        confirmations:         tryFind("confirmations"),
        consent:               tryFind("consent"),
        supportingInformation: tryFind("supporting information"),
      };
    });

    onApplication(app);
  }
}
