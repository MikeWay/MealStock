import type { PoolConfig } from 'pg';

const config: PoolConfig = {
  host:     'localhost',
  port:     5432,
  database: 'mealstock',
  user:     'postgres',
  password: 'changeme',   // ← change this to your PostgreSQL password
};

export default config;
