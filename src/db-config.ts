import type { PoolConfig } from 'pg';

const config: PoolConfig = {
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME     || 'mealstock',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || 'changeme',
};

export default config;
