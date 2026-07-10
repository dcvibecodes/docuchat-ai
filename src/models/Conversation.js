const db = require('../database/db');
const { v4: uuidv4 } = require('uuid');

class Conversation {
  static findById(id) {
    return db.get('SELECT * FROM conversations WHERE id = ?', [id]);
  }

  static findByUser(userId, { search, pinned } = {}) {
    let query = 'SELECT * FROM conversations WHERE user_id = ?';
    const params = [userId];

    if (pinned !== undefined) {
      query += ' AND pinned = ?';
      params.push(pinned ? 1 : 0);
    }
    if (search) {
      query += ' AND title LIKE ?';
      params.push(`%${search}%`);
    }

    query += ' ORDER BY pinned DESC, updated_at DESC';
    return db.all(query, params);
  }

  static create({ userId, knowledgeBaseId, title }) {
    const id = uuidv4();
    db.run(
      'INSERT INTO conversations (id, user_id, knowledge_base_id, title) VALUES (?, ?, ?, ?)',
      [id, userId, knowledgeBaseId || null, title || 'New Conversation']
    );
    return this.findById(id);
  }

  static update(id, { title, pinned, knowledgeBaseId }) {
    const fields = [];
    const values = [];

    if (title !== undefined) { fields.push('title = ?'); values.push(title); }
    if (pinned !== undefined) { fields.push('pinned = ?'); values.push(pinned ? 1 : 0); }
    if (knowledgeBaseId !== undefined) { fields.push('knowledge_base_id = ?'); values.push(knowledgeBaseId); }
    fields.push("updated_at = datetime('now')");
    values.push(id);

    db.run(`UPDATE conversations SET ${fields.join(', ')} WHERE id = ?`, values);
    return this.findById(id);
  }

  static incrementMessageCount(id) {
    db.run("UPDATE conversations SET message_count = message_count + 1, updated_at = datetime('now') WHERE id = ?", [id]);
  }

  static delete(id) {
    db.run('DELETE FROM conversations WHERE id = ?', [id]);
  }

  static count(userId) {
    if (userId) {
      const row = db.get('SELECT COUNT(*) as count FROM conversations WHERE user_id = ?', [userId]);
      return row.count;
    }
    const row = db.get('SELECT COUNT(*) as count FROM conversations');
    return row.count;
  }
}

module.exports = Conversation;
