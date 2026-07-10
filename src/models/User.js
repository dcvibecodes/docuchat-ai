const db = require('../database/db');
const { v4: uuidv4 } = require('uuid');

class User {
  static findById(id) {
    return db.get('SELECT * FROM users WHERE id = ?', [id]);
  }

  static findByUsername(username) {
    return db.get('SELECT * FROM users WHERE username = ?', [username.toLowerCase()]);
  }

  static create({ username, name, passwordHash, role }) {
    const id = uuidv4();
    db.run(
      'INSERT INTO users (id, email, username, name, password_hash, role) VALUES (?, ?, ?, ?, ?, ?)',
      [id, username.toLowerCase() + '@local', username.toLowerCase(), name || '', passwordHash, role || 'user']
    );
    return this.findById(id);
  }

  static updateLastLogin(id) {
    db.run("UPDATE users SET last_login = datetime('now') WHERE id = ?", [id]);
  }

  static updateStorageUsed(id, bytes) {
    db.run('UPDATE users SET storage_used = storage_used + ? WHERE id = ?', [bytes, id]);
  }

  static count() {
    const row = db.get('SELECT COUNT(*) as count FROM users');
    return row.count;
  }

  static findAll() {
    return db.all('SELECT id, username, name, role, storage_used, created_at, last_login FROM users ORDER BY created_at DESC');
  }

  static delete(id) {
    db.run('DELETE FROM users WHERE id = ?', [id]);
  }

  static updateRole(id, role) {
    db.run('UPDATE users SET role = ? WHERE id = ?', [role, id]);
  }
}

module.exports = User;
