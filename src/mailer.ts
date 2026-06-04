import nodemailer from 'nodemailer';
import { Pool } from 'pg';

function createTransporter() {
  const host = process.env.SMTP_HOST;
  if (!host) throw new Error('SMTP_HOST environment variable is required');
  return {
    transporter: nodemailer.createTransport({
      host,
      port: parseInt(process.env.SMTP_PORT || '587'),
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    }),
    from: process.env.SMTP_FROM || `noreply@${host}`,
  };
}

export async function sendRegistrationNotificationEmail(
  to: string[],
  newUserEmail: string,
  newUserName: string,
  adminUrl: string
): Promise<void> {
  if (!to.length) return;
  const { transporter, from } = createTransporter();
  await transporter.sendMail({
    from,
    to: to.join(', '),
    subject: 'Meal Stock Control — New User Registration',
    text: `A new user has registered and is awaiting approval.\n\nName: ${newUserName}\nEmail: ${newUserEmail}\n\nApprove or reject at: ${adminUrl}`,
    html: `<p>A new user has registered and is awaiting approval.</p>
<table><tr><td><strong>Name</strong></td><td>${newUserName}</td></tr>
<tr><td><strong>Email</strong></td><td>${newUserEmail}</td></tr></table>
<p><a href="${adminUrl}">Go to admin panel to approve or reject</a></p>`,
  });
}

export async function notifyAdminsOfNewUser(
  pool: Pool,
  newUserEmail: string,
  newUserName: string
): Promise<void> {
  const base = process.env.APP_BASE_URL || 'http://localhost:3000';
  const res = await pool.query<{ email: string }>(
    'SELECT email FROM users WHERE is_admin=true AND approved=true'
  );
  const adminEmails = res.rows.map(r => r.email);
  await sendRegistrationNotificationEmail(adminEmails, newUserEmail, newUserName, `${base}/admin`);
}

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  const { transporter, from } = createTransporter();
  const safeUrl = resetUrl.replace(/"/g, '%22').replace(/</g, '%3C').replace(/>/g, '%3E');

  await transporter.sendMail({
    from,
    to,
    subject: 'Meal Stock Control — Password Reset',
    text: [
      'You requested a password reset for your Meal Stock Control account.',
      '',
      'Click the link below to set a new password. This link expires in 1 hour.',
      '',
      resetUrl,
      '',
      'If you did not request this, you can safely ignore this email.',
    ].join('\n'),
    html: `<p>You requested a password reset for your Meal Stock Control account.</p>
<p>Click the link below to set a new password. This link expires in 1 hour.</p>
<p><a href="${safeUrl}">${safeUrl}</a></p>
<p>If you did not request this, you can safely ignore this email.</p>`,
  });
}
