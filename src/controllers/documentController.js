const path = require('path');
const fs = require('fs');
const Document = require('../models/Document');
const KnowledgeBase = require('../models/KnowledgeBase');
const Chunk = require('../models/Chunk');
const Embedding = require('../models/Embedding');
const User = require('../models/User');
const { NotFoundError, AuthorizationError, ValidationError } = require('../utils/errors');
const logger = require('../utils/logger');

class DocumentController {
  static list(req, res, next) {
    try {
      const { search, status } = req.query;
      // Admins see all documents; regular users see their own
      let documents;
      if (req.session.role === 'admin') {
        documents = Document.findAll({ search, status });
      } else {
        documents = Document.findByUser(req.session.userId, { search, status });
      }
      res.json(documents);
    } catch (err) {
      next(err);
    }
  }

  static async upload(req, res, next) {
    try {
      if (!req.file) {
        throw new ValidationError('No file uploaded');
      }

      // Auto-use the user's single knowledge base
      const kb = KnowledgeBase.getDefaultForUser(req.session.userId);
      if (!kb) throw new Error('No knowledge base found for user');

      const ext = path.extname(req.file.originalname).toLowerCase().replace('.', '');

      // Check if a document with the same original_name already exists — delete old one first
      const existing = Document.findByOriginalName(req.file.originalname);
      if (existing) {
        // Delete old file from disk
        const oldFilePath = path.resolve('uploads', existing.user_id, existing.filename);
        if (fs.existsSync(oldFilePath)) {
          fs.unlinkSync(oldFilePath);
        }
        // Update storage and KB count
        User.updateStorageUsed(existing.user_id, -existing.file_size);
        KnowledgeBase.decrementDocCount(existing.knowledge_base_id);
        // Delete from DB (cascades to chunks and embeddings)
        Document.delete(existing.id);
        logger.info('Deleted existing document before re-upload', { originalName: req.file.originalname, oldId: existing.id });
      }

      // Create document record
      const doc = Document.create({
        userId: req.session.userId,
        knowledgeBaseId: kb.id,
        filename: req.file.filename,
        originalName: req.file.originalname,
        fileType: ext,
        fileSize: req.file.size
      });

      // Update user storage
      User.updateStorageUsed(req.session.userId, req.file.size);
      KnowledgeBase.incrementDocCount(kb.id);

      // Trigger async processing (will be implemented in Phase 2)
      const { processDocument } = require('../services/documentProcessor');
      processDocument(doc.id).catch(err => {
        logger.error('Document processing failed', { docId: doc.id, error: err.message });
        Document.updateStatus(doc.id, 'error', err.message);
      });

      res.status(201).json(doc);
    } catch (err) {
      // Clean up uploaded file on error
      if (req.file) {
        try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ }
      }
      next(err);
    }
  }

  static get(req, res, next) {
    try {
      const doc = Document.findById(req.params.id);
      if (!doc) throw new NotFoundError('Document');
      if (doc.user_id !== req.session.userId) throw new AuthorizationError();
      res.json(doc);
    } catch (err) {
      next(err);
    }
  }

  static rename(req, res, next) {
    try {
      const { name } = req.body;
      if (!name || !name.trim()) throw new ValidationError('Name is required');

      const doc = Document.findById(req.params.id);
      if (!doc) throw new NotFoundError('Document');
      if (doc.user_id !== req.session.userId) throw new AuthorizationError();

      Document.rename(doc.id, name.trim());
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  }

  static async reindex(req, res, next) {
    try {
      const doc = Document.findById(req.params.id);
      if (!doc) throw new NotFoundError('Document');
      if (req.session.role !== 'admin' && doc.user_id !== req.session.userId) throw new AuthorizationError();

      Document.updateStatus(doc.id, 'processing');

      // Delete existing chunks and embeddings
      Embedding.deleteByDocument(doc.id);
      Chunk.deleteByDocument(doc.id);

      // Re-process
      const { processDocument } = require('../services/documentProcessor');
      processDocument(doc.id).catch(err => {
        logger.error('Reindex failed', { docId: doc.id, error: err.message });
        Document.updateStatus(doc.id, 'error', err.message);
      });

      res.json({ success: true, message: 'Re-indexing started' });
    } catch (err) {
      next(err);
    }
  }

  static delete(req, res, next) {
    try {
      const doc = Document.findById(req.params.id);
      if (!doc) throw new NotFoundError('Document');
      // Admins can delete any document; regular users only their own
      if (req.session.role !== 'admin' && doc.user_id !== req.session.userId) throw new AuthorizationError();

      // Delete file from disk
      const filePath = path.resolve('uploads', doc.user_id, doc.filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      // Update storage
      User.updateStorageUsed(doc.user_id, -doc.file_size);
      KnowledgeBase.decrementDocCount(doc.knowledge_base_id);

      // Delete from database (cascades to chunks and embeddings)
      Document.delete(doc.id);

      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  }

  static async reprocessAll(req, res, next) {
    try {
      const documents = Document.findAll({});
      let count = 0;
      for (const doc of documents) {
        if (doc.status === 'ready' || doc.status === 'error') {
          Document.updateStatus(doc.id, 'processing');
          Embedding.deleteByDocument(doc.id);
          Chunk.deleteByDocument(doc.id);
          const { processDocument } = require('../services/documentProcessor');
          processDocument(doc.id).catch(err => {
            Document.updateStatus(doc.id, 'error', err.message);
          });
          count++;
        }
      }
      res.json({ success: true, message: `Re-processing ${count} documents with new embedding model` });
    } catch (err) { next(err); }
  }
}

module.exports = DocumentController;
