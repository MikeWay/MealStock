import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { Page } from "playwright";
import { SCM_BASE_URL } from "../config.js";

// Holds the page that has been prepared but not yet confirmed
let pendingPage: Page | null = null;
let pendingTempFile: string | null = null;

export async function prepareContactNamesImport(
  page: Page,
  csvContent: string
): Promise<{ success: boolean; message: string }> {
  // Cancel any prior pending import
  await cancelPendingImport();

  const tempFile = join(tmpdir(), `name-repair-${Date.now()}.csv`);
  writeFileSync(tempFile, csvContent, "utf-8");
  pendingTempFile = tempFile;

  try {
    // Step 1: Go to contacts page and click the Import link
    await page.goto(`${SCM_BASE_URL}/contacts`, { waitUntil: "domcontentloaded" });
    await page.locator('a.btn[href="/import"]').click();
    await page.waitForLoadState("domcontentloaded");

    // Step 2: Select Contacts / Memberships (Classic)
    await page.locator("input#type_contact_mem").check();

    // Step 3: Upload the CSV file
    await page.locator('input[type="file"]').setInputFiles(tempFile);

    // Step 4: Click Begin
    await page.locator('input[type="submit"][value="Begin"]').click();
    await page.waitForLoadState("domcontentloaded");

    // Step 5: Select the duplicate-handling option (value="2")
    await page.locator("input#ignore_dupes_2").check();

    // Step 6: Skip first (header) row
    const skipFirst = page.getByLabel(/skip first/i);
    if ((await skipFirst.count()) > 0) {
      await skipFirst.first().check();
    }

    // Park the page — caller must NOT close it
    pendingPage = page;
    return { success: true, message: "Import prepared. Review the browser window and confirm." };
  } catch (err) {
    cleanupTempFile();
    throw err;
  }
}

export async function confirmContactNamesImport(): Promise<{ success: boolean; message: string }> {
  if (!pendingPage) {
    return { success: false, message: "No import is prepared. Run prepare first." };
  }

  const page = pendingPage;
  pendingPage = null;

  try {
    await page.locator('input[type="submit"][value="Import"]').click();
    await page.waitForLoadState("networkidle");

    const errorAlert = page.locator(".ui-alert.ui-danger, .flash-error, .alert-error");
    if ((await errorAlert.count()) > 0) {
      const msg = (await errorAlert.first().textContent())?.trim() ?? "Import failed";
      return { success: false, message: `SCM reported an error: ${msg}` };
    }

    return { success: true, message: "Contact names imported successfully." };
  } finally {
    cleanupTempFile();
    await page.close();
  }
}

export async function cancelPendingImport(): Promise<void> {
  if (pendingPage) {
    const page = pendingPage;
    pendingPage = null;
    await page.close();
  }
  cleanupTempFile();
}

export async function applyContactNamesFixes(
  page: Page,
  csvContent: string
): Promise<{ success: boolean; message: string }> {
  const tempFile = join(tmpdir(), `name-repair-${Date.now()}.csv`);
  writeFileSync(tempFile, csvContent, "utf-8");

  try {
    await page.goto(`${SCM_BASE_URL}/contacts`, { waitUntil: "domcontentloaded" });
    await page.locator('a.btn[href="/import"]').click();
    await page.waitForLoadState("domcontentloaded");

    await page.locator("input#type_contact_mem").check();
    await page.locator('input[type="file"]').setInputFiles(tempFile);
    await page.locator('input[type="submit"][value="Begin"]').click();
    await page.waitForLoadState("domcontentloaded");

    await page.locator("input#ignore_dupes_2").check();
    const skipFirst = page.getByLabel(/skip first/i);
    if ((await skipFirst.count()) > 0) {
      await skipFirst.first().check();
    }

    await page.locator('input[type="submit"][value="Import"]').click();
    await page.waitForLoadState("networkidle");

    const errorAlert = page.locator(".ui-alert.ui-danger, .flash-error, .alert-error");
    if ((await errorAlert.count()) > 0) {
      const msg = (await errorAlert.first().textContent())?.trim() ?? "Import failed";
      return { success: false, message: `SCM reported an error: ${msg}` };
    }

    return { success: true, message: "Contact name fixes applied successfully." };
  } finally {
    try { unlinkSync(tempFile); } catch { /* ignore */ }
    await page.close();
  }
}

function cleanupTempFile(): void {
  if (pendingTempFile) {
    try { unlinkSync(pendingTempFile); } catch { /* ignore */ }
    pendingTempFile = null;
  }
}
