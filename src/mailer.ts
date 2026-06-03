import nodemailer from 'nodemailer';

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  const host = process.env.SMTP_HOST;
  if (!host) throw new Error('SMTP_HOST environment variable is required to send password reset emails');

  const transporter = nodemailer.createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT || '587'),
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });

  const from = process.env.SMTP_FROM || `noreply@${host}`;
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
