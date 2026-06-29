import { Pool } from 'pg';
import cfg from './db-config';

const pool = new Pool(cfg);

async function setup(): Promise<void> {
  const client = await pool.connect();
  try {
    // Wait for the postgres container's S3 restore to finish before proceeding
    let restoreReady = false;
    for (let i = 0; i < 30 && !restoreReady; i++) {
      try {
        const r = await client.query("SELECT done FROM _restore_complete WHERE done = true LIMIT 1");
        restoreReady = (r.rowCount ?? 0) > 0;
      } catch {}
      if (!restoreReady) {
        console.log('Waiting for database restore to complete...');
        await new Promise(res => setTimeout(res, 2000));
      }
    }
    if (!restoreReady) console.log('Restore sentinel not found — proceeding anyway.');

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

      ALTER TABLE dishes ADD COLUMN IF NOT EXISTS freezer TEXT NOT NULL DEFAULT '';

      CREATE TABLE IF NOT EXISTS freezer_options (
        id         SERIAL PRIMARY KEY,
        label      TEXT NOT NULL UNIQUE,
        sort_order INTEGER NOT NULL DEFAULT 0
      );

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

    // One-time migration: add Saturday (idx 8) and Sunday (idx 9) for existing dishes
    for (const [idx, name] of [[8, 'Saturday'], [9, 'Sunday']] as [number, string][]) {
      const r = await client.query(
        `INSERT INTO sessions(dish_id, session_idx, session_name, used)
         SELECT d.id, $1, $2, 0 FROM dishes d
         WHERE NOT EXISTS (
           SELECT 1 FROM sessions s WHERE s.dish_id = d.id AND s.session_idx = $1
         )`,
        [idx, name]
      );
      if ((r.rowCount ?? 0) > 0) {
        console.log(`Inserted ${r.rowCount} '${name}' session rows.`);
      }
    }

    console.log('Done.');
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
