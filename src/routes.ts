import { Router, Request, Response } from 'express';
import passport from 'passport';
import bcrypt from 'bcrypt';
import path from 'path';
import fs from 'fs';
import { Pool } from 'pg';
import { AppUser, createLocalUser, requireAdmin, createPasswordResetToken, consumePasswordResetToken, validatePasswordResetToken, validatePasswordComplexity } from './auth';
import { sendPasswordResetEmail, notifyAdminsOfNewUser } from './mailer';

const VALID_CATEGORIES = new Set(['Meat', 'Non-Meat', 'Desserts']);
const SESSIONS = [
  'Tues Improv', 'Tues Cruisers', 'Wed Diners', 'Wed Dinghies',
  'Thurs Diners', 'Thurs Juniors', 'Thurs Cruisers', 'Friday',
];

export interface OAuthProviders {
  google: boolean;
  facebook: boolean;
  microsoft: boolean;
}

function readFile(name: string): string {
  const p = path.join(__dirname, '..', name);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : `<h1>${name} not found</h1>`;
}

function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function adminPage(rows: string, weeks: { id: number; label: string }[], activeWeekId: number, freezerOptions: { id: number; label: string }[]): string {
  const activeIdx = weeks.findIndex(w => w.id === activeWeekId);
  const futureWeeks = activeIdx >= 0 ? weeks.slice(activeIdx + 1) : weeks.slice(1);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Admin — Meal Stock Control</title>
<style>
  :root{--bg:#f5f4f0;--surface:#fff;--border:#ddd9d0;--text:#1a1916;--text2:#6b6860;--accent:#2d6a4f;--danger:#991b1b;--radius:8px;}
  @media(prefers-color-scheme:dark){:root{--bg:#141412;--surface:#1e1d1a;--border:#35332e;--text:#f0ede8;--text2:#9b9890;--accent:#4ade80;--danger:#f87171;}}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;background:var(--bg);color:var(--text);padding:24px;font-size:14px}
  h1{font-size:20px;margin-bottom:20px}
  table{width:100%;border-collapse:collapse;background:var(--surface);border-radius:var(--radius);overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08)}
  th,td{padding:10px 14px;text-align:left;border-bottom:1px solid var(--border)}
  th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--text2)}
  tr:last-child td{border-bottom:none}
  .badge{display:inline-block;padding:2px 8px;border-radius:20px;font-size:12px;font-weight:500}
  .badge.ok{background:#e8f4ee;color:#1a4a35}.badge.pending{background:#fef3c7;color:#92400e}.badge.admin{background:#dbeafe;color:#1e3a8a}
  @media(prefers-color-scheme:dark){.badge.ok{background:#052e16;color:#86efac}.badge.pending{background:#292400;color:#fde68a}.badge.admin{background:#0a1628;color:#93c5fd}}
  .btn-approve{background:var(--accent);color:#fff;border:none;padding:4px 12px;border-radius:6px;cursor:pointer;font-size:12px}
  .btn-reject{background:transparent;color:var(--danger);border:1px solid var(--danger);padding:4px 12px;border-radius:6px;cursor:pointer;font-size:12px;margin-left:6px}
  .actions{display:flex;gap:4px;align-items:center}
  .back{display:inline-block;margin-bottom:16px;color:var(--accent);text-decoration:none;font-size:13px}
</style>
</head>
<body>
<a href="/" class="back">← Back to app</a>
<h1>User Management</h1>
<table>
<thead><tr><th>Email</th><th>Name</th><th>Status</th><th>Role</th><th>Joined</th><th>Actions</th></tr></thead>
<tbody>${rows}</tbody>
</table>

<h2 style="font-size:16px;margin:32px 0 12px">Reset Session</h2>
<p style="color:var(--text2);margin-bottom:12px;font-size:13px">
  Zeroes all session usage and corrections for the selected week. Start and ordered values are kept.
</p>
<form method="post" action="/admin/reset-session"
      onsubmit="return confirm('Reset session usage for the selected week? This cannot be undone.')">
  <select name="weekId" style="padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);color:var(--text);font-size:13px;margin-right:8px">
    ${weeks.map(w => `<option value="${w.id}">${esc(w.label)}</option>`).join('')}
  </select>
  <button type="submit" class="btn-reject" style="font-size:13px;padding:6px 16px">Reset Session</button>
</form>

<h2 style="font-size:16px;margin:32px 0 12px">Import Stock Levels</h2>
<p style="color:var(--text2);margin-bottom:12px;font-size:13px">
  Upload a CSV with columns: <code>Category, Dish, Dietary Info, Start Number</code>. Matching dishes are updated; unrecognised dishes are created in the target week only.
</p>
<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
  <select id="importWeekId" style="padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);color:var(--text);font-size:13px">
    ${weeks.map((w, i) => `<option value="${w.id}"${i === weeks.length - 1 ? ' selected' : ''}>${esc(w.label)}</option>`).join('')}
  </select>
  <input type="file" id="importFile" accept=".csv" style="font-size:13px;color:var(--text)">
  <button onclick="doImportStock()" class="btn-approve" style="font-size:13px;padding:6px 16px">Import</button>
</div>
<div style="margin-top:8px">
  <label style="font-size:13px;cursor:pointer">
    <input type="checkbox" id="importResetWeeks" style="margin-right:6px">
    Delete all existing weeks before importing (fresh start)
  </label>
</div>
<div id="importResult" style="margin-top:10px;font-size:13px;white-space:pre-wrap"></div>

<h2 style="font-size:16px;margin:32px 0 12px">Delete Week</h2>
<p style="color:var(--text2);margin-bottom:12px;font-size:13px">
  Permanently deletes a future week and all its data. Left-over stock figures carry forward to the next week if one exists.
</p>
${futureWeeks.length > 0 ? `
<form method="post" action="/admin/delete-week"
      onsubmit="return confirm('Delete this week? All data will be permanently discarded.')">
  <select name="weekId" style="padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);color:var(--text);font-size:13px;margin-right:8px">
    ${futureWeeks.map(w => `<option value="${w.id}">${esc(w.label)}</option>`).join('')}
  </select>
  <button type="submit" class="btn-reject" style="font-size:13px;padding:6px 16px">Delete Week</button>
</form>` : '<p style="color:var(--text2);font-size:13px">No future weeks available to delete.</p>'}

<h2 style="font-size:16px;margin:32px 0 12px">Freezer Options</h2>
<p style="color:var(--text2);margin-bottom:12px;font-size:13px">
  Define the freezer labels available in the dropdown on the stock table.
</p>
${freezerOptions.length
  ? freezerOptions.map(f => `<form method="post" action="/admin/freezer-options/delete"
      style="display:inline-block;margin:0 6px 6px 0"
      onsubmit="return confirm('Delete freezer option?')">
    <input type="hidden" name="id" value="${f.id}">
    <button type="submit" class="btn-reject" style="font-size:12px;padding:3px 10px">${esc(f.label)} ✕</button>
  </form>`).join('')
  : '<p style="color:var(--text2);font-size:13px;margin-bottom:10px">No options defined yet.</p>'}
<form method="post" action="/admin/freezer-options/add" style="margin-top:10px;display:flex;gap:8px;align-items:center">
  <input type="text" name="label" required maxlength="40" placeholder="e.g. Freezer 1"
    style="padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);color:var(--text);font-size:13px">
  <button type="submit" class="btn-approve" style="font-size:13px;padding:6px 16px">Add Option</button>
</form>

<h2 style="font-size:16px;margin:32px 0 12px">Global Reset</h2>
<p style="color:var(--text2);margin-bottom:12px;font-size:13px">
  Zeroes start, ordered, corrections and all session values for every dish in every week.
  This cannot be undone.
</p>
<form method="post" action="/admin/reset-all"
      onsubmit="return confirm('Zero ALL data across ALL weeks? This cannot be undone.')">
  <button type="submit" class="btn-reject" style="font-size:13px;padding:6px 16px">Reset all data to zero</button>
</form>

<h2 style="font-size:16px;margin:32px 0 12px">SQL Query</h2>
<textarea id="sqlInput" rows="5"
  style="width:100%;font-family:monospace;font-size:13px;padding:8px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:var(--radius);resize:vertical;box-sizing:border-box"
  placeholder="SELECT * FROM weeks LIMIT 10"></textarea>
<button onclick="runSql()" class="btn-approve" style="margin-top:8px;font-size:13px;padding:6px 16px">Run</button>
<div id="sqlResults" style="margin-top:16px;overflow-x:auto"></div>
<script>
async function doImportStock() {
  const weekId = parseInt(document.getElementById('importWeekId').value);
  const fileInput = document.getElementById('importFile');
  const file = fileInput.files[0];
  const resetWeeks = document.getElementById('importResetWeeks').checked;
  const out = document.getElementById('importResult');
  if (!file) { out.style.color='var(--danger)'; out.textContent='Please select a CSV file.'; return; }
  if (resetWeeks && !confirm('This will DELETE ALL existing weeks and their data before importing. Are you sure?')) return;
  out.style.color='var(--text2)'; out.textContent='Importing...';
  try {
    const csv = await file.text();
    const r = await fetch('/admin/import-stock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weekId, csv, resetWeeks })
    });
    const data = await r.json();
    if (data.error) { out.style.color='var(--danger)'; out.textContent='Error: ' + data.error; return; }
    out.style.color='var(--accent)';
    let msg = 'Updated ' + data.updated + ' dish' + (data.updated!==1?'es':'') + ', created ' + data.created + ' new dish' + (data.created!==1?'es':'') + '.';
    if (data.errors && data.errors.length) msg += '\\n\\nSkipped rows:\\n' + data.errors.join('\\n');
    out.textContent = msg;
    fileInput.value = '';
  } catch(e) { out.style.color='var(--danger)'; out.textContent='Fetch error: ' + e; }
}
async function runSql() {
  const query = document.getElementById('sqlInput').value;
  const out = document.getElementById('sqlResults');
  out.innerHTML = '<em style="color:var(--text2)">Running…</em>';
  try {
    const r = await fetch('/admin/sql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    });
    const data = await r.json();
    if (data.error) {
      out.innerHTML = '<pre style="color:var(--danger)">' + escHtml(data.error) + '</pre>';
    } else if (data.columns.length === 0) {
      out.innerHTML = '<p style="color:var(--text2)">' + data.rowCount + ' row(s) affected.</p>';
    } else {
      const hdr = data.columns.map(c => '<th>' + escHtml(c) + '</th>').join('');
      const body = data.rows.map(row =>
        '<tr>' + row.map(v => '<td>' + escHtml(String(v ?? '')) + '</td>').join('') + '</tr>'
      ).join('');
      out.innerHTML = '<table><thead><tr>' + hdr + '</tr></thead><tbody>' + body + '</tbody></table>';
    }
  } catch(e) {
    out.innerHTML = '<pre style="color:var(--danger)">Fetch error: ' + escHtml(String(e)) + '</pre>';
  }
}
function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
</script>
</body>
</html>`;
}

function parseCSVRow(line: string): string[] {
  const fields: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      const end = line.indexOf('"', i + 1);
      fields.push(end === -1 ? line.slice(i + 1) : line.slice(i + 1, end));
      i = end === -1 ? line.length : end + 2; // skip closing quote + comma
    } else {
      const end = line.indexOf(',', i);
      fields.push(end === -1 ? line.slice(i) : line.slice(i, end));
      i = end === -1 ? line.length : end + 1;
    }
  }
  return fields;
}

async function importStock(
  pool: Pool,
  weekId: number,
  csvText: string,
  resetWeeks: boolean,
  deviceIp: string,
  userName: string
): Promise<{ updated: number; created: number; errors: string[] }> {
  const cleaned = csvText.replace(/^﻿/, '');
  const lines = cleaned.split(/\r?\n|\r/).map(l => l.trim()).filter(l => l.length > 0);
  const dataLines = lines.filter(l => !parseCSVRow(l)[0]?.trim().toLowerCase().startsWith('category'));

  let updated = 0;
  let created = 0;
  const errors: string[] = [];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (resetWeeks) {
      // Get the label of the selected week so we can recreate it
      const weekRes = await client.query<{ label: string }>('SELECT label FROM weeks WHERE id=$1', [weekId]);
      let weekLabel = weekRes.rows[0]?.label;
      if (!weekLabel) {
        const now = new Date();
        const diff = now.getDay() === 0 ? -6 : 1 - now.getDay();
        const mon = new Date(now); mon.setDate(now.getDate() + diff);
        weekLabel = `w/c ${mon.getDate()} ${mon.toLocaleString('en-GB', { month: 'short' })} ${mon.getFullYear()}`;
      }
      // Wipe all data and recreate a single fresh week
      await client.query('DELETE FROM sessions');
      await client.query('DELETE FROM dishes');
      await client.query('DELETE FROM weeks');
      await client.query('DELETE FROM app_settings WHERE key=$1', ['active_week_id']);
      const newWeekRes = await client.query<{ id: number }>(
        "INSERT INTO weeks(label, sort_order) VALUES($1, 1) RETURNING id", [weekLabel]
      );
      weekId = newWeekRes.rows[0].id;
      await client.query(
        "INSERT INTO app_settings(key, value) VALUES('active_week_id', $1)", [String(weekId)]
      );
    }

    const existing = await client.query<{ id: number; category: string; name: string; start: number }>(
      'SELECT id, category, name, start FROM dishes WHERE week_id=$1',
      [weekId]
    );
    const dishMap = new Map<string, { id: number; start: number }>();
    for (const row of existing.rows) {
      dishMap.set(`${row.category}::${row.name.toLowerCase()}`, { id: row.id, start: row.start });
    }

    for (let lineNum = 0; lineNum < dataLines.length; lineNum++) {
      const fields = parseCSVRow(dataLines[lineNum]);
      const rawCat = fields[0]?.trim();
      const catHasValue = rawCat && rawCat.length > 0;

      // When category column is present, use it; when empty, detect from field positions
      let name: string | undefined;
      let diet: string;
      let startVal: number;
      let normalizedCat: string | undefined;

      if (catHasValue) {
        normalizedCat = [...VALID_CATEGORIES].find(c => c.toLowerCase() === rawCat.toLowerCase()) ?? rawCat;
        name = fields[1]?.trim();
        diet = fields[2]?.trim() ?? '';
        startVal = parseInt(fields[3]?.trim() ?? '', 10);
      } else {
        // No category column — columns are: (empty), Name, Dietary, Start
        name = fields[1]?.trim();
        diet = fields[2]?.trim() ?? '';
        startVal = parseInt(fields[3]?.trim() ?? '', 10);
      }

      if (!name) { continue; } // skip blank rows silently

      if (isNaN(startVal) || startVal < 0) {
        errors.push(`Row ${lineNum + 1}: invalid start value for "${name}" (parsed: ${fields.slice(0,4).join(' | ')})`);
        continue;
      }

      if (catHasValue && (!normalizedCat || !VALID_CATEGORIES.has(normalizedCat))) {
        errors.push(`Row ${lineNum + 1}: invalid category "${rawCat}"`);
        continue;
      }

      // Build lookup key(s)
      let matchKey: string | undefined;
      let match: { id: number; start: number } | undefined;

      if (normalizedCat) {
        matchKey = `${normalizedCat}::${name.toLowerCase()}`;
        match = dishMap.get(matchKey);
      } else {
        // No category: search across all categories
        for (const cat of VALID_CATEGORIES) {
          const candidate = dishMap.get(`${cat}::${name.toLowerCase()}`);
          if (candidate) {
            if (match) { match = undefined; matchKey = undefined; break; } // ambiguous
            match = candidate; matchKey = `${cat}::${name.toLowerCase()}`; normalizedCat = cat;
          }
        }
        if (!match && !matchKey) {
          errors.push(`Row ${lineNum + 1}: "${name}" not found in any category (cannot create without a category)`);
          continue;
        }
      }

      if (match) {
        await client.query('UPDATE dishes SET start=$1, updated_at=NOW() WHERE id=$2', [startVal, match.id]);
        await client.query(
          `INSERT INTO audit_log(device_ip, user_name, week_label, dish_name, category, field, old_value, new_value)
           SELECT $1,$2,w.label,$3,$4,'start',$5,$6 FROM weeks w WHERE w.id=$7`,
          [deviceIp, userName, name, normalizedCat, match.start, startVal, weekId]
        );
        updated++;
      } else {
        const sortRes = await client.query<{ next: number }>(
          'SELECT COALESCE(MAX(sort_order),0)+1 AS next FROM dishes WHERE week_id=$1 AND category=$2',
          [weekId, normalizedCat]
        );
        const dRes = await client.query<{ id: number }>(
          `INSERT INTO dishes(week_id,category,sort_order,name,diet,start,ordered,corrections)
           VALUES($1,$2,$3,$4,$5,$6,0,0) RETURNING id`,
          [weekId, normalizedCat, sortRes.rows[0].next, name, diet, startVal]
        );
        const dishId = dRes.rows[0].id;
        for (let si = 0; si < SESSIONS.length; si++) {
          await client.query(
            'INSERT INTO sessions(dish_id,session_idx,session_name,used) VALUES($1,$2,$3,0)',
            [dishId, si, SESSIONS[si]]
          );
        }
        await client.query(
          `INSERT INTO audit_log(device_ip, user_name, week_label, dish_name, category, field, old_value, new_value)
           SELECT $1,$2,w.label,$3,$4,'start',NULL,$5 FROM weeks w WHERE w.id=$6`,
          [deviceIp, userName, name, normalizedCat, startVal, weekId]
        );
        created++;
      }
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  return { updated, created, errors };
}

export function createAuthRouter(
  pool: Pool,
  providers: OAuthProviders,
  reloadState: () => Promise<void>,
  deleteWeekFn: (weekDbId: number, deviceIp: string, userName: string) => Promise<void>
): Router {
  const router = Router();

  router.get('/login', (req: Request, res: Response) => {
    if (req.isAuthenticated() && req.user!.approved) { res.redirect('/'); return; }
    const script = `<script>window.__OAUTH__=${JSON.stringify(providers)};</script>`;
    const html = readFile('login.html').replace('</head>', `${script}\n</head>`);
    res.setHeader('Content-Type', 'text/html; charset=utf-8').send(html);
  });

  router.get('/pending', (req: Request, res: Response) => {
    if (!req.isAuthenticated()) { res.redirect('/login'); return; }
    if (req.user!.approved) { res.redirect('/'); return; }
    res.setHeader('Content-Type', 'text/html; charset=utf-8').send(readFile('pending.html'));
  });

  router.post('/auth/register', async (req: Request, res: Response) => {
    const { email, password, display_name } = req.body as {
      email?: string; password?: string; display_name?: string;
    };
    const pwError = validatePasswordComplexity(password || '');
    if (!email || pwError) {
      res.redirect(`/login?error=${pwError ? 'weak' : 'invalid'}`); return;
    }
    try {
      const hash = await bcrypt.hash(password!, 12);
      const name = (display_name || '').trim() || email.split('@')[0];
      const user = await createLocalUser(pool, email.toLowerCase().trim(), name, hash);
      if (!user.is_admin) {
        notifyAdminsOfNewUser(pool, user.email, user.display_name).catch(e =>
          console.error('Admin registration notification failed:', e)
        );
      }
      req.login(user, (err) => {
        if (err) { res.redirect('/login?error=1'); return; }
        res.redirect(user.approved ? '/' : '/pending');
      });
    } catch {
      res.redirect('/login?error=taken');
    }
  });

  router.post('/auth/login',
    passport.authenticate('local', { failureRedirect: '/login?error=1' }),
    (req: Request, res: Response) => {
      res.redirect(req.user!.approved ? '/' : '/pending');
    }
  );

  router.post('/auth/logout', (req: Request, res: Response) => {
    req.logout(() => {
      req.session.destroy(() => res.redirect('/login'));
    });
  });

  router.get('/auth/forgot-password', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8').send(readFile('forgot-password.html'));
  });

  router.post('/auth/forgot-password', async (req: Request, res: Response) => {
    const { email } = req.body as { email?: string };
    if (!email) { res.redirect('/auth/forgot-password?sent=1'); return; }
    try {
      const user = await pool.query<{ id: number; password_hash: string | null }>(
        'SELECT id, password_hash FROM users WHERE email=$1',
        [email.toLowerCase().trim()]
      );
      const u = user.rows[0];
      if (u && u.password_hash) {
        const token = await createPasswordResetToken(pool, u.id);
        const base = process.env.APP_BASE_URL || 'http://localhost:3000';
        await sendPasswordResetEmail(email, `${base}/auth/reset-password?token=${token}`);
      }
    } catch (e) {
      console.error('Password reset email error:', e);
    }
    res.redirect('/auth/forgot-password?sent=1');
  });

  router.get('/auth/reset-password', async (req: Request, res: Response) => {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    // No token means we're showing an error page (e.g. after ?error=invalid redirect) — serve as-is
    if (!token) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8').send(readFile('reset-password.html'));
      return;
    }
    if (!(await validatePasswordResetToken(pool, token))) {
      res.redirect('/auth/reset-password?error=invalid');
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8').send(readFile('reset-password.html'));
  });

  router.post('/auth/reset-password', async (req: Request, res: Response) => {
    const { token, password } = req.body as { token?: string; password?: string };
    if (!token || !password) { res.redirect('/auth/reset-password?error=invalid'); return; }
    const pwError = validatePasswordComplexity(password);
    if (pwError) { res.redirect(`/auth/reset-password?token=${encodeURIComponent(token)}&error=weak`); return; }
    const userId = await consumePasswordResetToken(pool, token);
    if (!userId) { res.redirect('/auth/reset-password?error=invalid'); return; }
    const hash = await bcrypt.hash(password, 12);
    await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, userId]);
    res.redirect('/login?reset=1');
  });

  if (providers.google) {
    router.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
    router.get('/auth/google/callback',
      passport.authenticate('google', { failureRedirect: '/login?error=1' }),
      (req: Request, res: Response) => res.redirect(req.user!.approved ? '/' : '/pending')
    );
  }

  if (providers.facebook) {
    router.get('/auth/facebook', passport.authenticate('facebook', { scope: ['email'] }));
    router.get('/auth/facebook/callback',
      passport.authenticate('facebook', { failureRedirect: '/login?error=1' }),
      (req: Request, res: Response) => res.redirect(req.user!.approved ? '/' : '/pending')
    );
  }

  if (providers.microsoft) {
    router.get('/auth/microsoft', passport.authenticate('microsoft'));
    router.get('/auth/microsoft/callback',
      passport.authenticate('microsoft', { failureRedirect: '/login?error=1' }),
      (req: Request, res: Response) => res.redirect(req.user!.approved ? '/' : '/pending')
    );
  }

  router.get('/admin', requireAdmin, async (req: Request, res: Response) => {
    const [usersResult, weeksResult, settingResult, freezerResult] = await Promise.all([
      pool.query<AppUser & { created_at: string }>(
        'SELECT id, email, display_name, approved, is_admin, created_at FROM users ORDER BY created_at'
      ),
      pool.query<{ id: number; label: string }>(
        'SELECT id, label FROM weeks ORDER BY sort_order'
      ),
      pool.query<{ value: string }>(
        "SELECT value FROM app_settings WHERE key='active_week_id'"
      ),
      pool.query<{ id: number; label: string }>(
        'SELECT id, label FROM freezer_options ORDER BY sort_order, label'
      ),
    ]);
    const weeks = weeksResult.rows;
    const activeWeekId = parseInt(settingResult.rows[0]?.value ?? '0');
    const me = req.user!.id;
    const rows = usersResult.rows.map(u => {
      const isSelf = u.id === me;
      const actions = isSelf ? '<span style="color:var(--text2);font-size:12px">(you)</span>' : `
        <div class="actions">
          ${!u.approved ? `<form method="post" action="/admin/users/${u.id}/approve"><button class="btn-approve">Approve</button></form>` : ''}
          <form method="post" action="/admin/users/${u.id}/reject" onsubmit="return confirm('Remove ${esc(u.email)}?')"><button class="btn-reject">Remove</button></form>
        </div>`;
      return `<tr>
        <td>${esc(u.email)}</td>
        <td>${esc(u.display_name)}</td>
        <td>${u.approved ? '<span class="badge ok">Approved</span>' : '<span class="badge pending">Pending</span>'}</td>
        <td>${u.is_admin ? '<span class="badge admin">Admin</span>' : ''}</td>
        <td>${new Date(u.created_at).toLocaleDateString()}</td>
        <td>${actions}</td>
      </tr>`;
    }).join('');

    res.setHeader('Content-Type', 'text/html; charset=utf-8').send(adminPage(rows, weeks, activeWeekId, freezerResult.rows));
  });

  router.post('/admin/users/:id/approve', requireAdmin, async (req: Request, res: Response) => {
    await pool.query('UPDATE users SET approved=true WHERE id=$1', [req.params.id]);
    res.redirect('/admin');
  });

  router.post('/admin/users/:id/reject', requireAdmin, async (req: Request, res: Response) => {
    await pool.query('DELETE FROM users WHERE id=$1 AND id!=$2', [req.params.id, req.user!.id]);
    res.redirect('/admin');
  });

  router.post('/admin/reset-session', requireAdmin, async (req: Request, res: Response) => {
    const weekId = parseInt(req.body.weekId as string);
    if (!weekId) { res.redirect('/admin'); return; }
    const weekRes = await pool.query<{ label: string }>(
      'SELECT label FROM weeks WHERE id=$1', [weekId]
    );
    if (!weekRes.rows.length) { res.redirect('/admin'); return; }
    const weekLabel = weekRes.rows[0].label;
    const userName = (req.user as AppUser).display_name;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const dishRes = await client.query<{ id: number; name: string; category: string }>(
        'SELECT id, name, category FROM dishes WHERE week_id=$1', [weekId]
      );
      for (const d of dishRes.rows) {
        await client.query('UPDATE sessions SET used=0, updated_at=NOW() WHERE dish_id=$1', [d.id]);
        await client.query('UPDATE dishes SET corrections=0, updated_at=NOW() WHERE id=$1', [d.id]);
        await client.query(
          `INSERT INTO audit_log(device_ip, user_name, week_label, dish_name, category, field, old_value, new_value)
           VALUES($1,$2,$3,$4,$5,'SESSION_RESET',NULL,0)`,
          [req.ip, userName, weekLabel, d.name, d.category]
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    reloadState().catch(() => {});
    res.redirect('/admin');
  });

  router.post('/admin/delete-week', requireAdmin, async (req: Request, res: Response) => {
    const weekId = parseInt(req.body.weekId as string);
    if (!weekId) { res.redirect('/admin'); return; }
    try {
      await deleteWeekFn(weekId, req.ip ?? 'unknown', (req.user as AppUser).display_name);
      await reloadState();
    } catch (e) {
      console.error('delete-week error:', (e as Error).message);
    }
    res.redirect('/admin');
  });

  router.post('/admin/reset-all', requireAdmin, async (req: Request, res: Response) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE dishes SET start=0, ordered=0, corrections=0');
      await client.query('UPDATE sessions SET used=0');
      await client.query(
        `INSERT INTO audit_log(device_ip, user_name, week_label, dish_name, category, field, old_value, new_value)
         VALUES($1,$2,'ALL','ALL','ALL','GLOBAL_RESET',NULL,0)`,
        [req.ip, (req.user as AppUser).display_name]
      );
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    reloadState().catch(() => {});
    res.redirect('/admin');
  });

  router.post('/admin/import-stock', requireAdmin, async (req: Request, res: Response) => {
    const { weekId, csv, resetWeeks } = req.body as { weekId?: number; csv?: string; resetWeeks?: boolean };
    if ((!weekId && !resetWeeks) || !csv) { res.json({ error: 'csv is required' }); return; }
    try {
      const result = await importStock(pool, weekId ?? 0, csv, !!resetWeeks, req.ip ?? 'unknown', (req.user as AppUser).display_name);
      reloadState().catch(() => {});
      res.json(result);
    } catch (e) {
      res.json({ error: (e as Error).message });
    }
  });

  router.post('/admin/freezer-options/add', requireAdmin, async (req: Request, res: Response) => {
    const label = ((req.body.label as string) ?? '').trim();
    if (!label) { res.redirect('/admin'); return; }
    await pool.query(
      `INSERT INTO freezer_options(label, sort_order)
       VALUES($1, (SELECT COALESCE(MAX(sort_order)+1, 0) FROM freezer_options))
       ON CONFLICT(label) DO NOTHING`,
      [label]
    );
    reloadState().catch(() => {});
    res.redirect('/admin');
  });

  router.post('/admin/freezer-options/delete', requireAdmin, async (req: Request, res: Response) => {
    const id = parseInt(req.body.id as string);
    if (id) await pool.query('DELETE FROM freezer_options WHERE id=$1', [id]);
    reloadState().catch(() => {});
    res.redirect('/admin');
  });

  router.post('/admin/sql', requireAdmin, async (req: Request, res: Response) => {
    const { query } = req.body as { query?: string };
    if (!query?.trim()) {
      res.json({ error: 'No query provided' }); return;
    }
    try {
      const result = await pool.query(query);
      const columns = (result.fields ?? []).map((f: { name: string }) => f.name);
      const rows = (result.rows ?? []).map((r: Record<string, unknown>) =>
        columns.map((c: string) => r[c])
      );
      res.json({ columns, rows, rowCount: result.rowCount ?? 0 });
    } catch (e: unknown) {
      res.json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  return router;
}
