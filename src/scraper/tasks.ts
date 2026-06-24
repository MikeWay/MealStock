import type { Page } from "playwright";
import { SCM_BASE_URL } from "../config.js";

export interface AttentionItem {
  text: string;
  url: string;
}

export async function fetchAttentionItems(
  page: Page
): Promise<AttentionItem[]> {
  await page.goto(SCM_BASE_URL, { waitUntil: "domcontentloaded" });

  // Locate the "In need of attention" heading, then extract links from its parent container
  const heading = page.locator('h2:has-text("In need of attention")');
  await heading.waitFor({ timeout: 10_000 });

  const container = heading.locator("..");
  const links = container.locator("a");

  const count = await links.count();
  const items: AttentionItem[] = [];

  for (let i = 0; i < count; i++) {
    const link = links.nth(i);
    const text = (await link.textContent())?.trim() ?? "";
    const href = (await link.getAttribute("href")) ?? "";
    if (text) {
      const url = href.startsWith("http")
        ? href
        : new URL(href, SCM_BASE_URL).toString();
      items.push({ text, url });
    }
  }

  return items;
}
