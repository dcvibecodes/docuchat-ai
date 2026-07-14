const db = require('../database/db');
const { v4: uuidv4 } = require('uuid');

class Document {
  static findById(id) {
    return db.get('SELECT * FROM documents WHERE id = ?', [id]);
  }

  static findByUser(userId, { search, knowledgeBaseId, status } = {}) {
    let query = 'SELECT * FROM documents WHERE user_id = ?';
    const params = [userId];

    if (knowledgeBaseId) {
      query += ' AND knowledge_base_id = ?';
      params.push(knowledgeBaseId);
    }
    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }
    if (search) {
      query += ' AND (original_name LIKE ? OR filename LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    query += ' ORDER BY uploaded_at DESC';
    return db.all(query, params);
  }

  static findAll({ search, status } = {}) {
    let query = 'SELECT * FROM documents WHERE 1=1';
    const params = [];

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }
    if (search) {
      query += ' AND (original_name LIKE ? OR filename LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    query += ' ORDER BY uploaded_at DESC';
    return db.all(query, params);
  }

  static findByKnowledgeBase(knowledgeBaseId) {
    return db.all('SELECT * FROM documents WHERE knowledge_base_id = ? ORDER BY uploaded_at DESC', [knowledgeBaseId]);
  }

  static findByOriginalName(originalName) {
    return db.get('SELECT * FROM documents WHERE original_name = ?', [originalName]);
  }

  static create({ userId, knowledgeBaseId, filename, originalName, fileType, fileSize, pageCount }) {
    const id = uuidv4();
    db.run(
      'INSERT INTO documents (id, user_id, knowledge_base_id, filename, original_name, file_type, file_size, page_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id, userId, knowledgeBaseId, filename, originalName, fileType, fileSize, pageCount || 0]
    );
    return this.findById(id);
  }

  static updateStatus(id, status, errorMessage = null) {
    if (status === 'ready') {
      db.run("UPDATE documents SET status = ?, error_message = NULL, processing_progress = 100, indexed_at = datetime('now') WHERE id = ?", [status, id]);
    } else {
      db.run('UPDATE documents SET status = ?, error_message = ? WHERE id = ?', [status, errorMessage, id]);
    }
  }

  static updateProgress(id, progress) {
    db.run('UPDATE documents SET processing_progress = ? WHERE id = ?', [progress, id]);
  }

  static updateChunkCount(id, count) {
    db.run('UPDATE documents SET chunk_count = ? WHERE id = ?', [count, id]);
  }

  static rename(id, newName) {
    db.run('UPDATE documents SET original_name = ? WHERE id = ?', [newName, id]);
  }

  static delete(id) {
    // Cascade-delete related chunks and embeddings (sql.js doesn't enforce FK cascades)
    db.run('DELETE FROM embeddings WHERE document_id = ?', [id]);
    db.run('DELETE FROM chunks WHERE document_id = ?', [id]);
    db.run('DELETE FROM documents WHERE id = ?', [id]);
  }

  static count(userId) {
    if (userId) {
      const row = db.get('SELECT COUNT(*) as count FROM documents WHERE user_id = ?', [userId]);
      return row.count;
    }
    const row = db.get('SELECT COUNT(*) as count FROM documents');
    return row.count;
  }

  static totalSize(userId) {
    if (userId) {
      const row = db.get('SELECT COALESCE(SUM(file_size), 0) as total FROM documents WHERE user_id = ?', [userId]);
      return row.total;
    }
    const row = db.get('SELECT COALESCE(SUM(file_size), 0) as total FROM documents');
    return row.total;
  }

  static setEnabled(id, enabled) {
    db.run('UPDATE documents SET enabled = ? WHERE id = ?', [enabled ? 1 : 0, id]);
  }

  static getEnabledDocumentIds() {
    const rows = db.all('SELECT id FROM documents WHERE enabled = 1');
    return rows.map(r => r.id);
  }
}

module.exports = Document;
