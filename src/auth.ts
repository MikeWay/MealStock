import crypto from 'crypto';
import { Pool } from 'pg';
import { notifyAdminsOfNewUser } from './mailer';
import { Request, Response, NextFunction } from 'express';
import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as FacebookStrategy } from 'passport-facebook';
import bcrypt from 'bcrypt';

export interface AppUser {
  id: number;
  email: string;
  display_name: string;
  approved: boolean;
  is_admin: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface User extends AppUser {}
  }
}

async function getUserById(pool: Pool, id: number): Promise<AppUser | null> {
  const res = await pool.query<AppUser>(
    'SELECT id, email, display_name, approved, is_admin FROM users WHERE id=$1',
    [id]
  );
  return res.rows[0] ?? null;
}

async function getUserByEmail(pool: Pool, email: string): Promise<(AppUser & { password_hash: string | null }) | null> {
  const res = await pool.query<AppUser & { password_hash: string | null }>(
    'SELECT id, email, display_name, approved, is_admin, password_hash FROM users WHERE email=$1',
    [email]
  );
  return res.rows[0] ?? null;
}

async function countUsers(pool: Pool): Promise<number> {
  const res = await pool.query<{ count: string }>('SELECT COUNT(*) FROM users');
  return parseInt(res.rows[0].count);
}

export async function createLocalUser(
  pool: Pool, email: string, displayName: string, passwordHash: string
): Promise<AppUser> {
  const first = (await countUsers(pool)) === 0;
  const res = await pool.query<AppUser>(
    `INSERT INTO users(email, display_name, password_hash, approved, is_admin)
     VALUES($1,$2,$3,$4,$5) RETURNING id, email, display_name, approved, is_admin`,
    [email, displayName, passwordHash, first, first]
  );
  return res.rows[0];
}

// provider is a controlled literal type — not user-supplied — so the template SQL is safe
export async function upsertOAuthUser(
  pool: Pool,
  provider: 'google_id' | 'facebook_id' | 'microsoft_id',
  providerId: string,
  email: string,
  displayName: string
): Promise<AppUser> {
  const byProvider = await pool.query<AppUser>(
    `SELECT id, email, display_name, approved, is_admin FROM users WHERE ${provider}=$1`,
    [providerId]
  );
  if (byProvider.rows[0]) return byProvider.rows[0];

  const byEmail = await pool.query<AppUser>(
    'SELECT id, email, display_name, approved, is_admin FROM users WHERE email=$1',
    [email]
  );
  if (byEmail.rows[0]) {
    await pool.query(`UPDATE users SET ${provider}=$1 WHERE id=$2`, [providerId, byEmail.rows[0].id]);
    return byEmail.rows[0];
  }

  const first = (await countUsers(pool)) === 0;
  const res = await pool.query<AppUser>(
    `INSERT INTO users(email, display_name, ${provider}, approved, is_admin)
     VALUES($1,$2,$3,$4,$5) RETURNING id, email, display_name, approved, is_admin`,
    [email, displayName, providerId, first, first]
  );
  const newUser = res.rows[0];
  if (!first) {
    notifyAdminsOfNewUser(pool, newUser.email, newUser.display_name).catch(e =>
      console.error('Admin registration notification failed:', e)
    );
  }
  return newUser;
}

export function configurePassport(pool: Pool): void {
  passport.serializeUser((user, done) => done(null, (user as AppUser).id));

  passport.deserializeUser(async (id: number, done) => {
    try { done(null, await getUserById(pool, id)); }
    catch (e) { done(e); }
  });

  passport.use(new LocalStrategy({ usernameField: 'email' }, async (email, password, done) => {
    try {
      const user = await getUserByEmail(pool, email.toLowerCase().trim());
      if (!user || !user.password_hash) return done(null, false);
      const ok = await bcrypt.compare(password, user.password_hash);
      return done(null, ok ? user : false);
    } catch (e) { return done(e); }
  }));

  const base = process.env.APP_BASE_URL || 'http://localhost:3000';

  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    passport.use(new GoogleStrategy({
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: `${base}/auth/google/callback`,
    }, async (_at, _rt, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value ?? `${profile.id}@google.invalid`;
        done(null, await upsertOAuthUser(pool, 'google_id', profile.id, email, profile.displayName));
      } catch (e) { done(e as Error); }
    }));
  }

  if (process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET) {
    passport.use(new FacebookStrategy({
      clientID: process.env.FACEBOOK_APP_ID,
      clientSecret: process.env.FACEBOOK_APP_SECRET,
      callbackURL: `${base}/auth/facebook/callback`,
      profileFields: ['id', 'emails', 'displayName'],
    }, async (_at, _rt, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value ?? `${profile.id}@facebook.invalid`;
        done(null, await upsertOAuthUser(pool, 'facebook_id', profile.id, email, profile.displayName));
      } catch (e) { done(e as Error); }
    }));
  }

  if (process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const MicrosoftStrategy = require('passport-microsoft').Strategy;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    passport.use('microsoft', new MicrosoftStrategy({
      clientID: process.env.MICROSOFT_CLIENT_ID,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
      callbackURL: `${base}/auth/microsoft/callback`,
      scope: ['user.read'],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }, async (_at: string, _rt: string, profile: any, done: (err: any, user?: any) => void) => {
      try {
        const email = profile.emails?.[0]?.value
          ?? profile._json?.mail
          ?? profile._json?.userPrincipalName
          ?? `${profile.id}@microsoft.invalid`;
        done(null, await upsertOAuthUser(pool, 'microsoft_id', profile.id, email, profile.displayName));
      } catch (e) { done(e); }
    }));
  }
}

export function validatePasswordComplexity(password: string): string | null {
  if (password.length < 8)       return 'Password must be at least 8 characters.';
  if (!/[A-Z]/.test(password))   return 'Password must contain at least one uppercase letter.';
  if (!/[a-z]/.test(password))   return 'Password must contain at least one lowercase letter.';
  if (!/[0-9]/.test(password))   return 'Password must contain at least one number.';
  return null;
}

function sha256(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function createPasswordResetToken(pool: Pool, userId: number): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query(
    'UPDATE password_reset_tokens SET used=true WHERE user_id=$1 AND used=false',
    [userId]
  );
  await pool.query(
    `INSERT INTO password_reset_tokens(user_id, token_hash, expires_at)
     VALUES($1, $2, NOW() + INTERVAL '1 hour')`,
    [userId, sha256(token)]
  );
  return token;
}

export async function consumePasswordResetToken(pool: Pool, rawToken: string): Promise<number | null> {
  const res = await pool.query<{ id: number; user_id: number }>(
    `SELECT id, user_id FROM password_reset_tokens
     WHERE token_hash=$1 AND used=false AND expires_at > NOW()`,
    [sha256(rawToken)]
  );
  if (!res.rows[0]) return null;
  await pool.query('UPDATE password_reset_tokens SET used=true WHERE id=$1', [res.rows[0].id]);
  return res.rows[0].user_id;
}

export async function validatePasswordResetToken(pool: Pool, rawToken: string): Promise<boolean> {
  const res = await pool.query(
    'SELECT id FROM password_reset_tokens WHERE token_hash=$1 AND used=false AND expires_at > NOW()',
    [sha256(rawToken)]
  );
  return res.rows.length > 0;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.isAuthenticated()) { res.redirect('/login'); return; }
  if (!req.user!.approved) { res.redirect('/pending'); return; }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.isAuthenticated()) { res.redirect('/login'); return; }
  if (!req.user!.approved) { res.redirect('/pending'); return; }
  if (!req.user!.is_admin) { res.status(403).send('Forbidden'); return; }
  next();
}
