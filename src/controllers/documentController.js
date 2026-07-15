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
      let documents;
      if (req.session.role === 'admin' || req.session.role === 'techadmin') {
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
      if (!req.file) throw new ValidationError('No file uploaded');

      const kb = KnowledgeBase.getDefaultForUser(req.session.userId);
      if (!kb) throw new Error('No knowledge base found for user');

      const ext = path.extname(req.file.originalname).toLowerCase().replace('.', '');

      // Replace existing document with same name
      const existing = Document.findByOriginalName(req.file.originalname);
      if (existing) {
        const oldFilePath = path.resolve('uploads', existing.user_id, existing.filename);
        if (fs.existsSync(oldFilePath)) fs.unlinkSync(oldFilePath);
        User.updateStorageUsed(existing.user_id, -existing.file_size);
        KnowledgeBase.decrementDocCount(existing.knowledge_base_id);
        Document.delete(existing.id);
        logger.info('Deleted existing document before re-upload', { originalName: req.file.originalname, oldId: existing.id });
      }

      const doc = Document.create({
        userId: req.session.userId,
        knowledgeBaseId: kb.id,
        filename: req.file.filename,
        originalName: req.file.originalname,
        fileType: ext,
        fileSize: req.file.size
      });

      User.updateStorageUsed(req.session.userId, req.file.size);
      KnowledgeBase.incrementDocCount(kb.id);

      const { processDocument } = require('../services/documentProcessor');
      processDocument(doc.id).catch(err => {
        logger.error('Document processing failed', { docId: doc.id, error: err.message });
        Document.updateStatus(doc.id, 'error', err.message);
      });

      res.status(201).json(doc);
    } catch (err) {
      if (req.file) { try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ } }
      next(err);
    }
  }

  static get(req, res, next) {
    try {
      const doc = Document.findById(req.params.id);
      if (!doc) throw new NotFoundError('Document');
      if (doc.user_id !== req.session.userId && req.session.role !== 'admin' && req.session.role !== 'techadmin') throw new AuthorizationError();
      res.json(doc);
    } catch (err) { next(err); }
  }

  static rename(req, res, next) {
    try {
      const { name } = req.body;
      if (!name || !name.trim()) throw new ValidationError('Name is required');
      const doc = Document.findById(req.params.id);
      if (!doc) throw new NotFoundError('Document');
      if (doc.user_id !== req.session.userId && req.session.role !== 'admin') throw new AuthorizationError();
      Document.rename(doc.id, name.trim());
      res.json({ success: true });
    } catch (err) { next(err); }
  }

  static async reindex(req, res, next) {
    try {
      const doc = Document.findById(req.params.id);
      if (!doc) throw new NotFoundError('Document');
      if (req.session.role !== 'admin' && req.session.role !== 'techadmin' && doc.user_id !== req.session.userId) throw new AuthorizationError();

      Document.updateStatus(doc.id, 'processing');
      Document.updateProgress(doc.id, 0);
      Embedding.deleteByDocument(doc.id);
      Chunk.deleteByDocument(doc.id);

      const { processDocument } = require('../services/documentProcessor');
      processDocument(doc.id).catch(err => {
        logger.error('Reindex failed', { docId: doc.id, error: err.message });
        Document.updateStatus(doc.id, 'error', err.message);
      });

      res.json({ success: true, message: 'Re-indexing started' });
    } catch (err) { next(err); }
  }

  static delete(req, res, next) {
    try {
      const doc = Document.findById(req.params.id);
      if (!doc) throw new NotFoundError('Document');
      if (req.session.role !== 'admin' && req.session.role !== 'techadmin' && doc.user_id !== req.session.userId) throw new AuthorizationError();

      const filePath = path.resolve('uploads', doc.user_id, doc.filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

      User.updateStorageUsed(doc.user_id, -doc.file_size);
      KnowledgeBase.decrementDocCount(doc.knowledge_base_id);
      Document.delete(doc.id);

      res.json({ success: true });
    } catch (err) { next(err); }
  }

  static batchDelete(req, res, next) {
    try {
      const { ids } = req.body;
      if (!ids || !Array.isArray(ids) || !ids.length) throw new ValidationError('ids array is required');

      let deleted = 0;
      let failed = 0;
      const errors = [];

      for (const id of ids) {
        try {
          const doc = Document.findById(id);
          if (!doc) { failed++; continue; }
          if (req.session.role !== 'admin' && req.session.role !== 'techadmin' && doc.user_id !== req.session.userId) { failed++; continue; }

          const filePath = path.resolve('uploads', doc.user_id, doc.filename);
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

          User.updateStorageUsed(doc.user_id, -doc.file_size);
          KnowledgeBase.decrementDocCount(doc.knowledge_base_id);
          Document.delete(doc.id);
          deleted++;
        } catch (err) {
          failed++;
          errors.push({ id, error: err.message });
        }
      }

      // Save DB once after all deletes
      const { saveDatabase } = require('../database/connection');
      saveDatabase();

      res.json({ success: true, deleted, failed, total: ids.length });
    } catch (err) { next(err); }
  }

  static async importUrl(req, res, next) {
    try {
      const { url } = req.body;
      if (!url || !url.trim()) throw new ValidationError('URL is required');

      let fullUrl = url.trim();
      if (!fullUrl.match(/^https?:\/\//i)) fullUrl = 'https://' + fullUrl;
      try { new URL(fullUrl); } catch { throw new ValidationError('Invalid URL format'); }

      const kb = KnowledgeBase.getDefaultForUser(req.session.userId);
      if (!kb) throw new Error('No knowledge base found');

      // Replace if URL already exists
      const existing = Document.findByOriginalName(fullUrl);
      if (existing) {
        Embedding.deleteByDocument(existing.id);
        Chunk.deleteByDocument(existing.id);
        Document.delete(existing.id);
      }

      const { scrapeUrl } = require('../services/webScraper');
      const { title, text } = await scrapeUrl(fullUrl);

      const { v4: uuidv4 } = require('uuid');
      const filename = uuidv4() + '.txt';
      const userDir = path.resolve('uploads', req.session.userId);
      if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
      fs.writeFileSync(path.join(userDir, filename), text, 'utf-8');

      const doc = Document.create({
        userId: req.session.userId,
        knowledgeBaseId: kb.id,
        filename,
        originalName: fullUrl,
        fileType: 'url',
        fileSize: Buffer.byteLength(text, 'utf-8')
      });

      KnowledgeBase.incrementDocCount(kb.id);

      const { processDocument } = require('../services/documentProcessor');
      processDocument(doc.id).catch(err => {
        Document.updateStatus(doc.id, 'error', err.message);
      });

      res.status(201).json(doc);
    } catch (err) { next(err); }
  }

  static async reprocessAll(req, res, next) {
    try {
      const documents = Document.findAll({});
      const { processDocument, breathe } = require('../services/documentProcessor');
      const { saveDatabase } = require('../database/connection');
      let count = 0;

      const toProcess = [];
      for (const doc of documents) {
        if (doc.status === 'ready' || doc.status === 'error') {
          Document.updateStatus(doc.id, 'processing');
          Document.updateProgress(doc.id, 0);
          Embedding.deleteByDocument(doc.id);
          Chunk.deleteByDocument(doc.id);
          toProcess.push(doc.id);
          count++;
        }
      }

      // Process serially in background
      (async () => {
        for (let i = 0; i < toProcess.length; i++) {
          try { await processDocument(toProcess[i]); } catch (e) { /* already logged */ }
          await breathe(200);
          if (i % 5 === 0) saveDatabase();
        }
        saveDatabase();
      })().catch(err => logger.error('ReprocessAll crashed', { error: err.message }));

      res.json({ success: true, message: `Re-processing ${count} documents with new embedding model` });
    } catch (err) { next(err); }
  }

  static toggleDocument(req, res, next) {
    try {
      const doc = Document.findById(req.params.id);
      if (!doc) throw new NotFoundError('Document');
      const newEnabled = doc.enabled ? 0 : 1;
      Document.setEnabled(req.params.id, newEnabled);
      res.json({ success: true, enabled: !!newEnabled });
    } catch (err) { next(err); }
  }

  static createNote(req, res, next) {
    try {
      const { title, content } = req.body;
      if (!content || !content.trim()) throw new ValidationError('Note content is required');

      const kb = KnowledgeBase.getDefaultForUser(req.session.userId);
      if (!kb) throw new Error('No knowledge base found');

      const { v4: uuidv4 } = require('uuid');
      const filename = uuidv4() + '.txt';
      const userDir = path.resolve('uploads', req.session.userId);
      if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
      fs.writeFileSync(path.join(userDir, filename), content.trim(), 'utf-8');

      const noteName = (title && title.trim()) ? title.trim() : 'Note ' + new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });

      const doc = Document.create({
        userId: req.session.userId,
        knowledgeBaseId: kb.id,
        filename,
        originalName: noteName,
        fileType: 'note',
        fileSize: Buffer.byteLength(content.trim(), 'utf-8')
      });

      KnowledgeBase.incrementDocCount(kb.id);

      const { processDocument } = require('../services/documentProcessor');
      processDocument(doc.id).catch(err => {
        Document.updateStatus(doc.id, 'error', err.message);
      });

      res.status(201).json(doc);
    } catch (err) { next(err); }
  }

  static getNote(req, res, next) {
    try {
      const doc = Document.findById(req.params.id);
      if (!doc) throw new NotFoundError('Document');
      if (doc.file_type !== 'note') throw new ValidationError('This document is not a text note');
      if (doc.user_id !== req.session.userId && req.session.role !== 'admin' && req.session.role !== 'techadmin') throw new AuthorizationError();

      const filePath = path.resolve('uploads', doc.user_id, doc.filename);
      if (!fs.existsSync(filePath)) throw new Error('Note file not found on disk');
      const content = fs.readFileSync(filePath, 'utf-8');

      res.json({ id: doc.id, title: doc.original_name, content });
    } catch (err) { next(err); }
  }

  static async updateNote(req, res, next) {
    try {
      const { title, content } = req.body;
      if (!content || !content.trim()) throw new ValidationError('Note content is required');

      const doc = Document.findById(req.params.id);
      if (!doc) throw new NotFoundError('Document');
      if (doc.file_type !== 'note') throw new ValidationError('This document is not a text note');
      if (doc.user_id !== req.session.userId && req.session.role !== 'admin' && req.session.role !== 'techadmin') throw new AuthorizationError();

      // Update file on disk
      const filePath = path.resolve('uploads', doc.user_id, doc.filename);
      fs.writeFileSync(filePath, content.trim(), 'utf-8');

      // Update document metadata
      const newSize = Buffer.byteLength(content.trim(), 'utf-8');
      const sizeDiff = newSize - doc.file_size;
      User.updateStorageUsed(doc.user_id, sizeDiff);

      const db = require('../database/db');
      db.run('UPDATE documents SET file_size = ? WHERE id = ?', [newSize, doc.id]);

      if (title && title.trim()) {
        Document.rename(doc.id, title.trim());
      }

      // Re-process: clear old chunks/embeddings, re-index
      Document.updateStatus(doc.id, 'processing');
      Document.updateProgress(doc.id, 0);
      Embedding.deleteByDocument(doc.id);
      Chunk.deleteByDocument(doc.id);

      const { processDocument } = require('../services/documentProcessor');
      processDocument(doc.id).catch(err => {
        Document.updateStatus(doc.id, 'error', err.message);
      });

      res.json({ success: true, message: 'Note updated, re-processing' });
    } catch (err) { next(err); }
  }
}

module.exports = DocumentController;
