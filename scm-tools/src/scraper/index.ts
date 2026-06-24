import { chromium, type Browser, type BrowserContext } from "playwright";
import { existsSync, mkdirSync } from "fs";
import path from "path";
import { PLAYWRIGHT_HEADLESS } from "../config.js";

export async function launchBrowser(statePath: string): Promise<{
  browser: Browser;
  context: BrowserContext;
}> {
  const authDir = path.dirname(statePath);
  if (!existsSync(authDir)) {
    mkdirSync(authDir, { recursive: true });
  }

  const browser = await chromium.launch({ headless: PLAYWRIGHT_HEADLESS });

  const hasState = existsSync(statePath);
  const context = await browser.newContext(
    hasState ? { storageState: statePath } : undefined
  );

  if (hasState) {
    console.log("Loaded saved session state from", statePath);
  }

  return { browser, context };
}

export async function saveState(context: BrowserContext, statePath: string): Promise<void> {
  const authDir = path.dirname(statePath);
  if (!existsSync(authDir)) {
    mkdirSync(authDir, { recursive: true });
  }
  await context.storageState({ path: statePath });
  console.log("Session state saved to", statePath);
}
