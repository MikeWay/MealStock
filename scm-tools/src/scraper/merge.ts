import type { Page } from "playwright";
import { SCM_BASE_URL } from "../config.js";

export interface MergePreviewRow {
  field: string;
  primaryValue: string;
  mergedValue: string;
  secondaryValue: string;
  hasConflict: boolean;
}

export interface MergePreviewResult {
  success: boolean;
  warning?: string;   // non-blocking SCM alert to display
  rows: MergePreviewRow[];
  canProceed: boolean; // false only if "Merge now" button is absent
}

export interface MergeResult {
  success: boolean;
  message: string;
}

async function fetchLastLogin(page: Page, contactId: string): Promise<string | null> {
  await page.goto(`${SCM_BASE_URL}/contacts/${contactId}`, { waitUntil: "domcontentloaded" });
  return page.evaluate(() => {
    const text = document.body.innerText;
    const match = text.match(/last (?:logged[- ]?in|sign(?:ed)?[- ]?in)[^:\n]*:\s*([^\n]+)/i);
    return match ? match[1].trim() : null;
  });
}

async function contactHasLogin(page: Page, contactId: string): Promise<boolean> {
  await page.goto(`${SCM_BASE_URL}/contacts/${contactId}`, { waitUntil: "domcontentloaded" });
  const checkbox = page.locator("input#contact_login_enabled");
  return (await checkbox.count()) > 0 && (await checkbox.isChecked());
}

async function disableContactLogin(page: Page, contactId: string): Promise<void> {
  await page.goto(`${SCM_BASE_URL}/contacts/${contactId}`, { waitUntil: "domcontentloaded" });
  const checkbox = page.locator("input#contact_login_enabled");
  if ((await checkbox.count()) === 0) return;
  if (!(await checkbox.isChecked())) return; // already disabled
  await checkbox.uncheck();
  // Submit the form containing the checkbox
  await checkbox.evaluate((el) => (el.closest("form") as HTMLFormElement | null)?.submit());
  await page.waitForLoadState("domcontentloaded");
}

async function runMergePreview(
  page: Page,
  primaryId: string,
  secondaryId: string,
  secondaryName: string
): Promise<{ rows: MergePreviewRow[]; warning: string | null; canProceed: boolean }> {
  // Fetch last-login dates before navigating to the merge page
  const primaryLastLogin = await fetchLastLogin(page, primaryId);
  const secondaryLastLogin = await fetchLastLogin(page, secondaryId);

  await page.goto(`${SCM_BASE_URL}/contacts/${primaryId}/merge`, { waitUntil: "domcontentloaded" });

  await page.evaluate(
    ({ otherId, name }) => {
      const hiddenInput = document.querySelector<HTMLInputElement>('input[name="other_id"]');
      if (hiddenInput) hiddenInput.value = otherId;
      const nameInput = document.querySelector<HTMLInputElement>("input#contact");
      if (nameInput) nameInput.value = name;
    },
    { otherId: secondaryId, name: secondaryName }
  );

  await page.locator('input[type="submit"][value="Preview merge"]').click();
  await page.waitForLoadState("domcontentloaded");

  // Collect any SCM alert as a warning (shown to user but not blocking)
  let warning: string | null = null;
  const errorAlert = page.locator(".ui-alert.ui-danger");
  if ((await errorAlert.count()) > 0) {
    warning = (await errorAlert.first().textContent())?.trim() ?? null;
  }

  // Whether SCM allows proceeding is determined by presence of "Merge now" button
  const mergeNowBtn = page.locator('input[type="submit"][value="Merge now"]');
  const canProceed = (await mergeNowBtn.count()) > 0;

  const rows = await page.evaluate(() => {
    const table = document.querySelector("table.standard");
    if (!table) return [] as { field: string; primaryValue: string; mergedValue: string; secondaryValue: string; hasConflict: boolean }[];
    const result: { field: string; primaryValue: string; mergedValue: string; secondaryValue: string; hasConflict: boolean }[] = [];
    table.querySelectorAll("tbody tr").forEach((row) => {
      const cells = row.querySelectorAll("td");
      if (cells.length < 3) return;
      const leftLines = (cells[0].textContent?.trim() ?? "").split("\n").map(s => s.trim()).filter(s => s);
      const mergeLines = (cells[1].textContent?.trim() ?? "").split("\n").map(s => s.trim()).filter(s => s);
      const rightLines = (cells[2].textContent?.trim() ?? "").split("\n").map(s => s.trim()).filter(s => s);
      const field = leftLines[0] || mergeLines[0] || rightLines[0] || "";
      const primaryValue = leftLines.slice(1).join(" ").trim();
      const mergedValue = mergeLines.slice(1).join(" ").trim();
      const secondaryValue = rightLines.slice(1).join(" ").trim();
      const hasConflict = !!secondaryValue && !!primaryValue && secondaryValue !== primaryValue && !mergedValue.includes(secondaryValue);
      result.push({ field, primaryValue, mergedValue, secondaryValue, hasConflict });
    });
    return result;
  });

  // If both contacts have a login email and we have last-login dates, insert a row after "Login"
  const loginIdx = rows.findIndex(r => r.field.toLowerCase().includes("login"));
  if (loginIdx >= 0 && rows[loginIdx].primaryValue && rows[loginIdx].secondaryValue && (primaryLastLogin || secondaryLastLogin)) {
    rows.splice(loginIdx + 1, 0, {
      field: "Last logged in",
      primaryValue: primaryLastLogin ?? "",
      mergedValue: "",
      secondaryValue: secondaryLastLogin ?? "",
      hasConflict: false,
    });
  }

  return { rows, warning, canProceed };
}

