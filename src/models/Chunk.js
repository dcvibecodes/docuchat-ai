const db = require('../database/db');
const { v4: uuidv4 } = require('uuid');

class Chunk {
  static findById(id) {
    return db.get('SELECT * FROM chunks WHERE id = ?', [id]);
  }

  static findByDocument(documentId) {
    return db.all('SELECT * FROM chunks WHERE document_id = ? ORDER BY chunk_index', [documentId]);
  }

  static findByIds(ids) {
    if (!ids.length) return [];
    const placeholders = ids.map(() => '?').join(',');
    return db.all(`SELECT * FROM chunks WHERE id IN (${placeholders})`, ids);
  }

  static createMany(chunks) {
    const ids = [];
    for (const chunk of chunks) {
      const id = uuidv4();
      db.run(
        'INSERT INTO chunks (id, document_id, user_id, knowledge_base_id, content, chunk_index, page_number, heading, token_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, chunk.documentId, chunk.userId, chunk.knowledgeBaseId, chunk.content, chunk.chunkIndex, chunk.pageNumber || null, chunk.heading || null, chunk.tokenCount || 0]
      );
      ids.push(id);
    }
    return ids;
  }

  static deleteByDocument(documentId) {
    db.run('DELETE FROM chunks WHERE document_id = ?', [documentId]);
  }

  static countByUser(userId) {
    const row = db.get('SELECT COUNT(*) as count FROM chunks WHERE user_id = ?', [userId]);
    return row.count;
  }

  static count() {
    const row = db.get('SELECT COUNT(*) as count FROM chunks');
    return row.count;
  }
}

module.exports = Chunk;
