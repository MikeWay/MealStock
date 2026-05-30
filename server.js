/**
 * Meal Stock Control — Server v2 (PostgreSQL + WebSocket)
 * ─────────────────────────────────────────────────────────
 * Setup:   node setup-db.js   (once only)
 * Run:     node server.js
 * Tablets: open http://<this-pc-ip>:3000 in any browser
 */

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const { WebSocketServer } = require('ws');
const { Pool }            = require('pg');
const cfg                 = require('./db-config');

const PORT = 3000;
const pool = new Pool(cfg);

const SESSIONS = [
  'Tues Improv','Tues Cruisers','Wed Diners','Wed Dinghies',
  'Thurs Diners','Thurs Juniors','Thurs Cruisers','Friday'
];

// ── Database helpers ───────────────────────────────────────────────

async function loadFullState() {
  const client = await pool.connect();
  try {
    const weeksRes = await client.query(
      'SELECT id, label FROM weeks ORDER BY sort_order, id'
    );
    const dishesRes = await client.query(
      'SELECT id, week_id, category, sort_order, name, diet, start, ordered, corrections FROM dishes ORDER BY sort_order, id'
    );
    const sessionsRes = await client.query(
      'SELECT dish_id, session_idx, used FROM sessions ORDER BY session_idx'
    );
    const settingRes = await client.query(
      "SELECT value FROM app_settings WHERE key='active_week_id'"
    );

    // Index sessions by dish_id
    const sessionsByDish = {};
    for (const row of sessionsRes.rows) {
      if (!sessionsByDish[row.dish_id]) sessionsByDish[row.dish_id] = Array(8).fill(0);
      sessionsByDish[row.dish_id][row.session_idx] = parseInt(row.used);
    }

    // Build week objects
    const weekMap = {};
    for (const w of weeksRes.rows) {
      weekMap[w.id] = { dbId: w.id, label: w.label, cats: { Meat: [], 'Non-Meat': [], Desserts: [] } };
    }

    // Group dishes into weeks/categories
    for (const d of dishesRes.rows) {
      const week = weekMap[d.week_id];
      if (!week) continue;
      const cat = d.category;
      if (!week.cats[cat]) week.cats[cat] = [];
      week.cats[cat].push({
        dbId:        d.id,
        name:        d.name,
        diet:        d.diet,
        start:       parseInt(d.start),
        ordered:     parseInt(d.ordered),
        corrections: parseInt(d.corrections),
        sessions:    sessionsByDish[d.id] || Array(8).fill(0),
      });
    }

    const weeks = weeksRes.rows.map(w => weekMap[w.id]);

    // Resolve activeWeek index from stored DB id
    const activeWeekDbId = parseInt(settingRes.rows[0]?.value || '0');
    let activeWeek = weeks.findIndex(w => w.dbId === activeWeekDbId);
    if (activeWeek < 0) activeWeek = 0;

    return { activeWeek, weeks };
  } finally {
    client.release();
  }
}