export async function previewMerge(
  page: Page,
  primaryId: string,
  secondaryId: string,
  secondaryName: string
): Promise<MergePreviewResult> {
  const { rows, warning, canProceed } = await runMergePreview(page, primaryId, secondaryId, secondaryName);
  return { success: true, warning: warning ?? undefined, rows, canProceed };
}

async function cleanupDuplicateFields(page: Page, contactId: string): Promise<string[]> {
  await page.goto(`${SCM_BASE_URL}/contacts/${contactId}/edit`, { waitUntil: "domcontentloaded" });

  const cleared = await page.evaluate(() => {
    const fieldsCleared: string[] = [];

    function dedupe(
      inputs: HTMLInputElement[],
      normalize: (s: string) => string,
      label: string
    ): void {
      const seen = new Set<string>();
      inputs.forEach(input => {
        const val = input.value.trim();
        if (!val) return;
        const key = normalize(val);
        if (seen.has(key)) {
          input.value = "";
          fieldsCleared.push(`${label} (${val})`);
        } else {
          seen.add(key);
        }
      });
    }

    // Email
    dedupe(
      Array.from(document.querySelectorAll<HTMLInputElement>('input[name*="email"]')),
      s => s.toLowerCase(),
      "email"
    );

    // Phone / mobile / fax
    dedupe(
      Array.from(document.querySelectorAll<HTMLInputElement>('input[name*="phone"], input[name*="mobile"], input[name*="fax"]')),
      s => s.replace(/[\s\-().+]/g, ""),
      "phone"
    );

    // Addresses: compare each block by normalised street + postcode
    // SCM uses indexed address fields: street, post_code / street2, post_code2 etc.
    type AddrBlock = { streetEl: HTMLInputElement | null; postcodeEl: HTMLInputElement | null };
    const blocks: AddrBlock[] = [
      { streetEl: document.querySelector<HTMLInputElement>('input[name*="[street]"]'),   postcodeEl: document.querySelector<HTMLInputElement>('input[name*="[post_code]"]') },
      { streetEl: document.querySelector<HTMLInputElement>('input[name*="[street2]"]'),  postcodeEl: document.querySelector<HTMLInputElement>('input[name*="[post_code2]"]') },
      { streetEl: document.querySelector<HTMLInputElement>('input[name*="[street3]"]'),  postcodeEl: document.querySelector<HTMLInputElement>('input[name*="[post_code3]"]') },
      { streetEl: document.querySelector<HTMLInputElement>('input[name*="[street4]"]'),  postcodeEl: document.querySelector<HTMLInputElement>('input[name*="[post_code4]"]') },
    ].filter(b => b.streetEl || b.postcodeEl);

    const seenAddresses = new Set<string>();
    blocks.forEach(block => {
      const street = (block.streetEl?.value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
      const postcode = (block.postcodeEl?.value ?? "").toLowerCase().replace(/\s+/g, "");
      if (!street && !postcode) return;
      const key = `${street}|${postcode}`;
      if (seenAddresses.has(key)) {
        if (block.streetEl) block.streetEl.value = "";
        if (block.postcodeEl) block.postcodeEl.value = "";
        fieldsCleared.push(`address (${block.streetEl?.value || postcode})`);
      } else {
        seenAddresses.add(key);
      }
    });

    return fieldsCleared;
  });

  if (cleared.length > 0) {
    const submitBtn = page.locator('input[type="submit"][name*="commit"], input[type="submit"]').first();
    if ((await submitBtn.count()) > 0) {
      await submitBtn.click();
      await page.waitForLoadState("domcontentloaded");
    }
  }

  return cleared;
}

export async function mergeContacts(
  page: Page,
  primaryId: string,
  secondaryId: string,
  secondaryName: string
): Promise<MergeResult> {
  // If both contacts have logins, disable the secondary's before merging
  const primaryHasLogin = await contactHasLogin(page, primaryId);
  const secondaryHasLogin = await contactHasLogin(page, secondaryId);
  if (primaryHasLogin && secondaryHasLogin) {
    await disableContactLogin(page, secondaryId);
  }

  const { canProceed, warning } = await runMergePreview(page, primaryId, secondaryId, secondaryName);
  if (!canProceed) {
    return {
      success: false,
      message: warning ?? "SCM did not offer a Merge option for these contacts.",
    };
  }

  page.once("dialog", (dialog) => dialog.accept());
  await page.locator('input[type="submit"][value="Merge now"]').click();
  await page.waitForLoadState("networkidle");

  const finalUrl = page.url();

  // A successful merge redirects away from the merge page
  if (!finalUrl.includes(`/contacts/${primaryId}/merge`)) {
    let cleanupNote = "";
    try {
      const cleaned = await cleanupDuplicateFields(page, primaryId);
      cleanupNote = cleaned.length > 0 ? ` Removed duplicate fields: ${cleaned.join(", ")}.` : "";
    } catch {
      // cleanup is best-effort; don't fail the merge if it errors
    }
    return {
      success: true,
      message: `Successfully merged ${secondaryName} into primary contact.${cleanupNote}`,
    };
  }

  // Still on the merge page — check for an error message to surface
  const errorAlert = page.locator(".ui-alert.ui-danger, .flash-error, .alert-error");
  if ((await errorAlert.count()) > 0) {
    const errorText = (await errorAlert.first().textContent())?.trim() ?? "Unknown error";
    return { success: false, message: `SCM reported an error: ${errorText}` };
  }

  return { success: false, message: "Merge did not complete — SCM stayed on the merge page." };
}
