import { enableFtp } from "../../scraper/stackcp.js";
import { FTP_CRON } from "../../config.js";

export const name = "ftpEnable";
export const cronExpression = FTP_CRON;
export async function run(): Promise<void> {
  await enableFtp();
}
