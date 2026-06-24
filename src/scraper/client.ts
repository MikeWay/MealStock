import type { Browser, BrowserContext, Page } from "playwright";
import { launchBrowser, saveState } from "./index.js";
import { isLoggedIn, submitCredentials, submitMfa } from "./auth.js";
import { getStatePath } from "../config.js";

export class ScmClient {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private _loggedIn = false;
  private _connecting = false;
  private _pendingMfaPage: Page | null = null;

  constructor(private readonly statePath: string) {}

  get loggedIn(): boolean {
    return this._loggedIn;
  }

  get connecting(): boolean {
    return this._connecting;
  }

  get mfaPending(): boolean {
    return this._pendingMfaPage !== null;
  }

  async tryAutoConnect(): Promise<boolean> {
    if (this._loggedIn) return true;
    this._connecting = true;
    try {
      const { browser, context } = await launchBrowser(this.statePath);
      this.browser = browser;
      this.context = context;
      const page = await context.newPage();
      const valid = await isLoggedIn(page);
      await page.close();
      if (valid) {
        this._loggedIn = true;
        console.log("Auto-connect succeeded using saved state:", this.statePath);
      } else {
        await this.close();
      }
      return valid;
    } catch {
      return false;
    } finally {
      this._connecting = false;
    }
  }

  async init(username: string, password: string): Promise<{ mfaRequired: boolean }> {
    const { browser, context } = await launchBrowser(this.statePath);
    this.browser = browser;
    this.context = context;

    const page = await context.newPage();
    const valid = await isLoggedIn(page);
    if (valid) {
      console.log("Existing session is valid.");
      await page.close();
      this._loggedIn = true;
      return { mfaRequired: false };
    }

    console.log("No valid session found. Starting login flow...");
    const result = await submitCredentials(page, username, password);
    if (result.mfaRequired) {
      this._pendingMfaPage = page;
      return { mfaRequired: true };
    }

    await saveState(context, this.statePath);
    await page.close();
    this._loggedIn = true;
    return { mfaRequired: false };
  }

  async completeMfa(code: string): Promise<void> {
    if (!this._pendingMfaPage || !this.context) {
      throw new Error("No MFA pending");
    }
    const page = this._pendingMfaPage;
    this._pendingMfaPage = null;
    await submitMfa(page, code);
    await saveState(this.context, this.statePath);
    await page.close();
    this._loggedIn = true;
  }

  async getPage(): Promise<Page> {
    if (!this.context) {
      throw new Error("ScmClient not initialized. Call init() first.");
    }
    return this.context.newPage();
  }

  async logout(): Promise<void> {
    if (this.context) {
      const page = await this.context.newPage();
      try {
        await page.goto("https://exesc.clubmin.net/users/logout", { waitUntil: "domcontentloaded" });
      } finally {
        await page.close();
      }
    }
    await this.close();
  }

  async close(): Promise<void> {
    if (this._pendingMfaPage) {
      await this._pendingMfaPage.close();
      this._pendingMfaPage = null;
    }
    if (this.context) {
      await saveState(this.context, this.statePath);
      await this.context.close();
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
    this._loggedIn = false;
  }
}

const registry = new Map<string, ScmClient>();

export function getScmClient(sessionId: string): ScmClient {
  if (!registry.has(sessionId)) {
    registry.set(sessionId, new ScmClient(getStatePath(sessionId)));
  }
  return registry.get(sessionId)!;
}
