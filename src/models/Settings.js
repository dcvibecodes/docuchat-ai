const db = require('../database/db');

class Settings {
  static findByUser(userId) {
    return db.get('SELECT * FROM settings WHERE user_id = ?', [userId]);
  }

  static createDefault(userId) {
    const existing = this.findByUser(userId);
    if (existing) return existing;
    db.run('INSERT INTO settings (user_id) VALUES (?)', [userId]);
    return this.findByUser(userId);
  }

  static update(userId, { theme }) {
    if (theme && (theme === 'light' || theme === 'dark')) {
      db.run('UPDATE settings SET theme = ? WHERE user_id = ?', [theme, userId]);
    }
    return this.findByUser(userId);
  }
}

module.exports = Settings;
