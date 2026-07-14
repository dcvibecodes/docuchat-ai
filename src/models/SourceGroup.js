const db = require('../database/db');
const { v4: uuidv4 } = require('uuid');

class SourceGroup {
  static findById(id) {
    return db.get('SELECT * FROM source_groups WHERE id = ?', [id]);
  }

  static findAll() {
    return db.all('SELECT * FROM source_groups ORDER BY created_at DESC');
  }

  static findAllWithStats() {
    // Return groups with aggregated document status counts
    const groups = db.all('SELECT * FROM source_groups ORDER BY created_at DESC');
    for (const group of groups) {
      const stats = db.get(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) as ready,
          SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing,
          SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errors
        FROM documents WHERE group_id = ?
      `, [group.id]);
      group.doc_count = stats?.total || 0;
      group.ready_count = stats?.ready || 0;
      group.processing_count = stats?.processing || 0;
      group.error_count = stats?.errors || 0;
    }
    return groups;
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

  static updateDocCount(id) {
    // Recount actual documents in this group
    const row = db.get('SELECT COUNT(*) as count FROM documents WHERE group_id = ?', [id]);
    db.run('UPDATE source_groups SET doc_count = ? WHERE id = ?', [row?.count || 0, id]);
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
