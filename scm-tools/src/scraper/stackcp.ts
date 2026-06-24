import { chromium } from "playwright";
import { STACKCP_USER, STACKCP_PASS, PLAYWRIGHT_HEADLESS } from "../config.js";

const LOGIN_URL = "https://stackcp.com/login";

async function unlockFor28Days(page: import("playwright").Page): Promise<void> {
  const modal = page.locator("#ftp__unlock--options");
  await modal.waitFor({ state: "visible", timeout: 10000 });
  await modal.getByRole("radio", { name: "28 days(Not recommended)" }).check();
  await modal.getByRole("button", { name: "Unlock FTP", exact: true }).click();
  await modal.waitFor({ state: "hidden", timeout: 10000 });
  await page.waitForLoadState("networkidle");
}

// Wait until the FTP table has finished loading and stabilised.
// Vue fires two render cycles after each action: a local state update then a server refresh.
// We poll until the button count is both non-zero and unchanged for two consecutive 1s checks.
async function waitForFtpTable(page: import("playwright").Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  const sel = "#modify-ftp .ftp-is-locked.btn, #modify-ftp .ftp-is-unlocked .btn";
  let prev = -1, curr = 0;
  do {
    prev = curr;
    await page.waitForTimeout(1000);
    curr = await page.locator(sel).count();
  } while (curr !== prev || curr === 0);
}

export async function enableFtp(): Promise<void> {
  if (!STACKCP_USER || !STACKCP_PASS) {
    throw new Error("STACKCP_USER and STACKCP_PASS must be set in .env");
  }

  const browser = await chromium.launch({ headless: PLAYWRIGHT_HEADLESS });
  try {
    const page = await browser.newPage();

    // Log in
    await page.goto(LOGIN_URL);
    await page.getByRole("textbox", { name: "Username" }).fill(STACKCP_USER);
    await page.getByRole("textbox", { name: "Password" }).fill(STACKCP_PASS);
    await page.getByRole("button", { name: "Sign me in" }).click();

    // Navigate via sidebar link — direct URL breaks Vue initialisation
    await page.getByRole("link", { name: "FTP Accounts FTP Accounts" }).click();
    await waitForFtpTable(page);

    // Step 1: lock all currently-unlocked accounts so everything starts from a consistent state
    for (let i = 0; i < 20; i++) {
      if (await page.locator("#modify-ftp .ftp-is-unlocked .btn").count() === 0) break;
      await page.locator("#modify-ftp .ftp-is-unlocked .btn").first().click({ force: true });
      await waitForFtpTable(page);
    }

    // Step 2: unlock all accounts for 28 days
    for (let i = 0; i < 20; i++) {
      if (await page.locator("#modify-ftp .ftp-is-locked.btn").count() === 0) break;
      await page.locator("#modify-ftp .ftp-is-locked.btn").first().click({ force: true });
      await unlockFor28Days(page);
      await waitForFtpTable(page);
    }
  } finally {
    await browser.close();
  }
}
