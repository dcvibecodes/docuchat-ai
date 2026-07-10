const db = require('../database/db');

/**
 * Permanent chat log — persists even when conversations are deleted.
 * Used by admins to review all chat history for training needs analysis.
 */
class ChatLog {
  static log({ conversationId, conversationTitle, userId, username, role, content, citations }) {
    db.run(
      'INSERT INTO chat_logs (conversation_id, conversation_title, user_id, username, role, content, citations) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [conversationId, conversationTitle || 'Untitled', userId, username || '', role, content, citations ? JSON.stringify(citations) : null]
    );
  }

  static getAll({ limit = 200, offset = 0, userId, search } = {}) {
    let query = 'SELECT * FROM chat_logs WHERE 1=1';
    const params = [];

    if (userId) { query += ' AND user_id = ?'; params.push(userId); }
    if (search) { query += ' AND content LIKE ?'; params.push(`%${search}%`); }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    return db.all(query, params);
  }

  static getConversationLog(conversationId) {
    return db.all('SELECT * FROM chat_logs WHERE conversation_id = ? ORDER BY created_at ASC', [conversationId]);
  }

  static getUniqueConversations({ limit = 100, offset = 0 } = {}) {
    return db.all(`
      SELECT conversation_id, conversation_title, username, user_id,
        MIN(created_at) as started_at,
        MAX(created_at) as last_message_at,
        COUNT(*) as message_count
      FROM chat_logs
      GROUP BY conversation_id
      ORDER BY last_message_at DESC
      LIMIT ? OFFSET ?
    `, [limit, offset]);
  }

  static count() {
    const row = db.get('SELECT COUNT(*) as c FROM chat_logs');
    return row.c;
  }

  static clearAll() {
    db.run('DELETE FROM chat_logs');
  }

  static deleteConversationLog(conversationId) {
    db.run('DELETE FROM chat_logs WHERE conversation_id = ?', [conversationId]);
  }
}

module.exports = ChatLog;
