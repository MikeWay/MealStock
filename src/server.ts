import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { WebSocketServer, WebSocket } from 'ws';
import { Pool } from 'pg';
import cfg from './db-config';

const PORT = 3000;
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
      name: string; diet: string; start: number; ordered: number; corrections: number;
    }>(
      'SELECT id, week_id, category, sort_order, name, diet, start, ordered, corrections FROM dishes ORDER BY sort_order, id'
    );
    const sessionsRes = await client.query<{ dish_id: number; session_idx: number; used: number }>(
      'SELECT dish_id, session_idx, used FROM sessions ORDER BY session_idx'
    );
    const settingRes = await client.query<{ value: string }>(
      "SELECT value FROM app_settings WHERE key='active_week_id'"
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

    return { activeWeek, weeks };
  } finally {
    client.release();
  }
}

async function applyCellUpdate(msg: CellUpdateMsg, state: AppState, deviceIp: string): Promise<void> {
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
      `INSERT INTO audit_log(device_ip, week_label, dish_name, category, field, old_value, new_value)
       VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [deviceIp, weekLabel, dish.name, msg.cat, fieldLabel, oldValue, msg.value]
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
          m.start + m.ordered + m.corrections + m.sessions.reduce((a, b) => a + b, 0)
        );
        const dRes = await client.query<{ id: number }>(
          `INSERT INTO dishes(week_id,category,sort_order,name,diet,start,ordered,corrections)
           VALUES($1,$2,$3,$4,$5,$6,0,0) RETURNING id`,
          [weekId, cat, mi, m.name, m.diet, remainder]
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
        `INSERT INTO dishes(week_id,category,sort_order,name,diet,start,ordered,corrections)
         VALUES($1,$2,$3,$4,$5,$6,0,0) RETURNING id`,
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
  dishName: string, cat: Category, oldVal: number, deviceIp: string
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'UPDATE dishes SET ordered=ordered+$1, updated_at=NOW() WHERE id=$2',
      [qty, dishDbId]
    );
    await client.query(
      `INSERT INTO audit_log(device_ip,week_label,dish_name,category,field,old_value,new_value)
       VALUES($1,$2,$3,$4,'ordered',$5,$6)`,
      [deviceIp, weekLabel, dishName, cat, oldVal, oldVal + qty]
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function resetSessionUsage(weekDbId: number, weekLabel: string, deviceIp: string): Promise<void> {
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
        `INSERT INTO audit_log(device_ip,week_label,dish_name,category,field,old_value,new_value)
         VALUES($1,$2,$3,$4,'SESSION_RESET',NULL,0)`,
        [deviceIp, weekLabel, d.name, d.category]
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
    `SELECT id, changed_at, device_ip, week_label, dish_name, category, field, old_value, new_value
     FROM audit_log ORDER BY changed_at DESC LIMIT $1`,
    [limit]
  );
  return res.rows;
}

// ── HTTP server ─────────────────────────────────────────────────────

function getClientHTML(): string {
  // client.html lives in project root; __dirname here is dist/
  const p = path.join(__dirname, '..', 'client.html');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '<h1>client.html not found</h1>';
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(getClientHTML());
  }
  if (req.method === 'GET' && req.url === '/audit') {
    try {
      const rows = await getAuditLog(500);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(rows));
    } catch (e) {
      res.writeHead(500);
      return res.end((e as Error).message);
    }
  }
  res.writeHead(404);
  res.end('Not found');
});

// ── WebSocket server ────────────────────────────────────────────────

const wss = new WebSocketServer({ server });

let cachedState: AppState | null = null;

function broadcast(msg: unknown, excludeSocket?: WebSocket): void {
  const text = JSON.stringify(msg);
  wss.clients.forEach(c => {
    if (c !== excludeSocket && c.readyState === WebSocket.OPEN) c.send(text);
  });
}

wss.on('connection', async (ws, req) => {
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
        await applyCellUpdate(msg as CellUpdateMsg, cachedState!, deviceIp);
        const item = cachedState!.weeks[msg.weekIdx]?.cats[msg.cat as Category]?.[msg.mi];
        if (item) {
          if (msg.field === 'session') item.sessions[msg.si as number] = msg.value;
          else item[msg.field as MutableDishField] = msg.value;
        }
        broadcast({ type: 'cell_update', weekIdx: msg.weekIdx, cat: msg.cat, mi: msg.mi, field: msg.field, si: msg.si, value: msg.value }, ws);

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
        await logOrder(dish.dbId, msg.qty as number, week.label, dish.name, msg.cat as Category, dish.ordered, deviceIp);
        dish.ordered += msg.qty as number;
        const orderUpdate = { type: 'cell_update', weekIdx: msg.weekIdx, cat: msg.cat, mi: msg.mi, field: 'ordered', value: dish.ordered };
        broadcast(orderUpdate, ws);
        ws.send(JSON.stringify(orderUpdate));

      } else if (msg.type === 'reset_session') {
        const week = cachedState!.weeks[msg.weekIdx];
        await resetSessionUsage(week.dbId, week.label, deviceIp);
        cachedState = await loadFullState();
        broadcast({ type: 'full_state', data: cachedState }, ws);
        ws.send(JSON.stringify({ type: 'full_state', data: cachedState }));
      }

    } catch (e) {
      console.error('WS handler error:', (e as Error).message);
      ws.send(JSON.stringify({ type: 'error', message: (e as Error).message }));
    }
  });

  ws.on('error', () => {});
});

// ── Start ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  try {
    await pool.query('SELECT 1');
    console.log('PostgreSQL connected.');
  } catch (e) {
    console.error('\nERROR: Cannot connect to PostgreSQL.');
    console.error((e as Error).message);
    console.error('\nCheck db-config.ts has the correct host/user/password.');
    console.error('Make sure PostgreSQL is running (check Services in Windows).\n');
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
    console.log('║  Audit log: http://localhost:3000/audit          ║');
    console.log('║  Share the Network URL with your tablets         ║');
    console.log('║  Press Ctrl+C to stop                            ║');
    console.log('╚══════════════════════════════════════════════════╝\n');
  });
}

main();
