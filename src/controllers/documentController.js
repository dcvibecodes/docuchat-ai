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
      if (!req.file) {
        throw new ValidationError('No file uploaded');
      }

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

  static async importUrl(req, res, next) {
    try {
      const { url } = req.body;
      if (!url || !url.trim()) throw new ValidationError('URL is required');

      let fullUrl = url.trim();
      if (!fullUrl.match(/^https?:\/\//i)) fullUrl = 'https://' + fullUrl;
      try { new URL(fullUrl); } catch { throw new ValidationError('Invalid URL format'); }

      const kb = KnowledgeBase.getDefaultForUser(req.session.userId);
      if (!kb) throw new Error('No knowledge base found');

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
      let count = 0;
      for (const doc of documents) {
        if (doc.status === 'ready' || doc.status === 'error') {
          Document.updateStatus(doc.id, 'processing');
          Document.updateProgress(doc.id, 0);
          Embedding.deleteByDocument(doc.id);
          Chunk.deleteByDocument(doc.id);
          count++;
        }
      }
      // Process serially in background
      const { processDocument, breathe } = require('../services/documentProcessor');
      const { saveDatabase } = require('../database/connection');
      const toProcess = documents.filter(d => d.status === 'ready' || d.status === 'error').map(d => d.id);
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

  static async sitemapDiscover(req, res, next) {
    try {
      if (req.session.role !== 'techadmin') throw new AuthorizationError('Only tech admins can import sitemaps');

      const { url } = req.body;
      if (!url || !url.trim()) throw new ValidationError('Sitemap URL or domain is required');

      const { fetchSitemap, detectSitemap } = require('../services/sitemapService');
      let sitemapUrl = url.trim();

      if (!sitemapUrl.match(/sitemap.*\.(xml|txt)$/i)) {
        const detected = await detectSitemap(sitemapUrl);
        if (!detected) throw new ValidationError('Could not find a sitemap at this domain. Try providing the direct sitemap URL.');
        sitemapUrl = detected;
      }

      const urls = await fetchSitemap(sitemapUrl);
      if (!urls.length) throw new ValidationError('Sitemap found but contains no URLs');

      const SystemConfig = require('../models/SystemConfig');
      const maxCap = parseInt(SystemConfig.get('sitemap_max_urls') || '500', 10);

      res.json({
        sitemapUrl,
        totalUrls: urls.length,
        maxCap: maxCap || null,
        urls: urls.slice(0, 50).map(u => u.loc),
        hasMore: urls.length > 50
      });
    } catch (err) { next(err); }
  }

  // ── Import state ──
  static _importRunning = false;
  static _cancelRequested = false;
  static _importProgress = { running: false, phase: '', total: 0, completed: 0, failed: 0, groupId: null };

  static getImportProgress(req, res, next) {
    res.json(DocumentController._importProgress);
  }

  static cancelImport(req, res, next) {
    try {
      if (!DocumentController._importRunning) {
        return res.json({ success: false, message: 'No import is currently running' });
      }
      DocumentController._cancelRequested = true;
      res.json({ success: true, message: 'Cancel requested. Import will stop after current item.' });
    } catch (err) { next(err); }
  }

  static async sitemapImport(req, res, next) {
    try {
      if (req.session.role !== 'techadmin') throw new AuthorizationError('Only tech admins can import sitemaps');
      if (DocumentController._importRunning) throw new ValidationError('A sitemap import is already running. Please wait or cancel it.');

      const { sitemapUrl, limit, pathFilter } = req.body;
      if (!sitemapUrl) throw new ValidationError('Sitemap URL is required');

      const { fetchSitemap } = require('../services/sitemapService');
      const SourceGroup = require('../models/SourceGroup');
      const SystemConfig = require('../models/SystemConfig');
      const maxCap = parseInt(SystemConfig.get('sitemap_max_urls') || '500', 10);

      let urls = await fetchSitemap(sitemapUrl);

      if (pathFilter && pathFilter.trim()) {
        urls = urls.filter(u => u.loc.includes(pathFilter.trim()));
      }

      let effectiveLimit;
      if (limit === 'all') {
        effectiveLimit = maxCap > 0 ? Math.min(urls.length, maxCap) : urls.length;
      } else {
        const requested = parseInt(limit, 10) || 100;
        effectiveLimit = maxCap > 0 ? Math.min(requested, maxCap) : requested;
      }
      const toImport = urls.slice(0, effectiveLimit);

      logger.info('Starting sitemap import', { sitemapUrl, total: urls.length, importing: toImport.length, pathFilter });

      let groupName;
      try { groupName = new URL(sitemapUrl).hostname; } catch { groupName = sitemapUrl; }
      const group = SourceGroup.create({
        userId: req.session.userId,
        name: groupName,
        type: 'sitemap',
        url: sitemapUrl
      });

      const kb = KnowledgeBase.getDefaultForUser(req.session.userId);
      if (!kb) throw new Error('No knowledge base found');

      const { scrapeUrl } = require('../services/webScraper');
      const { v4: uuidv4 } = require('uuid');
      const { saveDatabase } = require('../database/connection');
      const { processDocument, breathe } = require('../services/documentProcessor');

      DocumentController._importRunning = true;
      DocumentController._cancelRequested = false;
      DocumentController._importProgress = { running: true, phase: 'scraping', total: toImport.length, completed: 0, failed: 0, groupId: group.id };

      (async () => {
        const savedDocIds = [];
        let scraped = 0;
        let failed = 0;

        // ═══ PHASE 1: Scrape all URLs (no embedding) ═══
        for (let i = 0; i < toImport.length; i++) {
          // Check cancel
          if (DocumentController._cancelRequested) {
            logger.info('Import cancelled by user during scraping', { scraped, failed });
            break;
          }

          const entry = toImport[i];
          try {
            const fullUrl = entry.loc;

            // GLOBAL check — skip if URL exists anywhere in the DB
            const existing = Document.findByOriginalName(fullUrl);
            if (existing) {
              // If it exists but has no group, assign it to this group
              if (!existing.group_id) {
                Document.setGroupId(existing.id, group.id);
              }
              scraped++;
              DocumentController._importProgress.completed = scraped + failed;
              continue;
            }

            const { title, text } = await scrapeUrl(fullUrl);

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

            Document.setGroupId(doc.id, group.id);
            KnowledgeBase.incrementDocCount(kb.id);
            savedDocIds.push(doc.id);
            scraped++;
          } catch (err) {
            failed++;
            logger.error('Sitemap scrape failed', { url: entry.loc, error: err.message });
          }

          DocumentController._importProgress.completed = scraped + failed;
          DocumentController._importProgress.failed = failed;

          if (i % 20 === 0) saveDatabase();
          // Small breath between scrapes to keep event loop responsive
          if (i % 5 === 0) await breathe(50);
        }

        saveDatabase();
        logger.info('Sitemap scrape phase complete', { scraped, failed, docsToProcess: savedDocIds.length });

        // ═══ PHASE 2: Process documents one by one (chunk + embed) ═══
        if (!DocumentController._cancelRequested && savedDocIds.length > 0) {
          DocumentController._importProgress.phase = 'processing';
          DocumentController._importProgress.total = savedDocIds.length;
          DocumentController._importProgress.completed = 0;
          DocumentController._importProgress.failed = 0;

          let processed = 0;
          let processFailed = 0;
          for (const docId of savedDocIds) {
            if (DocumentController._cancelRequested) {
              logger.info('Import cancelled by user during processing', { processed, processFailed });
              break;
            }

            try {
              await processDocument(docId);
              processed++;
            } catch (err) {
              processFailed++;
            }
            DocumentController._importProgress.completed = processed + processFailed;
            DocumentController._importProgress.failed = processFailed;

            if (processed % 5 === 0) saveDatabase();
            // Breathe between documents — prevents memory buildup
            await breathe(200);
          }
        }

        // Final cleanup
        SourceGroup.updateDocCount(group.id);
        saveDatabase();
        DocumentController._importRunning = false;
        const wasCancelled = DocumentController._cancelRequested;
        DocumentController._cancelRequested = false;
        DocumentController._importProgress = {
          running: false,
          phase: wasCancelled ? 'cancelled' : 'done',
          total: savedDocIds.length,
          completed: DocumentController._importProgress.completed,
          failed: DocumentController._importProgress.failed,
          groupId: group.id
        };
        logger.info('Sitemap import finished', { sitemapUrl, phase: wasCancelled ? 'cancelled' : 'done', groupId: group.id });
      })().catch(err => {
        logger.error('Sitemap import crashed', { error: err.message, stack: err.stack });
        saveDatabase();
        DocumentController._importRunning = false;
        DocumentController._cancelRequested = false;
        DocumentController._importProgress.running = false;
        DocumentController._importProgress.phase = 'error';
      });

      res.json({ success: true, message: `Importing ${toImport.length} URLs from sitemap. This will run in the background.`, queued: toImport.length, groupId: group.id });
    } catch (err) { next(err); }
  }

  static listGroups(req, res, next) {
    try {
      const SourceGroup = require('../models/SourceGroup');
      const groups = SourceGroup.findAllWithStats();
      res.json(groups);
    } catch (err) { next(err); }
  }

  static toggleGroup(req, res, next) {
    try {
      const SourceGroup = require('../models/SourceGroup');
      const group = SourceGroup.findById(req.params.id);
      if (!group) throw new NotFoundError('Source group');

      const newEnabled = group.enabled ? 0 : 1;
      SourceGroup.setEnabled(req.params.id, newEnabled);
      Document.setGroupEnabled(req.params.id, newEnabled);

      res.json({ success: true, enabled: !!newEnabled });
    } catch (err) { next(err); }
  }

  static async syncGroup(req, res, next) {
    try {
      if (req.session.role !== 'techadmin') throw new AuthorizationError('Only tech admins can sync sitemaps');
      if (DocumentController._importRunning) throw new ValidationError('An import is already running. Please wait or cancel it.');

      const SourceGroup = require('../models/SourceGroup');
      const group = SourceGroup.findById(req.params.id);
      if (!group) throw new NotFoundError('Source group');
      if (!group.url) throw new ValidationError('This group has no sitemap URL to sync from');

      const { fetchSitemap } = require('../services/sitemapService');
      const allUrls = await fetchSitemap(group.url);

      // GLOBAL check — find URLs that don't exist ANYWHERE in the database (not just this group)
      const db = require('../database/db');
      const existingDocs = db.all('SELECT original_name FROM documents');
      const existingNames = new Set(existingDocs.map(d => d.original_name));

      const newUrls = allUrls.filter(u => !existingNames.has(u.loc));

      if (!newUrls.length) {
        return res.json({ success: true, newUrls: 0, message: 'No new URLs found' });
      }

      const kb = KnowledgeBase.getDefaultForUser(req.session.userId);
      if (!kb) throw new Error('No knowledge base found');

      const { scrapeUrl } = require('../services/webScraper');
      const { v4: uuidv4 } = require('uuid');
      const { saveDatabase } = require('../database/connection');
      const { processDocument, breathe } = require('../services/documentProcessor');

      DocumentController._importRunning = true;
      DocumentController._cancelRequested = false;
      DocumentController._importProgress = { running: true, phase: 'scraping', total: newUrls.length, completed: 0, failed: 0, groupId: group.id };

      (async () => {
        const savedDocIds = [];
        let scraped = 0;
        let failed = 0;

        // Phase 1: Scrape only
        for (let i = 0; i < newUrls.length; i++) {
          if (DocumentController._cancelRequested) break;

          try {
            const { title, text } = await scrapeUrl(newUrls[i].loc);
            const filename = uuidv4() + '.txt';
            const userDir = path.resolve('uploads', req.session.userId);
            if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
            fs.writeFileSync(path.join(userDir, filename), text, 'utf-8');

            const doc = Document.create({
              userId: req.session.userId,
              knowledgeBaseId: kb.id,
              filename,
              originalName: newUrls[i].loc,
              fileType: 'url',
              fileSize: Buffer.byteLength(text, 'utf-8')
            });

            Document.setGroupId(doc.id, group.id);
            KnowledgeBase.incrementDocCount(kb.id);
            savedDocIds.push(doc.id);
            scraped++;
          } catch (err) {
            failed++;
            logger.error('Sync scrape failed', { url: newUrls[i].loc, error: err.message });
          }
          DocumentController._importProgress.completed = scraped + failed;
          DocumentController._importProgress.failed = failed;
          if (i % 20 === 0) saveDatabase();
          if (i % 5 === 0) await breathe(50);
        }

        saveDatabase();

        // Phase 2: Process one by one
        if (!DocumentController._cancelRequested && savedDocIds.length > 0) {
          DocumentController._importProgress.phase = 'processing';
          DocumentController._importProgress.total = savedDocIds.length;
          DocumentController._importProgress.completed = 0;
          DocumentController._importProgress.failed = 0;

          let processed = 0;
          let processFailed = 0;
          for (const docId of savedDocIds) {
            if (DocumentController._cancelRequested) break;
            try {
              await processDocument(docId);
              processed++;
            } catch { processFailed++; }
            DocumentController._importProgress.completed = processed + processFailed;
            DocumentController._importProgress.failed = processFailed;
            if (processed % 5 === 0) saveDatabase();
            await breathe(200);
          }
        }

        SourceGroup.updateDocCount(group.id);
        saveDatabase();
        DocumentController._importRunning = false;
        const wasCancelled = DocumentController._cancelRequested;
        DocumentController._cancelRequested = false;
        DocumentController._importProgress = {
          running: false,
          phase: wasCancelled ? 'cancelled' : 'done',
          total: savedDocIds.length,
          completed: DocumentController._importProgress.completed,
          failed: DocumentController._importProgress.failed,
          groupId: group.id
        };
        logger.info('Sitemap sync complete', { groupId: group.id, scraped, phase: wasCancelled ? 'cancelled' : 'done' });
      })().catch(err => {
        logger.error('Sitemap sync crashed', { error: err.message });
        saveDatabase();
        DocumentController._importRunning = false;
        DocumentController._cancelRequested = false;
        DocumentController._importProgress.running = false;
        DocumentController._importProgress.phase = 'error';
      });

      res.json({ success: true, newUrls: newUrls.length, message: `Importing ${newUrls.length} new URLs` });
    } catch (err) { next(err); }
  }

  static deleteGroup(req, res, next) {
    try {
      const SourceGroup = require('../models/SourceGroup');
      const group = SourceGroup.findById(req.params.id);
      if (!group) throw new NotFoundError('Source group');
      SourceGroup.delete(req.params.id);
      res.json({ success: true });
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
}

module.exports = DocumentController;
