/**
 * Database abstraction layer.
 * Wraps sql.js with a simpler API similar to better-sqlite3.
 * Makes it easy to swap to a different SQLite driver or PostgreSQL later.
 */
const { getConnection, saveDatabase } = require('./connection');

const db = {
  /**
   * Run a query that modifies data (INSERT, UPDATE, DELETE)
   * @returns {{ changes: number, lastInsertRowid: number }}
   */
  run(sql, params = []) {
    const conn = getConnection();
    conn.run(sql, params);
    // sql.js doesn't provide changes/lastInsertRowid from run directly
    const changesRow = conn.exec('SELECT changes() as changes')[0];
    const changes = changesRow?.values?.[0]?.[0] || 0;
    saveDatabase(); // Persist after writes
    return { changes };
  },

  /**
   * Get a single row
   * @returns {object|undefined}
   */
  get(sql, params = []) {
    const conn = getConnection();
    const stmt = conn.prepare(sql);
    stmt.bind(params);

    if (stmt.step()) {
      const columns = stmt.getColumnNames();
      const values = stmt.get();
      stmt.free();
      return zipObject(columns, values);
    }
    stmt.free();
    return undefined;
  },

  /**
   * Get all matching rows
   * @returns {object[]}
   */
  all(sql, params = []) {
    const conn = getConnection();
    const stmt = conn.prepare(sql);
    stmt.bind(params);

    const results = [];
    const columns = stmt.getColumnNames ? stmt.getColumnNames() : [];

    while (stmt.step()) {
      if (!columns.length) {
        const cols = stmt.getColumnNames();
        columns.push(...cols);
      }
      results.push(zipObject(columns, stmt.get()));
    }
    stmt.free();
    return results;
  },

  /**
   * Execute multiple statements (for migrations)
   */
  exec(sql) {
    const conn = getConnection();
    conn.exec(sql);
    saveDatabase();
  }
};

function zipObject(keys, values) {
  const obj = {};
  for (let i = 0; i < keys.length; i++) {
    obj[keys[i]] = values[i];
  }
  return obj;
}

module.exports = db;
