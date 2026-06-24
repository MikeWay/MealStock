import { Router } from "express";
import { randomBytes } from "crypto";
import { sendEmail } from "../email.js";
import { getScmClient } from "../scraper/client.js";
import {
  createUser,
  createResetToken,
  consumeResetToken,
  deleteUser,
  loadUsers,
  setPassword,
  verifyPassword,
} from "../userStore.js";
import { SMTP_HOST, APP_BASE_URL } from "../config.js";
import { getEffectivePermissions } from "../roleStore.js";
import { requirePermission } from "../middleware/requirePermission.js";

const router = Router();

// ── Dashboard auth ───────────────────────────────────────────────────────────

router.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    res.status(400).json({ success: false, message: "Email and password required" });
    return;
  }
  const valid = await verifyPassword(email, password);
  if (!valid) {
    res.status(401).json({ success: false, message: "Invalid email or password" });
    return;
  }
  req.session.authenticated = true;
  req.session.userEmail = email.toLowerCase();
  const client = getScmClient(req.session.userEmail);
  if (!client.loggedIn) {
    client.tryAutoConnect().catch(() => {});
  }
  const userRecord = loadUsers().find(u => u.email === req.session.userEmail);
  const permissions = getEffectivePermissions(userRecord?.roles ?? []);
  res.json({ success: true, scmLoggedIn: client.loggedIn, permissions });
});

router.get("/api/auth/status", (req, res) => {
  res.json({
    dashboardAuthenticated: req.session.authenticated === true,
    userEmail: req.session.userEmail ?? null,
    scmLoggedIn: req.session.userEmail ? getScmClient(req.session.userEmail).loggedIn : false,
    scmConnecting: req.session.userEmail ? getScmClient(req.session.userEmail).connecting : false,
    noUsersExist: loadUsers().length === 0,
    permissions: req.session.userEmail
      ? getEffectivePermissions(loadUsers().find(u => u.email === req.session.userEmail)?.roles ?? [])
      : undefined,
  });
});

router.post("/api/auth/scm-login", async (req, res) => {
  const client = getScmClient(req.session.userEmail!);
  if (client.loggedIn) {
    res.json({ success: true, message: "Already connected to SCM" });
    return;
  }
  const { username, password } = req.body as { username?: string; password?: string };
  if (!username || !password) {
    res.status(400).json({ success: false, message: "Username and password required" });
    return;
  }
  try {
    const result = await client.init(username, password);
    if (result.mfaRequired) {
      res.json({ success: true, mfaRequired: true, message: "Enter the code sent to your phone." });
    } else {
      res.json({ success: true, mfaRequired: false, message: "Connected to SCM" });
    }
  } catch (err) {
    console.error("SCM login failed:", err);
    res.status(500).json({ success: false, message: "SCM login failed" });
  }
});

router.post("/api/auth/scm-mfa", async (req, res) => {
  const { code } = req.body as { code?: string };
  if (!code) {
    res.status(400).json({ success: false, message: "Code required" });
    return;
  }
  try {
    await getScmClient(req.session.userEmail!).completeMfa(code);
    res.json({ success: true, message: "Connected to SCM" });
  } catch (err) {
    console.error("SCM MFA failed:", err);
    res.status(500).json({ success: false, message: "Invalid or expired code" });
  }
});

router.post("/api/auth/scm-logout", async (req, res) => {
  try {
    await getScmClient(req.session.userEmail!).logout();
    res.json({ success: true });
  } catch (err) {
    console.error("SCM logout failed:", err);
    res.status(500).json({ success: false, message: "SCM logout failed" });
  }
});

router.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

// ── Password reset ────────────────────────────────────────────────────────────

