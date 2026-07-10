const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const logger = require('../utils/logger');

let db = null;
let dbPath = null;

async function initDatabase() {
  if (db) return db;

  dbPath = path.resolve(config.paths.database);
  const dbDir = path.dirname(dbPath);

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const SQL = await initSqlJs();

  // Load existing database or create new one
  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // Performance optimizations
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA synchronous = NORMAL');
  db.run('PRAGMA cache_size = -64000');
  db.run('PRAGMA foreign_keys = ON');
  db.run('PRAGMA temp_store = MEMORY');

  logger.info('Database connection established', { path: dbPath });
  return db;
}

function getConnection() {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

function saveDatabase() {
  if (db && dbPath) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
  }
}

function closeConnection() {
  if (db) {
    saveDatabase();
    db.close();
    db = null;
    logger.info('Database connection closed');
  }
}

// Auto-save periodically
let saveInterval = null;
function startAutoSave(intervalMs = 30000) {
  if (saveInterval) return;
  saveInterval = setInterval(() => {
    saveDatabase();
  }, intervalMs);
}

function stopAutoSave() {
  if (saveInterval) {
    clearInterval(saveInterval);
    saveInterval = null;
  }
}

module.exports = { initDatabase, getConnection, saveDatabase, closeConnection, startAutoSave, stopAutoSave };