async function applyCellUpdate(msg, deviceIp) {
  const { weekIdx, cat, mi, field, si, value, state } = msg;
  // Resolve the dish dbId from the current state snapshot
  const dish = state.weeks[weekIdx]?.cats[cat]?.[mi];
  if (!dish || !dish.dbId) throw new Error('Dish not found in state');

  const dishId   = dish.dbId;
  const weekLabel = state.weeks[weekIdx].label;
  const oldValue  = field === 'session' ? dish.sessions[si] : dish[field];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (field === 'session') {
      await client.query(
        'UPDATE sessions SET used=$1, updated_at=NOW() WHERE dish_id=$2 AND session_idx=$3',
        [value, dishId, si]
      );
    } else {
      // start | ordered | corrections
      await client.query(
        `UPDATE dishes SET ${field}=$1, updated_at=NOW() WHERE id=$2`,
        [value, dishId]
      );
    }

    // Audit log
    const fieldLabel = field === 'session' ? `session:${SESSIONS[si]}` : field;
    await client.query(
      `INSERT INTO audit_log(device_ip, week_label, dish_name, category, field, old_value, new_value)
       VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [deviceIp, weekLabel, dish.name, cat, fieldLabel, oldValue, value]
    );

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function saveActiveWeek(weekDbId) {
  await pool.query(
    "INSERT INTO app_settings(key,value) VALUES('active_week_id',$1) ON CONFLICT(key) DO UPDATE SET value=$1",
    [String(weekDbId)]
  );
}

async function addWeek(label, prevWeek) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sortRes = await client.query('SELECT COALESCE(MAX(sort_order),0)+1 AS next FROM weeks');
    const sortOrder = sortRes.rows[0].next;
    const wRes = await client.query(
      'INSERT INTO weeks(label,sort_order) VALUES($1,$2) RETURNING id',
      [label, sortOrder]
    );
    const weekId = wRes.rows[0].id;

    for (const [cat, meals] of Object.entries(prevWeek.cats)) {
      for (let mi = 0; mi < meals.length; mi++) {
        const m = meals[mi];
        const remainder = Math.max(0,
          m.start + m.ordered + m.corrections + m.sessions.reduce((a,b) => a+b, 0)
        );
        const dRes = await client.query(
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

async function addDish(weekDbIds, cat, name, diet, startQty) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const addedIds = [];
    for (const weekId of weekDbIds) {
      const sortRes = await client.query(
        'SELECT COALESCE(MAX(sort_order),0)+1 AS next FROM dishes WHERE week_id=$1 AND category=$2',
        [weekId, cat]
      );
      const sort = sortRes.rows[0].next;
      const dRes = await client.query(
        `INSERT INTO dishes(week_id,category,sort_order,name,diet,start,ordered,corrections)
         VALUES($1,$2,$3,$4,$5,$6,0,0) RETURNING id`,
        [weekId, cat, sort, name, diet, startQty]
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

async function logOrder(dishDbId, qty, weekLabel, dishName, cat, oldVal, deviceIp) {
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

async function resetSessionUsage(weekDbId, weekLabel, deviceIp) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Get all dish ids for this week
    const dishRes = await client.query(
      'SELECT id, name, category FROM dishes WHERE week_id=$1', [weekDbId]
    );
    for (const d of dishRes.rows) {
      await client.query(
        'UPDATE sessions SET used=0, updated_at=NOW() WHERE dish_id=$1', [d.id]
      );
      await client.query(
        'UPDATE dishes SET corrections=0, updated_at=NOW() WHERE id=$1', [d.id]
      );
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

async function getAuditLog(limit = 200) {
  const res = await pool.query(
    `SELECT id, changed_at, device_ip, week_label, dish_name, category, field, old_value, new_value
     FROM audit_log ORDER BY changed_at DESC LIMIT $1`,
    [limit]
  );
  return res.rows;
}

// ── HTTP server ────────────────────────────────────────────────────

function getClientHTML() {
  const p = path.join(__dirname, 'client.html');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8')
    : '<h1>client.html not found</h1>';
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
      res.writeHead(500); return res.end(e.message);
    }
  }
  res.writeHead(404); res.end('Not found');
});

// ── WebSocket server ───────────────────────────────────────────────

const wss = new WebSocketServer({ server });

// In-memory cache so we can resolve dbIds for cell updates
let cachedState = null;

function broadcast(msg, excludeSocket) {
  const text = JSON.stringify(msg);
  wss.clients.forEach(c => {
    if (c !== excludeSocket && c.readyState === 1) c.send(text);
  });
}

wss.on('connection', async (ws, req) => {
  const deviceIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  // Send current state
  try {
    if (!cachedState) cachedState = await loadFullState();
    ws.send(JSON.stringify({ type: 'full_state', data: cachedState }));
  } catch (e) {
    ws.send(JSON.stringify({ type: 'error', message: 'DB load failed: ' + e.message }));
  }

  ws.on('message', async raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    try {
      if (msg.type === 'cell_update') {
        // Pass current cached state so server can resolve dbIds
        msg.state = cachedState;
        await applyCellUpdate(msg, deviceIp);
        // Update cache
        const item = cachedState.weeks[msg.weekIdx]?.cats[msg.cat]?.[msg.mi];
        if (item) {
          if (msg.field === 'session') item.sessions[msg.si] = msg.value;
          else item[msg.field] = msg.value;
        }
        // Relay to other clients (without the state blob)
        const relay = { type: 'cell_update', weekIdx: msg.weekIdx, cat: msg.cat, mi: msg.mi, field: msg.field, si: msg.si, value: msg.value };
        broadcast(relay, ws);

      } else if (msg.type === 'set_active_week') {
        cachedState.activeWeek = msg.weekIdx;
        await saveActiveWeek(cachedState.weeks[msg.weekIdx]?.dbId);
        broadcast({ type: 'set_active_week', weekIdx: msg.weekIdx }, ws);

      } else if (msg.type === 'add_week') {
        const prevWeek = cachedState.weeks[cachedState.weeks.length - 1];
        await addWeek(msg.label, prevWeek);
        cachedState = await loadFullState();
        cachedState.activeWeek = cachedState.weeks.length - 1;
        await saveActiveWeek(cachedState.weeks[cachedState.activeWeek].dbId);
        broadcast({ type: 'full_state', data: cachedState }, ws);
        ws.send(JSON.stringify({ type: 'full_state', data: cachedState }));

      } else if (msg.type === 'add_dish') {
        const weekDbIds = cachedState.weeks.map(w => w.dbId);
        await addDish(weekDbIds, msg.cat, msg.name, msg.diet, msg.startQty);
        cachedState = await loadFullState();
        broadcast({ type: 'full_state', data: cachedState }, ws);
        ws.send(JSON.stringify({ type: 'full_state', data: cachedState }));

      } else if (msg.type === 'log_order') {
        const week = cachedState.weeks[msg.weekIdx];
        const dish = week?.cats[msg.cat]?.[msg.mi];
        if (!dish) return;
        await logOrder(dish.dbId, msg.qty, week.label, dish.name, msg.cat, dish.ordered, deviceIp);
        dish.ordered += msg.qty;
        broadcast({ type: 'cell_update', weekIdx: msg.weekIdx, cat: msg.cat, mi: msg.mi, field: 'ordered', value: dish.ordered }, ws);
        ws.send(JSON.stringify({ type: 'cell_update', weekIdx: msg.weekIdx, cat: msg.cat, mi: msg.mi, field: 'ordered', value: dish.ordered }));

      } else if (msg.type === 'reset_session') {
        const week = cachedState.weeks[msg.weekIdx];
        await resetSessionUsage(week.dbId, week.label, deviceIp);
        cachedState = await loadFullState();
        broadcast({ type: 'full_state', data: cachedState }, ws);
        ws.send(JSON.stringify({ type: 'full_state', data: cachedState }));
      }

    } catch (e) {
      console.error('WS handler error:', e.message);
      ws.send(JSON.stringify({ type: 'error', message: e.message }));
    }
  });

  ws.on('error', () => {});
});

// ── Start ──────────────────────────────────────────────────────────

async function main() {
  // Test DB connection
  try {
    await pool.query('SELECT 1');
    console.log('PostgreSQL connected.');
  } catch (e) {
    console.error('\nERROR: Cannot connect to PostgreSQL.');
    console.error(e.message);
    console.error('\nCheck db-config.js has the correct host/user/password.');
    console.error('Make sure PostgreSQL is running (check Services in Windows).\n');
    process.exit(1);
  }

  // Pre-load state into cache
  cachedState = await loadFullState();

  server.listen(PORT, '0.0.0.0', () => {
    const { networkInterfaces } = require('os');
    const nets = networkInterfaces();
    console.log('\n╔══════════════════════════════════════════════════╗');
    console.log('║   Meal Stock Control Server (PostgreSQL)         ║');
    console.log('╠══════════════════════════════════════════════════╣');
    console.log(`║  Local:   http://localhost:${PORT}                   ║`);
    Object.values(nets).flat()
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