router.post("/api/auth/forgot-password", async (req, res) => {
  const { email } = req.body as { email?: string };
  if (!email) {
    res.status(400).json({ success: false, message: "Email required" });
    return;
  }
  const token = createResetToken(email);
  // Always return success to avoid user enumeration
  if (token && SMTP_HOST) {
    const resetUrl = `${APP_BASE_URL}/?reset=${token}`;
    await sendEmail({
      to: email,
      subject: "SCM Tools — password reset",
      text: `Click the link below to reset your password (valid for 1 hour):\n\n${resetUrl}\n\nIf you did not request this, ignore this email.`,
    }).catch((err) => console.error("Failed to send reset email:", err));
  }
  res.json({ success: true, message: "If that email is registered you will receive a reset link shortly." });
});

router.post("/api/auth/reset-password", async (req, res) => {
  const { token, password } = req.body as { token?: string; password?: string };
  if (!token || !password) {
    res.status(400).json({ success: false, message: "Token and new password required" });
    return;
  }
  const result = await consumeResetToken(token, password);
  if (!result.success) {
    res.status(400).json(result);
    return;
  }
  res.json(result);
});

// ── User management ──────────────────────────────────────────────────────────
// Create user: open when no users exist (bootstrap), otherwise requires auth.

router.post("/api/users", async (req, res) => {
  const users = loadUsers();
  // Bootstrap: allow first user creation without auth; otherwise require users:full
  if (users.length > 0) {
    return requirePermission("users", "full")(req, res, async () => {
      const { email, password, invite } = req.body as { email?: string; password?: string; invite?: boolean };
      if (!email) { res.status(400).json({ success: false, message: "Email required" }); return; }
      if (!invite && !password) { res.status(400).json({ success: false, message: "Email and password required" }); return; }
      if (invite) {
        const createResult = await createUser(email, randomBytes(32).toString("hex"));
        if (!createResult.success) { res.json(createResult); return; }
        const token = createResetToken(email);
        if (!token) { res.status(500).json({ success: false, message: "Failed to generate invite token" }); return; }
        const inviteUrl = `${APP_BASE_URL}/?reset=${token}`;
        const subject = "You've been invited to SCM Tools";
        const body = `You've been invited to access the SCM Tools dashboard.\n\nClick the link below to set your password and activate your account:\n\n${inviteUrl}\n\nThis link is valid for 1 hour. If you did not expect this invitation, you can ignore this email.`;
        res.json({ success: true, invite: true, draftEmail: { to: email, subject, body } });
        return;
      }
      res.json(await createUser(email, password!));
    });
  }
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    res.status(400).json({ success: false, message: "Email and password required" });
    return;
  }
  res.json(await createUser(email, password));
});

router.post("/api/users/:email/send-invite", requirePermission("users", "full"), async (req, res) => {
  const { subject, body } = req.body as { subject?: string; body?: string };
  if (!subject || !body) {
    res.status(400).json({ success: false, message: "Subject and body required" });
    return;
  }
  if (!SMTP_HOST) {
    res.json({ success: false, message: "SMTP is not configured — copy the invite link from the preview and share it manually." });
    return;
  }
  try {
    await sendEmail({ to: req.params.email as string, subject, text: body });
    res.json({ success: true });
  } catch (err) {
    console.error("Send invite failed:", err);
    res.status(500).json({ success: false, message: "Failed to send invite email" });
  }
});

router.get("/api/users", requirePermission("users", "view"), (_req, res) => {
  const users = loadUsers().map((u) => ({ email: u.email, createdAt: u.createdAt, roles: u.roles ?? [] }));
  res.json({ users });
});

router.post("/api/users/:email/reset-password", requirePermission("users", "full"), async (req, res) => {
  const { password } = req.body as { password?: string };
  if (!password) {
    res.status(400).json({ success: false, message: "New password required" });
    return;
  }
  const result = await setPassword(req.params.email as string, password);
  res.json(result);
});

router.delete("/api/users/:email", requirePermission("users", "full"), (req, res) => {
  const result = deleteUser(req.params.email as string);
  res.json(result);
});

export default router;
