const db = require('../database/db');
const { v4: uuidv4 } = require('uuid');

class KnowledgeBase {
  static findById(id) {
    return db.get('SELECT * FROM knowledge_bases WHERE id = ?', [id]);
  }

  static findByUser(userId) {
    return db.all(`
      SELECT kb.*, 
        (SELECT COUNT(*) FROM documents WHERE knowledge_base_id = kb.id) as document_count,
        (SELECT COALESCE(SUM(file_size), 0) FROM documents WHERE knowledge_base_id = kb.id) as total_size
      FROM knowledge_bases kb 
      WHERE kb.user_id = ? 
      ORDER BY kb.created_at DESC
    `, [userId]);
  }

  static getDefaultForUser(userId) {
    return db.get('SELECT * FROM knowledge_bases WHERE user_id = ? LIMIT 1', [userId]);
  }

  static findByUserAndName(userId, name) {
    return db.get('SELECT * FROM knowledge_bases WHERE user_id = ? AND name = ?', [userId, name]);
  }

  static create({ userId, name, description }) {
    const id = uuidv4();
    db.run(
      'INSERT INTO knowledge_bases (id, user_id, name, description) VALUES (?, ?, ?, ?)',
      [id, userId, name, description || null]
    );
    return this.findById(id);
  }

  static update(id, { name, description }) {
    const fields = [];
    const values = [];

    if (name !== undefined) { fields.push('name = ?'); values.push(name); }
    if (description !== undefined) { fields.push('description = ?'); values.push(description); }
    fields.push("updated_at = datetime('now')");
    values.push(id);

    db.run(`UPDATE knowledge_bases SET ${fields.join(', ')} WHERE id = ?`, values);
    return this.findById(id);
  }

  static delete(id) {
    db.run('DELETE FROM knowledge_bases WHERE id = ?', [id]);
  }

  static incrementDocCount(id) {
    db.run("UPDATE knowledge_bases SET document_count = document_count + 1, updated_at = datetime('now') WHERE id = ?", [id]);
  }

  static decrementDocCount(id) {
    db.run("UPDATE knowledge_bases SET document_count = MAX(0, document_count - 1), updated_at = datetime('now') WHERE id = ?", [id]);
  }

  static count() {
    const row = db.get('SELECT COUNT(*) as count FROM knowledge_bases');
    return row.count;
  }
}

module.exports = KnowledgeBase;
