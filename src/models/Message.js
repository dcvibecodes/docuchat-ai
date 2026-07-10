const db = require('../database/db');
const { v4: uuidv4 } = require('uuid');

class Message {
  static findById(id) {
    return db.get('SELECT * FROM messages WHERE id = ?', [id]);
  }

  static findByConversation(conversationId, { limit, offset } = {}) {
    let query = 'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC';
    const params = [conversationId];

    if (limit) {
      query += ' LIMIT ?';
      params.push(limit);
      if (offset) {
        query += ' OFFSET ?';
        params.push(offset);
      }
    }

    return db.all(query, params);
  }

  static getRecentMessages(conversationId, count = 10) {
    const rows = db.all(
      'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?',
      [conversationId, count]
    );
    return rows.reverse();
  }

  static create({ conversationId, userId, role, content, citations }) {
    const id = uuidv4();
    db.run(
      'INSERT INTO messages (id, conversation_id, user_id, role, content, citations) VALUES (?, ?, ?, ?, ?, ?)',
      [id, conversationId, userId, role, content, citations ? JSON.stringify(citations) : null]
    );
    return this.findById(id);
  }

  static delete(id) {
    db.run('DELETE FROM messages WHERE id = ?', [id]);
  }

  static deleteByConversation(conversationId) {
    db.run('DELETE FROM messages WHERE conversation_id = ?', [conversationId]);
  }

  static count() {
    const row = db.get('SELECT COUNT(*) as count FROM messages');
    return row.count;
  }
}

module.exports = Message;
