import type { BrowserContext, Page } from "playwright";
import { SCM_BASE_URL } from "../config.js";

const OTP_SELECTOR =
  'input[name="otp"], input[name="code"], input[name="token"], input[type="tel"], input[inputmode="numeric"], input[maxlength="4"]';

export async function isLoggedIn(page: Page): Promise<boolean> {
  try {
    await page.goto(SCM_BASE_URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    const url = page.url();
    const hasLoginForm = await page.locator('input[type="password"]').count();
    return hasLoginForm === 0 && !url.includes("login");
  } catch {
    return false;
  }
}

export async function submitCredentials(
  page: Page,
  username: string,
  password: string
): Promise<{ mfaRequired: boolean }> {
  console.log("Navigating to SCM login page...");
  await page.goto(SCM_BASE_URL, { waitUntil: "domcontentloaded" });

  await page.waitForSelector('input[type="password"]', { timeout: 60_000 });

  console.log("Filling in credentials...");
  const usernameInput = page.locator(
    'input[type="text"], input[type="email"], input[name="username"], input[name="email"]'
  );
  await usernameInput.first().fill(username);
  await page.locator('input[type="password"]').first().fill(password);

  const submitButton = page.locator('button[type="submit"], input[type="submit"]');
  await submitButton.first().click();

  // Wait for navigation to settle rather than a fixed delay — containers can be slower
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

  const url = page.url();
  const hasOtp = await page.locator(OTP_SELECTOR).count();

  if (url.includes("confirm_login") || hasOtp > 0) {
    console.log("MFA required.");
    return { mfaRequired: true };
  }

  console.log("Login successful (no MFA).");
  return { mfaRequired: false };
}

export async function submitMfa(page: Page, code: string): Promise<void> {
  await page.locator(OTP_SELECTOR).first().fill(code);

  const submitButton = page.locator('button[type="submit"], input[type="submit"]');
  await submitButton.first().click();

  const timeout = 30_000;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    await page.waitForTimeout(1000);
    const url = page.url();
    const hasOtp = await page.locator(OTP_SELECTOR).count();
    if (!url.includes("confirm_login") && hasOtp === 0) {
      console.log("MFA accepted, login complete.");
      return;
    }
  }
  throw new Error("Timed out waiting for MFA to complete");
}

export async function login(
  page: Page,
  _context: BrowserContext,
  username: string,
  password: string
): Promise<void> {
  const { mfaRequired } = await submitCredentials(page, username, password);
  if (!mfaRequired) return;

  // Legacy headed-browser path: poll until the user completes OTP manually
  const timeout = 120_000;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    await page.waitForTimeout(2_000);
    const url = page.url();
    const hasPassword = await page.locator('input[type="password"]').count();
    const hasOtp = await page.locator(OTP_SELECTOR).count();
    if (hasPassword === 0 && hasOtp === 0 && !url.includes("login")) {
      console.log("Login successful!");
      return;
    }
  }
  console.warn("Timed out waiting for login to complete.");
}
