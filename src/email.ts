import { createTransport } from "nodemailer";
import { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } from "./config.js";

export async function sendEmail(opts: { to: string; subject: string; text: string }): Promise<void> {
  if (!SMTP_HOST) throw new Error("SMTP_HOST not configured");
  const transporter = createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    tls: { rejectUnauthorized: false },
  });
  await transporter.sendMail({ from: SMTP_FROM, ...opts });
}
