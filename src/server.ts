import http from 'http';
import net from 'net';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { WebSocketServer, WebSocket } from 'ws';
import { Pool } from 'pg';
import express, { Request, Response } from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import passport from 'passport';
import cfg from './db-config';
import { AppUser, configurePassport, requireAuth } from './auth';
import { createAuthRouter, OAuthProviders } from './routes';

const PORT = parseInt(process.env.PORT || '3000');
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/$/, '');
const SERVER_STARTED_AT = Date.now();
const APP_VERSION = (() => {
  try { return (JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')) as { version: string }).version; }
  catch { return '0.0.0'; }
})();
const pool = new Pool(cfg);

const SESSIONS = [
  'Tues Improv', 'Tues Cruisers', 'Wed Diners', 'Wed Dinghies',
  'Thurs Diners', 'Thurs Juniors', 'Thurs Cruisers', 'Friday',
] as const;

type Category = 'Meat' | 'Non-Meat' | 'Desserts';
type MutableDishField = 'start' | 'ordered' | 'corrections';

interface Dish {
  dbId: number;
  name: string;
  diet: string;
  freezer: string;
  start: number;
  ordered: number;
  corrections: number;
  sessions: number[];
}

type DishCats = Record<Category, Dish[]>;

interface Week {
  dbId: number;
  label: string;
  cats: DishCats;
}

interface AppState {
  activeWeek: number;
  weeks: Week[];
  freezerOptions: string[];
}

interface CellUpdateMsg {
  weekIdx: number;
  cat: Category;
  mi: number;
  field: MutableDishField | 'session';
  si?: number;
  value: number;
}

// ── Database helpers ────────────────────────────────────────────────

async function loadFullState(): Promise<AppState> {
  const client = await pool.connect();
  try {
    const weeksRes = await client.query<{ id: number; label: string }>(
      'SELECT id, label FROM weeks ORDER BY sort_order, id'
    );
    const dishesRes = await client.query<{
      id: number; week_id: number; category: string;
      name: string; diet: string; freezer: string; start: number; ordered: number; corrections: number;
    }>(
      'SELECT id, week_id, category, sort_order, name, diet, freezer, start, ordered, corrections FROM dishes ORDER BY sort_order, id'
    );
    const sessionsRes = await client.query<{ dish_id: number; session_idx: number; used: number }>(
      'SELECT dish_id, session_idx, used FROM sessions ORDER BY session_idx'
    );
    const settingRes = await client.query<{ value: string }>(
      "SELECT value FROM app_settings WHERE key='active_week_id'"
    );
    const freezerRes = await client.query<{ label: string }>(
      'SELECT label FROM freezer_options ORDER BY sort_order, label'
    );

    const sessionsByDish: Record<number, number[]> = {};
    for (const row of sessionsRes.rows) {
      if (!sessionsByDish[row.dish_id]) sessionsByDish[row.dish_id] = Array(8).fill(0) as number[];
      sessionsByDish[row.dish_id][row.session_idx] = row.used;
    }

    const weekMap: Record<number, Week> = {};
    for (const w of weeksRes.rows) {
      weekMap[w.id] = { dbId: w.id, label: w.label, cats: { Meat: [], 'Non-Meat': [], Desserts: [] } };
    }

    for (const d of dishesRes.rows) {
      const week = weekMap[d.week_id];
      if (!week) continue;
      const cat = d.category as Category;
      week.cats[cat].push({
        dbId:        d.id,
        name:        d.name,
        diet:        d.diet,
        freezer:     d.freezer,
        start:       d.start,
        ordered:     d.ordered,
        corrections: d.corrections,
        sessions:    sessionsByDish[d.id] ?? (Array(8).fill(0) as number[]),
      });
    }

    const weeks = weeksRes.rows.map(w => weekMap[w.id]);
    const activeWeekDbId = parseInt(settingRes.rows[0]?.value ?? '0');
    let activeWeek = weeks.findIndex(w => w.dbId === activeWeekDbId);
    if (activeWeek < 0) activeWeek = 0;

    return { activeWeek, weeks, freezerOptions: freezerRes.rows.map(r => r.label) };
  } finally {
    client.release();
  }
}

async function applyCellUpdate(
  msg: CellUpdateMsg, state: AppState, deviceIp: string, userName: string
): Promise<void> {
  const dish = state.weeks[msg.weekIdx]?.cats[msg.cat]?.[msg.mi];
  if (!dish?.dbId) throw new Error('Dish not found in state');

  const dishId    = dish.dbId;
  const weekLabel = state.weeks[msg.weekIdx].label;
  const oldValue  = msg.field === 'session'
    ? dish.sessions[msg.si ?? 0]
    : dish[msg.field as MutableDishField];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (msg.field === 'session') {
      await client.query(
        'UPDATE sessions SET used=$1, updated_at=NOW() WHERE dish_id=$2 AND session_idx=$3',
        [msg.value, dishId, msg.si]
      );
    } else {
      await client.query(
        `UPDATE dishes SET ${msg.field}=$1, updated_at=NOW() WHERE id=$2`,
        [msg.value, dishId]
      );
    }

    const fieldLabel = msg.field === 'session' ? `session:${SESSIONS[msg.si ?? 0]}` : msg.field;
    await client.query(
      `INSERT INTO audit_log(device_ip, user_name, week_label, dish_name, category, field, old_value, new_value)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [deviceIp, userName, weekLabel, dish.name, msg.cat, fieldLabel, oldValue, msg.value]
    );

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function saveActiveWeek(weekDbId: number): Promise<void> {
  await pool.query(
    "INSERT INTO app_settings(key,value) VALUES('active_week_id',$1) ON CONFLICT(key) DO UPDATE SET value=$1",
    [String(weekDbId)]
  );
}


async function addWeek(label: string, prevWeek: Week): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sortRes = await client.query<{ next: number }>(
      'SELECT COALESCE(MAX(sort_order),0)+1 AS next FROM weeks'
    );
    const wRes = await client.query<{ id: number }>(
      'INSERT INTO weeks(label,sort_order) VALUES($1,$2) RETURNING id',
      [label, sortRes.rows[0].next]
    );
    const weekId = wRes.rows[0].id;

    for (const [cat, meals] of Object.entries(prevWeek.cats) as [Category, Dish[]][]) {
      for (let mi = 0; mi < meals.length; mi++) {
        const m = meals[mi];
        const remainder = Math.max(0,
          m.start + m.ordered + m.corrections - m.sessions.reduce((a, b) => a + b, 0)
        );
        const dRes = await client.query<{ id: number }>(
          `INSERT INTO dishes(week_id,category,sort_order,name,diet,freezer,start,ordered,corrections)
           VALUES($1,$2,$3,$4,$5,$6,$7,0,0) RETURNING id`,
          [weekId, cat, mi, m.name, m.diet, m.freezer, remainder]
        );
        const dishId = dRes.rows[0].id;
        for (let si = 0; si < SESSIONS.length; si++) {
          await client.query(
            'INSERT INTO sessions(dish_id,session_idx,session_name,used) VALUES($1,$2,$3,0)',
            [dishId, si, SESSIONS[si]]
          );
        }
      }
    }

    await client.query('COMMIT');
    return weekId;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function addDish(
  weekDbIds: number[], cat: Category, name: string, diet: string, startQty: number
): Promise<number[]> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const addedIds: number[] = [];
    for (const weekId of weekDbIds) {
      const sortRes = await client.query<{ next: number }>(
        'SELECT COALESCE(MAX(sort_order),0)+1 AS next FROM dishes WHERE week_id=$1 AND category=$2',
        [weekId, cat]
      );
      const dRes = await client.query<{ id: number }>(
        `INSERT INTO dishes(week_id,category,sort_order,name,diet,freezer,start,ordered,corrections)
         VALUES($1,$2,$3,$4,$5,'',$6,0,0) RETURNING id`,
        [weekId, cat, sortRes.rows[0].next, name, diet, startQty]
      );
      const dishId = dRes.rows[0].id;
      for (let si = 0; si < SESSIONS.length; si++) {
        await client.query(
          'INSERT INTO sessions(dish_id,session_idx,session_name,used) VALUES($1,$2,$3,0)',
          [dishId, si, SESSIONS[si]]
        );
      }
      addedIds.push(dishId);
    }
    await client.query('COMMIT');
    return addedIds;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function logOrder(
  dishDbId: number, qty: number, weekLabel: string,
  dishName: string, cat: Category, oldVal: number, deviceIp: string, userName: string
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'UPDATE dishes SET ordered=ordered+$1, updated_at=NOW() WHERE id=$2',
      [qty, dishDbId]
    );
    await client.query(
      `INSERT INTO audit_log(device_ip, user_name, week_label, dish_name, category, field, old_value, new_value)
       VALUES($1,$2,$3,$4,$5,'ordered',$6,$7)`,
      [deviceIp, userName, weekLabel, dishName, cat, oldVal, oldVal + qty]
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function resetSessionUsage(
  weekDbId: number, weekLabel: string, deviceIp: string, userName: string
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const dishRes = await client.query<{ id: number; name: string; category: string }>(
      'SELECT id, name, category FROM dishes WHERE week_id=$1', [weekDbId]
    );
    for (const d of dishRes.rows) {
      await client.query('UPDATE sessions SET used=0, updated_at=NOW() WHERE dish_id=$1', [d.id]);
      await client.query('UPDATE dishes SET corrections=0, updated_at=NOW() WHERE id=$1', [d.id]);
      await client.query(
        `INSERT INTO audit_log(device_ip, user_name, week_label, dish_name, category, field, old_value, new_value)
         VALUES($1,$2,$3,$4,$5,'SESSION_RESET',NULL,0)`,
        [deviceIp, userName, weekLabel, d.name, d.category]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function deleteWeek(weekDbId: number, state: AppState, deviceIp: string, userName: string): Promise<void> {
  const weekIdx = state.weeks.findIndex(w => w.dbId === weekDbId);
  if (weekIdx === -1 || weekIdx <= state.activeWeek) {
    throw new Error('Only future weeks can be deleted');
  }

  const deletedWeek = state.weeks[weekIdx];
  const nextWeek = state.weeks[weekIdx + 1] ?? null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (nextWeek) {
      for (const [cat, dishes] of Object.entries(deletedWeek.cats) as [Category, Dish[]][]) {
        for (let mi = 0; mi < dishes.length; mi++) {
          const d = dishes[mi];
          const left = Math.max(0, d.start + d.ordered + d.corrections - d.sessions.reduce((a, b) => a + b, 0));
          const nextDish = nextWeek.cats[cat]?.[mi];
          if (nextDish?.dbId) {
            await client.query('UPDATE dishes SET start=$1, updated_at=NOW() WHERE id=$2', [left, nextDish.dbId]);
          }
        }
      }
    }

    await client.query(
      'DELETE FROM sessions WHERE dish_id IN (SELECT id FROM dishes WHERE week_id=$1)',
      [weekDbId]
    );
    await client.query('DELETE FROM dishes WHERE week_id=$1', [weekDbId]);
    await client.query('DELETE FROM weeks WHERE id=$1', [weekDbId]);

    await client.query(
      `INSERT INTO audit_log(device_ip, user_name, week_label, dish_name, category, field, old_value, new_value)
       VALUES($1,$2,$3,'ALL','ALL','WEEK_DELETED',NULL,0)`,
      [deviceIp, userName, deletedWeek.label]
    );

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function deleteDish(name: string, cat: Category, deviceIp: string, userName: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query<{ week_id: number }>(
      'DELETE FROM dishes WHERE name=$1 AND category=$2 RETURNING week_id',
      [name, cat]
    );
    for (const row of res.rows) {
      const weekRes = await client.query<{ label: string }>('SELECT label FROM weeks WHERE id=$1', [row.week_id]);
      const weekLabel = weekRes.rows[0]?.label ?? 'unknown';
      await client.query(
        `INSERT INTO audit_log(device_ip, user_name, week_label, dish_name, category, field, old_value, new_value)
         VALUES($1,$2,$3,$4,$5,'DISH_DELETED',NULL,0)`,
        [deviceIp, userName, weekLabel, name, cat]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function getAuditLog(limit = 200): Promise<unknown[]> {
  const res = await pool.query(
    `SELECT id, changed_at, device_ip, user_name, week_label, dish_name, category, field, old_value, new_value
     FROM audit_log ORDER BY changed_at DESC LIMIT $1`,
    [limit]
  );
  return res.rows;
}

// ── Express app ─────────────────────────────────────────────────────

const providers: OAuthProviders = {
  google:    !!(process.env.GOOGLE_CLIENT_ID    && process.env.GOOGLE_CLIENT_SECRET),
  facebook:  !!(process.env.FACEBOOK_APP_ID     && process.env.FACEBOOK_APP_SECRET),
  microsoft: !!(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET),
};

configurePassport(pool);

const PgStore = connectPgSimple(session);
const sessionMiddleware = session({
  store: new PgStore({ pool, createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' },
});

function getClientHTML(): string {
  const p = path.join(__dirname, '..', 'client.html');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '<h1>client.html not found</h1>';
}

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(sessionMiddleware);
app.use(passport.initialize());
app.use(passport.session());
const reloadState = async (): Promise<void> => {
  try {
    cachedState = await loadFullState();
    broadcast({ type: 'full_state', data: cachedState });
  } catch (e) {
    console.error('reloadState error:', (e as Error).message);
    cachedState = null;
  }
};
app.use(BASE_PATH, createAuthRouter(pool, providers, reloadState, BASE_PATH, async (weekDbId, deviceIp, userName) => {
  await deleteWeek(weekDbId, cachedState!, deviceIp, userName);
}));

app.get(`${BASE_PATH}/`, requireAuth, (req: Request, res: Response) => {
  const user = req.user!;
  const script = `<script>window.__USER__=${JSON.stringify({ is_admin: user.is_admin, display_name: user.display_name })};window.__BASE_PATH__=${JSON.stringify(BASE_PATH)};</script>`;
  const html = getClientHTML().replace('</head>', `${script}\n</head>`);
  res.setHeader('Content-Type', 'text/html; charset=utf-8').send(html);
});

app.get(`${BASE_PATH}/version`, requireAuth, (_req: Request, res: Response) => {
  res.json({ version: SERVER_STARTED_AT, appVersion: APP_VERSION });
});

app.get(`${BASE_PATH}/audit`, requireAuth, async (_req: Request, res: Response) => {
  try {
    const rows = await getAuditLog(500);
    res.setHeader('Content-Type', 'application/json').send(JSON.stringify(rows));
  } catch (e) {
    res.status(500).send((e as Error).message);
  }
});

const server = http.createServer(app);

// ── WebSocket server ─────────────────────────────────────────────────
// noServer mode: upgrades are validated manually before handleUpgrade

const wss = new WebSocketServer({ noServer: true });

let cachedState: AppState | null = null;

function broadcast(msg: unknown, excludeSocket?: WebSocket): void {
  const text = JSON.stringify(msg);
  wss.clients.forEach(c => {
    if (c !== excludeSocket && c.readyState === WebSocket.OPEN) c.send(text);
  });
}

wss.on('connection', async (ws, req) => {
  const user = (req as unknown as { user?: AppUser }).user;
  const userName = user?.display_name ?? 'unknown';
  const deviceIp = (req.headers['x-forwarded-for'] as string | undefined) ?? req.socket.remoteAddress ?? 'unknown';

  try {
    if (!cachedState) cachedState = await loadFullState();
    ws.send(JSON.stringify({ type: 'full_state', data: cachedState }));
  } catch (e) {
    ws.send(JSON.stringify({ type: 'error', message: 'DB load failed: ' + (e as Error).message }));
  }

  ws.on('message', async (raw) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let msg: any;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    try {
      if (msg.type === 'cell_update') {
        if (!(msg.field === 'start' && msg.weekIdx > 0)) {
          await applyCellUpdate(msg as CellUpdateMsg, cachedState!, deviceIp, userName);
          const item = cachedState!.weeks[msg.weekIdx]?.cats[msg.cat as Category]?.[msg.mi];
          if (item) {
            if (msg.field === 'session') item.sessions[msg.si as number] = msg.value;
            else item[msg.field as MutableDishField] = msg.value;
          }
          broadcast({ type: 'cell_update', weekIdx: msg.weekIdx, cat: msg.cat, mi: msg.mi, field: msg.field, si: msg.si, value: msg.value }, ws);
        }

      } else if (msg.type === 'set_active_week') {
        cachedState!.activeWeek = msg.weekIdx;
        await saveActiveWeek(cachedState!.weeks[msg.weekIdx]?.dbId);
        broadcast({ type: 'set_active_week', weekIdx: msg.weekIdx }, ws);

      } else if (msg.type === 'add_week') {
        const prevWeek = cachedState!.weeks[cachedState!.weeks.length - 1];
        await addWeek(msg.label as string, prevWeek);
        cachedState = await loadFullState();
        cachedState.activeWeek = cachedState.weeks.length - 1;
        await saveActiveWeek(cachedState.weeks[cachedState.activeWeek].dbId);
        broadcast({ type: 'full_state', data: cachedState }, ws);
        ws.send(JSON.stringify({ type: 'full_state', data: cachedState }));

      } else if (msg.type === 'add_dish') {
        const weekDbIds = cachedState!.weeks.map(w => w.dbId);
        await addDish(weekDbIds, msg.cat as Category, msg.name as string, msg.diet as string, msg.startQty as number);
        cachedState = await loadFullState();
        broadcast({ type: 'full_state', data: cachedState }, ws);
        ws.send(JSON.stringify({ type: 'full_state', data: cachedState }));

      } else if (msg.type === 'log_order') {
        const week = cachedState!.weeks[msg.weekIdx];
        const dish = week?.cats[msg.cat as Category]?.[msg.mi];
        if (!dish) return;
        await logOrder(dish.dbId, msg.qty as number, week.label, dish.name, msg.cat as Category, dish.ordered, deviceIp, userName);
        dish.ordered += msg.qty as number;
        const orderUpdate = { type: 'cell_update', weekIdx: msg.weekIdx, cat: msg.cat, mi: msg.mi, field: 'ordered', value: dish.ordered };
        broadcast(orderUpdate, ws);
        ws.send(JSON.stringify(orderUpdate));

      } else if (msg.type === 'delete_week') {
        const week = cachedState!.weeks[msg.weekIdx as number];
        if (!week) throw new Error('Week not found');
        await deleteWeek(week.dbId, cachedState!, deviceIp, userName);
        cachedState = await loadFullState();
        broadcast({ type: 'full_state', data: cachedState }, ws);
        ws.send(JSON.stringify({ type: 'full_state', data: cachedState }));

      } else if (msg.type === 'delete_dish') {
        if (!user?.is_admin) throw new Error('Admin only');
        const dish = cachedState!.weeks[msg.weekIdx]?.cats[msg.cat as Category]?.[msg.mi];
        if (!dish) throw new Error('Dish not found');
        await deleteDish(dish.name, msg.cat as Category, deviceIp, userName);
        cachedState = await loadFullState();
        broadcast({ type: 'full_state', data: cachedState }, ws);
        ws.send(JSON.stringify({ type: 'full_state', data: cachedState }));

      } else if (msg.type === 'update_freezer') {
        const dish = cachedState!.weeks[msg.weekIdx]?.cats[msg.cat as Category]?.[msg.mi];
        if (!dish) throw new Error('Dish not found');
        await pool.query(
          'UPDATE dishes SET freezer=$1, updated_at=NOW() WHERE id=$2',
          [msg.value, dish.dbId]
        );
        dish.freezer = msg.value as string;
        broadcast({ type: 'update_freezer', weekIdx: msg.weekIdx, cat: msg.cat, mi: msg.mi, value: msg.value }, ws);

      }

    } catch (e) {
      console.error('WS handler error:', (e as Error).message);
      ws.send(JSON.stringify({ type: 'error', message: (e as Error).message }));
    }
  });

  ws.on('error', () => {});
});

// Validate session + approval before accepting WebSocket upgrade
server.on('upgrade', (req: http.IncomingMessage, socket: net.Socket, head: Buffer) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sessionMiddleware(req as any, {} as any, () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    passport.initialize()(req as any, {} as any, () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      passport.session()(req as any, {} as any, () => {
        const user = (req as unknown as { user?: AppUser }).user;
        if (!user) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy(); return;
        }
        if (!user.approved) {
          socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
          socket.destroy(); return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit('connection', ws, req);
        });
      });
    });
  });
});

// ── Start ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if ((process.env.SESSION_SECRET || 'dev-secret-change-me') === 'dev-secret-change-me') {
    console.warn('\nWARNING: SESSION_SECRET is not set. Using insecure default — set SESSION_SECRET in production.\n');
  }

  try {
    await pool.query('SELECT 1');
    console.log('PostgreSQL connected.');
  } catch (e) {
    console.error('\nERROR: Cannot connect to PostgreSQL.');
    console.error((e as Error).message);
    console.error('\nCheck db-config.ts has the correct host/user/password.');
    console.error('Make sure PostgreSQL is running.\n');
    process.exit(1);
  }

  cachedState = await loadFullState();

  server.listen(PORT, '0.0.0.0', () => {
    const nets = os.networkInterfaces();
    console.log('\n╔══════════════════════════════════════════════════╗');
    console.log('║   Meal Stock Control Server (PostgreSQL)         ║');
    console.log('╠══════════════════════════════════════════════════╣');
    console.log(`║  Local:   http://localhost:${PORT}                   ║`);
    Object.values(nets)
      .flatMap(arr => arr ?? [])
      .filter(n => n.family === 'IPv4' && !n.internal)
      .forEach(n => {
        const url = `http://${n.address}:${PORT}`;
        const pad = ' '.repeat(Math.max(0, 48 - url.length));
        console.log(`║  Network: ${url}${pad}║`);
      });
    console.log('╠══════════════════════════════════════════════════╣');
    console.log('║  Login:   http://localhost:3000/login            ║');
    console.log('║  Admin:   http://localhost:3000/admin            ║');
    console.log('║  Audit:   http://localhost:3000/audit            ║');
    console.log('║  Press Ctrl+C to stop                            ║');
    console.log('╚══════════════════════════════════════════════════╝\n');
  });
}

main();
