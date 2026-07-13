const db = require('../database/db');
const { v4: uuidv4 } = require('uuid');

class SourceGroup {
  static findById(id) {
    return db.get('SELECT * FROM source_groups WHERE id = ?', [id]);
  }

  static findAll() {
    return db.all('SELECT * FROM source_groups ORDER BY created_at DESC');
  }

  static findByUser(userId) {
    return db.all('SELECT * FROM source_groups WHERE user_id = ? ORDER BY created_at DESC', [userId]);
  }

  static create({ userId, name, type, url }) {
    const id = uuidv4();
    db.run(
      'INSERT INTO source_groups (id, user_id, name, type, url) VALUES (?, ?, ?, ?, ?)',
      [id, userId, name, type || 'sitemap', url || null]
    );
    return this.findById(id);
  }

  static setEnabled(id, enabled) {
    db.run('UPDATE source_groups SET enabled = ? WHERE id = ?', [enabled ? 1 : 0, id]);
  }

  static incrementDocCount(id, amount = 1) {
    db.run('UPDATE source_groups SET doc_count = doc_count + ? WHERE id = ?', [amount, id]);
  }

  static delete(id) {
    // Delete all documents in this group first
    const docs = db.all('SELECT id FROM documents WHERE group_id = ?', [id]);
    for (const doc of docs) {
      db.run('DELETE FROM embeddings WHERE document_id = ?', [doc.id]);
      db.run('DELETE FROM chunks WHERE document_id = ?', [doc.id]);
      db.run('DELETE FROM documents WHERE id = ?', [doc.id]);
    }
    db.run('DELETE FROM source_groups WHERE id = ?', [id]);
  }

  static getDocCount(id) {
    const row = db.get('SELECT COUNT(*) as count FROM documents WHERE group_id = ?', [id]);
    return row ? row.count : 0;
  }
}

module.exports = SourceGroup;
