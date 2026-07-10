const db = require('../database/db');
const { v4: uuidv4 } = require('uuid');

class Embedding {
  static findByChunkId(chunkId) {
    return db.get('SELECT * FROM embeddings WHERE chunk_id = ?', [chunkId]);
  }

  static findByKnowledgeBase(knowledgeBaseId) {
    return db.all('SELECT * FROM embeddings WHERE knowledge_base_id = ?', [knowledgeBaseId]);
  }

  static findByUser(userId) {
    return db.all('SELECT * FROM embeddings WHERE user_id = ?', [userId]);
  }

  static createMany(embeddings) {
    for (const emb of embeddings) {
      db.run(
        'INSERT INTO embeddings (id, chunk_id, document_id, user_id, knowledge_base_id, embedding, model, dimensions) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [uuidv4(), emb.chunkId, emb.documentId, emb.userId, emb.knowledgeBaseId, emb.embedding, emb.model, emb.dimensions]
      );
    }
  }

  static deleteByDocument(documentId) {
    db.run('DELETE FROM embeddings WHERE document_id = ?', [documentId]);
  }

  static count(userId) {
    if (userId) {
      const row = db.get('SELECT COUNT(*) as count FROM embeddings WHERE user_id = ?', [userId]);
      return row.count;
    }
    const row = db.get('SELECT COUNT(*) as count FROM embeddings');
    return row.count;
  }
}

module.exports = Embedding;
