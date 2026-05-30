/**
 * db-config.js
 * Edit these values to match your PostgreSQL installation.
 * Default PostgreSQL install on Windows uses the values below —
 * only the password needs changing to whatever you set during installation.
 */

module.exports = {
  host:     'localhost',
  port:     5432,
  database: 'mealstock',
  user:     'postgres',
  password: 'changeme',   // ← change this to your PostgreSQL password
};
