import type { Page } from "playwright";
import { SCM_BASE_URL } from "../config.js";

export async function addTagToContact(page: Page, contactId: string, tag: string): Promise<void> {
  await page.goto(`${SCM_BASE_URL}/contacts/${contactId}`, { waitUntil: "domcontentloaded" });

  // Check if the tag is already present
  const existingTags = await page.locator('.contact-tags .tag, .tags .tag, [class*="tag"]').allTextContents();
  if (existingTags.some(t => t.trim().toLowerCase() === tag.toLowerCase())) {
    return;
  }

  // Open the inline tag editor
  await page.locator('a.tag-button:has-text("Edit tags")').click();

  const tagInput = page.locator('#tag');
  await tagInput.waitFor({ state: "visible", timeout: 5_000 });
  await tagInput.fill(tag);

  // Wait for autocomplete and pick the exact match if available
  await page.waitForTimeout(700);
  const autocompleteItems = page.locator('.ui-autocomplete li.ui-menu-item');
  if (await autocompleteItems.count() > 0) {
    const match = autocompleteItems.filter({ hasText: new RegExp(`^${tag}$`, "i") }).first();
    const target = (await match.count() > 0) ? match : autocompleteItems.first();
    await target.click();
    await page.waitForTimeout(300);
  }

  // Click the Add button scoped to the edit_tags form
  await page.locator('#edit_tags a.btn.btn-mini:has-text("Add")').click();
  await page.waitForTimeout(500);
}
