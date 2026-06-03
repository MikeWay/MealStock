import { Pool } from 'pg';
import cfg from './db-config';

const pool = new Pool(cfg);

type Category = 'Meat' | 'Non-Meat' | 'Desserts';

interface SeedDish {
  name: string;
  diet: string;
  start: number;
  ordered: number;
  sessions: number[];
}

type SeedCats = Record<Category, SeedDish[]>;

interface SeedWeek {
  label: string;
  cats: SeedCats;
}

const SESSIONS = [
  'Tues Improv', 'Tues Cruisers', 'Wed Diners', 'Wed Dinghies',
  'Thurs Diners', 'Thurs Juniors', 'Thurs Cruisers', 'Friday',
] as const;

const DEFAULT_WEEKS: SeedWeek[] = [
  {
    label: 'w/c 26 May 2026',
    cats: {
      Meat: [
        { name: 'Chicken Rogan Josh',              diet: 'GF',           start: 10, ordered: 0,  sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Sweet and Sour Pork',             diet: 'GF, DF',       start: 13, ordered: 10, sessions: [0,-5,0,0,0,0,0,0] },
        { name: 'Beef Lasagne',                    diet: '',             start: 18, ordered: 0,  sessions: [0,0,-18,0,0,0,0,0] },
        { name: 'Lamb Hotpot',                     diet: 'DF',           start: 6,  ordered: 0,  sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Sausage & Mash with Onion Gravy', diet: '',             start: 8,  ordered: 0,  sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Fish Pie',                        diet: '',             start: 7,  ordered: 0,  sessions: [-2,0,0,0,0,0,0,0] },
        { name: 'Cod in Parsley Sauce',            diet: '',             start: 0,  ordered: 0,  sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Herby Crumbed Cod',               diet: '',             start: 0,  ordered: 0,  sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Hunters Chicken',                 diet: '',             start: 9,  ordered: 0,  sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Chicken Tagine',                  diet: '',             start: 0,  ordered: 6,  sessions: [0,0,-2,0,0,0,0,0] },
        { name: 'Creamy Tarragon Chicken',         diet: 'GF',           start: 0,  ordered: 0,  sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Spanish Chicken',                 diet: '',             start: 14, ordered: 0,  sessions: [-1,0,0,0,0,0,0,0] },
        { name: 'Beef Casserole',                  diet: 'GF',           start: 0,  ordered: 0,  sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Chicken Casserole',               diet: '',             start: 0,  ordered: 0,  sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Chilli Con Carne',                diet: '',             start: 10, ordered: 10, sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Cottage Pie',                     diet: '',             start: 0,  ordered: 0,  sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Moussaka',                        diet: '',             start: 8,  ordered: 0,  sessions: [0,0,0,0,0,0,0,0] },
      ],
      'Non-Meat': [
        { name: 'Spinach & Chickpea Curry',   diet: 'V, Vg, GF, DF', start: 27, ordered: 0, sessions: [-3,0,0,0,0,0,0,0] },
        { name: 'Aubergine Tagine',            diet: 'V, Vg, GF, DF', start: 21, ordered: 0, sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Shepherdess Pie',             diet: 'Vg',            start: 7,  ordered: 0, sessions: [0,0,-7,0,0,0,0,0] },
        { name: 'Nut Roast',                   diet: 'V, N',          start: 1,  ordered: 0, sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Roast Vegetable Lasagne',     diet: 'V',             start: 20, ordered: 0, sessions: [-1,0,0,0,0,0,0,0] },
      ],
      Desserts: [
        { name: 'Apple Pie',         diet: '', start: 15, ordered: 0,  sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Fruit Crumble',     diet: '', start: 14, ordered: 0,  sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Treacle Sponge',    diet: '', start: 7,  ordered: 0,  sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Tiramisu',          diet: '', start: 0,  ordered: 0,  sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Chocolate Brownie', diet: '', start: 0,  ordered: 35, sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Ice Cream',         diet: '', start: 0,  ordered: 0,  sessions: [0,0,0,0,0,0,0,0] },
      ],
    },
  },
  {
    label: 'w/c 02 Jun 2026',
    cats: {
      Meat: [
        { name: 'Chicken Rogan Josh',              diet: 'GF',           start: 10, ordered: 20, sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Sweet and Sour Pork',             diet: 'GF, DF',       start: 18, ordered: 0,  sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Beef Lasagne',                    diet: '',             start: 0,  ordered: 20, sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Lamb Hotpot',                     diet: 'DF',           start: 6,  ordered: 0,  sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Sausage & Mash with Onion Gravy', diet: '',             start: 8,  ordered: 0,  sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Fish Pie',                        diet: '',             start: 5,  ordered: 0,  sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Cod in Parsley Sauce',            diet: '',             start: 0,  ordered: 10, sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Herby Crumbed Cod',               diet: '',             start: 0,  ordered: 10, sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Hunters Chicken',                 diet: '',             start: 9,  ordered: 20, sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Chicken Tagine',                  diet: '',             start: 4,  ordered: 20, sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Creamy Tarragon Chicken',         diet: 'GF',           start: 0,  ordered: 10, sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Spanish Chicken',                 diet: '',             start: 13, ordered: 0,  sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Beef Casserole',                  diet: 'GF',           start: 0,  ordered: 0,  sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Chicken Casserole',               diet: '',             start: 0,  ordered: 0,  sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Chilli Con Carne',                diet: '',             start: 20, ordered: 0,  sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Cottage Pie',                     diet: '',             start: 0,  ordered: 0,  sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Moussaka',                        diet: '',             start: 8,  ordered: 0,  sessions: [0,0,0,0,0,0,0,0] },
      ],
      'Non-Meat': [
        { name: 'Spinach & Chickpea Curry',   diet: 'V, Vg, GF, DF', start: 24, ordered: 0,  sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Aubergine Tagine',            diet: 'V, Vg, GF, DF', start: 21, ordered: 0,  sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Shepherdess Pie',             diet: 'Vg',            start: 0,  ordered: 10, sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Nut Roast',                   diet: 'V, N',          start: 1,  ordered: 0,  sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Roast Vegetable Lasagne',     diet: 'V',             start: 19, ordered: 0,  sessions: [0,0,0,0,0,0,0,0] },
      ],
      Desserts: [
        { name: 'Apple Pie',         diet: '', start: 15, ordered: 0, sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Fruit Crumble',     diet: '', start: 14, ordered: 0, sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Treacle Sponge',    diet: '', start: 7,  ordered: 0, sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Tiramisu',          diet: '', start: 0,  ordered: 0, sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Chocolate Brownie', diet: '', start: 0,  ordered: 0, sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Ice Cream',         diet: '', start: 0,  ordered: 0, sessions: [0,0,0,0,0,0,0,0] },
      ],
    },
  },
  {
    label: 'w/c 09 Jun 2026',
    cats: {
      Meat: [
        { name: 'Chicken Rogan Josh',              diet: 'GF',           start: 30, ordered: 0, sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Sweet and Sour Pork',             diet: 'GF, DF',       start: 18, ordered: 0, sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Beef Lasagne',                    diet: '',             start: 20, ordered: 0, sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Lamb Hotpot',                     diet: 'DF',           start: 6,  ordered: 0, sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Sausage & Mash with Onion Gravy', diet: '',             start: 8,  ordered: 0, sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Fish Pie',                        diet: '',             start: 5,  ordered: 0, sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Cod in Parsley Sauce',            diet: '',             start: 10, ordered: 0, sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Herby Crumbed Cod',               diet: '',             start: 10, ordered: 0, sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Hunters Chicken',                 diet: '',             start: 29, ordered: 0, sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Chicken Tagine',                  diet: '',             start: 24, ordered: 0, sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Creamy Tarragon Chicken',         diet: 'GF',           start: 10, ordered: 0, sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Spanish Chicken',                 diet: '',             start: 13, ordered: 0, sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Beef Casserole',                  diet: 'GF',           start: 0,  ordered: 0, sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Chicken Casserole',               diet: '',             start: 0,  ordered: 0, sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Chilli Con Carne',                diet: '',             start: 20, ordered: 0, sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Cottage Pie',                     diet: '',             start: 0,  ordered: 0, sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Moussaka',                        diet: '',             start: 8,  ordered: 0, sessions: [0,0,0,0,0,0,0,0] },
      ],
      'Non-Meat': [
        { name: 'Spinach & Chickpea Curry',   diet: 'V, Vg, GF, DF', start: 24, ordered: 0, sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Aubergine Tagine',            diet: 'V, Vg, GF, DF', start: 21, ordered: 0, sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Shepherdess Pie',             diet: 'Vg',            start: 10, ordered: 0, sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Nut Roast',                   diet: 'V, N',          start: 1,  ordered: 0, sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Roast Vegetable Lasagne',     diet: 'V',             start: 19, ordered: 0, sessions: [0,0,0,0,0,0,0,0] },
      ],
      Desserts: [
        { name: 'Apple Pie',         diet: '', start: 15, ordered: 0, sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Fruit Crumble',     diet: '', start: 14, ordered: 0, sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Treacle Sponge',    diet: '', start: 7,  ordered: 0, sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Tiramisu',          diet: '', start: 0,  ordered: 0, sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Chocolate Brownie', diet: '', start: 0,  ordered: 0, sessions: [0,0,0,0,0,0,0,0] },
        { name: 'Ice Cream',         diet: '', start: 0,  ordered: 0, sessions: [0,0,0,0,0,0,0,0] },
      ],
    },
  },
];

async function setup(): Promise<void> {
  const client = await pool.connect();
  try {
    console.log('Connected to PostgreSQL.');
    console.log('Creating tables...');

    await client.query(`
      CREATE TABLE IF NOT EXISTS weeks (
        id          SERIAL PRIMARY KEY,
        label       TEXT NOT NULL,
        sort_order  INTEGER NOT NULL DEFAULT 0,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS dishes (
        id          SERIAL PRIMARY KEY,
        week_id     INTEGER NOT NULL REFERENCES weeks(id) ON DELETE CASCADE,
        category    TEXT NOT NULL,
        sort_order  INTEGER NOT NULL DEFAULT 0,
        name        TEXT NOT NULL,
        diet        TEXT NOT NULL DEFAULT '',
        start       INTEGER NOT NULL DEFAULT 0,
        ordered     INTEGER NOT NULL DEFAULT 0,
        corrections INTEGER NOT NULL DEFAULT 0,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id          SERIAL PRIMARY KEY,
        dish_id     INTEGER NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
        session_idx INTEGER NOT NULL,
        session_name TEXT NOT NULL,
        used        INTEGER NOT NULL DEFAULT 0,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(dish_id, session_idx)
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        id           SERIAL PRIMARY KEY,
        changed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        device_ip    TEXT,
        week_label   TEXT NOT NULL,
        dish_name    TEXT NOT NULL,
        category     TEXT NOT NULL,
        field        TEXT NOT NULL,
        old_value    INTEGER,
        new_value    INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      INSERT INTO app_settings(key,value) VALUES('active_week_id','1')
        ON CONFLICT(key) DO NOTHING;

      CREATE TABLE IF NOT EXISTS users (
        id            SERIAL PRIMARY KEY,
        email         TEXT NOT NULL UNIQUE,
        display_name  TEXT NOT NULL,
        password_hash TEXT,
        google_id     TEXT UNIQUE,
        facebook_id   TEXT UNIQUE,
        microsoft_id  TEXT UNIQUE,
        approved      BOOLEAN NOT NULL DEFAULT false,
        is_admin      BOOLEAN NOT NULL DEFAULT false,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS user_name TEXT;

      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id         SERIAL PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        used       BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    console.log('Tables created.');

    // One-time migration: flip negative session values to positive (new sign convention)
    const migRes = await client.query('UPDATE sessions SET used = -used WHERE used < 0');
    if ((migRes.rowCount ?? 0) > 0) {
      console.log(`Migrated ${migRes.rowCount} session rows to positive sign convention.`);
    }

    const { rows } = await client.query<{ count: string }>('SELECT COUNT(*) FROM weeks');
    if (parseInt(rows[0].count) > 0) {
      console.log('Weeks already exist — skipping seed data. Done.');
      return;
    }

    console.log('Seeding initial meal data...');
    for (let wi = 0; wi < DEFAULT_WEEKS.length; wi++) {
      const week = DEFAULT_WEEKS[wi];
      const wRes = await client.query<{ id: number }>(
        'INSERT INTO weeks(label, sort_order) VALUES($1,$2) RETURNING id',
        [week.label, wi]
      );
      const weekId = wRes.rows[0].id;

      for (const [cat, meals] of Object.entries(week.cats) as [Category, SeedDish[]][]) {
        for (let mi = 0; mi < meals.length; mi++) {
          const m = meals[mi];
          const dRes = await client.query<{ id: number }>(
            `INSERT INTO dishes(week_id,category,sort_order,name,diet,start,ordered,corrections)
             VALUES($1,$2,$3,$4,$5,$6,$7,0) RETURNING id`,
            [weekId, cat, mi, m.name, m.diet, m.start, m.ordered]
          );
          const dishId = dRes.rows[0].id;
          for (let si = 0; si < SESSIONS.length; si++) {
            await client.query(
              `INSERT INTO sessions(dish_id,session_idx,session_name,used) VALUES($1,$2,$3,$4)`,
              [dishId, si, SESSIONS[si], m.sessions[si]]
            );
          }
        }
      }
      console.log(`  Seeded: ${week.label}`);
    }
    console.log('\nAll done! You can now run:  npm start');
  } finally {
    client.release();
    await pool.end();
  }
}

setup().catch(err => {
  console.error('\nERROR:', (err as Error).message);
  console.error('Make sure PostgreSQL is running and db-config.ts has the correct credentials.');
  process.exit(1);
});
