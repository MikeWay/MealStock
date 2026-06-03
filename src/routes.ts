import { Router, Request, Response } from 'express';
import passport from 'passport';
import bcrypt from 'bcrypt';
import path from 'path';
import fs from 'fs';
import { Pool } from 'pg';
import { AppUser, createLocalUser, requireAdmin } from './auth';

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

function adminPage(rows: string): string {
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

export function createAuthRouter(pool: Pool, providers: OAuthProviders): Router {
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
    if (!email || !password || password.length < 8) {
      res.redirect('/login?error=invalid'); return;
    }
    try {
      const hash = await bcrypt.hash(password, 12);
      const name = (display_name || '').trim() || email.split('@')[0];
      const user = await createLocalUser(pool, email.toLowerCase().trim(), name, hash);
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
    const result = await pool.query<AppUser & { created_at: string }>(
      'SELECT id, email, display_name, approved, is_admin, created_at FROM users ORDER BY created_at'
    );
    const me = req.user!.id;
    const rows = result.rows.map(u => {
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

    res.setHeader('Content-Type', 'text/html; charset=utf-8').send(adminPage(rows));
  });

  router.post('/admin/users/:id/approve', requireAdmin, async (req: Request, res: Response) => {
    await pool.query('UPDATE users SET approved=true WHERE id=$1', [req.params.id]);
    res.redirect('/admin');
  });

  router.post('/admin/users/:id/reject', requireAdmin, async (req: Request, res: Response) => {
    await pool.query('DELETE FROM users WHERE id=$1 AND id!=$2', [req.params.id, req.user!.id]);
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
