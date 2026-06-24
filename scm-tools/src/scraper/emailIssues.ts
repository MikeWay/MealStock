import type { Dialog, Page } from "playwright";
import { SCM_BASE_URL } from "../config.js";

export interface EmailIssue {
  name: string;
  email: string;
  problem: string;
}

export async function fetchEmailIssues(page: Page): Promise<EmailIssue[]> {
  // Navigate to home page and find the "Mailing issues" count in the summary table
  await page.goto(SCM_BASE_URL, { waitUntil: "networkidle" });

  const mailingRow = page.locator('td:has-text("Mailing issues")').first();
  try {
    await mailingRow.waitFor({ timeout: 10_000 });
  } catch {
    return []; // Summary table not present
  }

  // The sibling <td> contains the count as a link (or plain text "0")
  const countCell = mailingRow.locator("..").locator("td").nth(1);
  const countText = (await countCell.textContent())?.trim() ?? "0";
  const count = parseInt(countText, 10);

  if (!count || count === 0) {
    return []; // No mailing issues
  }

  // Follow the link to the filtered contacts page
  const link = countCell.locator("a").first();
  const href = (await link.getAttribute("href")) ?? "";
  const url = href.startsWith("http") ? href : new URL(href, SCM_BASE_URL).toString();
  await page.goto(url, { waitUntil: "networkidle" });

  // The contact list is populated by an AJAX call to /contacts/lookup.
  // Clear both lookup inputs (text + hidden) to avoid name-filtering, then trigger.
  await page.evaluate(() => {
    document.querySelectorAll<HTMLInputElement>("#theForm [name=lookup]").forEach(
      (el) => (el.value = "")
    );
    (window as unknown as { perform_lookup: () => void }).perform_lookup();
  });

  // Wait for at least one contact to appear
  try {
    await page.locator("#contact-list li").first().waitFor({ timeout: 15_000 });
  } catch {
    return [];
  }

  const items = page.locator("#contact-list li");
  const itemCount = await items.count();
  const issues: EmailIssue[] = [];

  const safeText = async (locator: ReturnType<typeof page.locator>) => {
    try {
      return (await locator.first().textContent({ timeout: 2_000 }))?.trim() ?? "";
    } catch {
      return "";
    }
  };

  for (let i = 0; i < itemCount; i++) {
    const li = items.nth(i);

    const name = await safeText(li.locator(".normal .name a"));
    const email = await safeText(li.locator(".flags .email a"));
    const problem = await safeText(li.locator(".mailing-error code"));

    if (name || email) {
      issues.push({ name, email, problem });
    }
  }

  return issues;
}

/**
 * Navigates to /mailings/issues and clicks the Reset button on every row,
 * accepting the confirmation dialog each time.
 * Returns the number of resets performed.
 */
export async function resetEmailIssues(page: Page): Promise<number> {
  await page.goto(`${SCM_BASE_URL}/mailings/issues`, { waitUntil: "networkidle" });

  const acceptDialog = (dialog: Dialog) => dialog.accept();
  page.on("dialog", acceptDialog);

  let resetCount = 0;

  try {
    // Re-query each iteration — the page may update after each reset
    while (true) {
      const btn = page
        .locator('input[type="submit"][value="Reset"], button:text-is("Reset")')
        .first();
      if ((await btn.count()) === 0) break;

      await btn.click();
      await page.waitForLoadState("networkidle");
      resetCount++;
    }
  } finally {
    page.off("dialog", acceptDialog);
  }

  return resetCount;
}
