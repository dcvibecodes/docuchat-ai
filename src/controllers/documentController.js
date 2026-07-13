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

  static async importUrl(req, res, next) {
    try {
      const { url } = req.body;
      if (!url || !url.trim()) {
        throw new ValidationError('URL is required');
      }

      // Auto-add https:// if no protocol
      let fullUrl = url.trim();
      if (!fullUrl.match(/^https?:\/\//i)) {
        fullUrl = 'https://' + fullUrl;
      }

      // Validate URL format
      try { new URL(fullUrl); } catch { throw new ValidationError('Invalid URL format'); }

      const kb = KnowledgeBase.getDefaultForUser(req.session.userId);
      if (!kb) throw new Error('No knowledge base found');

      // Check if this URL was already added
      const existing = Document.findByOriginalName(fullUrl);
      if (existing) {
        Embedding.deleteByDocument(existing.id);
        Chunk.deleteByDocument(existing.id);
        Document.delete(existing.id);
      }

      // Scrape the URL
      const { scrapeUrl } = require('../services/webScraper');
      const { title, text } = await scrapeUrl(fullUrl);

      // Save the text content as a virtual file
      const fs = require('fs');
      const path = require('path');
      const { v4: uuidv4 } = require('uuid');
      const filename = uuidv4() + '.txt';
      const userDir = path.resolve('uploads', req.session.userId);
      if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
      fs.writeFileSync(path.join(userDir, filename), text, 'utf-8');

      // Create document record (use URL as original_name for identification)
      const doc = Document.create({
        userId: req.session.userId,
        knowledgeBaseId: kb.id,
        filename: filename,
        originalName: fullUrl,
        fileType: 'url',
        fileSize: Buffer.byteLength(text, 'utf-8')
      });

      KnowledgeBase.incrementDocCount(kb.id);

      // Process (chunk + embed)
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

  static async sitemapDiscover(req, res, next) {
    try {
      if (req.session.role !== 'techadmin') {
        throw new AuthorizationError('Only tech admins can import sitemaps');
      }

      const { url } = req.body;
      if (!url || !url.trim()) {
        throw new ValidationError('Sitemap URL or domain is required');
      }

      const { fetchSitemap, detectSitemap } = require('../services/sitemapService');
      let sitemapUrl = url.trim();

      // If it doesn't look like a sitemap URL, try to auto-detect
      if (!sitemapUrl.match(/sitemap.*\.(xml|txt)$/i)) {
        const detected = await detectSitemap(sitemapUrl);
        if (!detected) {
          throw new ValidationError('Could not find a sitemap at this domain. Try providing the direct sitemap URL.');
        }
        sitemapUrl = detected;
      }

      // Fetch and parse the sitemap
      const urls = await fetchSitemap(sitemapUrl);

      if (!urls.length) {
        throw new ValidationError('Sitemap found but contains no URLs');
      }

      // Get the hard cap from config
      const SystemConfig = require('../models/SystemConfig');
      const maxCap = parseInt(SystemConfig.get('sitemap_max_urls') || '500', 10);

      res.json({
        sitemapUrl,
        totalUrls: urls.length,
        maxCap: maxCap || null,
        urls: urls.slice(0, 50).map(u => u.loc), // Preview first 50
        hasMore: urls.length > 50
      });
    } catch (err) { next(err); }
  }

  static async sitemapImport(req, res, next) {
    try {
      if (req.session.role !== 'techadmin') {
        throw new AuthorizationError('Only tech admins can import sitemaps');
      }

      const { sitemapUrl, limit, pathFilter } = req.body;
      if (!sitemapUrl) {
        throw new ValidationError('Sitemap URL is required');
      }

      const { fetchSitemap } = require('../services/sitemapService');
      const SourceGroup = require('../models/SourceGroup');
      const SystemConfig = require('../models/SystemConfig');
      const maxCap = parseInt(SystemConfig.get('sitemap_max_urls') || '500', 10);

      // Fetch all URLs
      let urls = await fetchSitemap(sitemapUrl);

      // Apply path filter if provided
      if (pathFilter && pathFilter.trim()) {
        const filter = pathFilter.trim();
        urls = urls.filter(u => u.loc.includes(filter));
      }

      // Apply limit (0 = no cap)
      let effectiveLimit;
      if (limit === 'all') {
        effectiveLimit = maxCap > 0 ? Math.min(urls.length, maxCap) : urls.length;
      } else {
        const requested = parseInt(limit, 10) || 100;
        effectiveLimit = maxCap > 0 ? Math.min(requested, maxCap) : requested;
      }
      const toImport = urls.slice(0, effectiveLimit);

      logger.info('Starting sitemap import', { sitemapUrl, total: urls.length, importing: toImport.length, pathFilter });

      // Create a source group for this sitemap
      let groupName;
      try { groupName = new URL(sitemapUrl).hostname; } catch { groupName = sitemapUrl; }
      const group = SourceGroup.create({
        userId: req.session.userId,
        name: groupName,
        type: 'sitemap',
        url: sitemapUrl
      });

      // Import in background batches
      const kb = KnowledgeBase.getDefaultForUser(req.session.userId);
      if (!kb) throw new Error('No knowledge base found');

      const { scrapeUrl } = require('../services/webScraper');
      const { v4: uuidv4 } = require('uuid');

      // Process async — don't block the response
      (async () => {
        let imported = 0;
        const batchSize = 3;
        for (let i = 0; i < toImport.length; i += batchSize) {
          const batch = toImport.slice(i, i + batchSize);
          await Promise.allSettled(batch.map(async (entry) => {
            try {
              const fullUrl = entry.loc;

              // Skip if already imported
              const existing = Document.findByOriginalName(fullUrl);
              if (existing) return;

              // Scrape
              const { title, text } = await scrapeUrl(fullUrl);

              // Save
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

              // Assign to group
              Document.setGroupId(doc.id, group.id);

              KnowledgeBase.incrementDocCount(kb.id);
              imported++;

              // Process
              const { processDocument } = require('../services/documentProcessor');
              await processDocument(doc.id);
            } catch (err) {
              logger.error('Sitemap URL import failed', { url: entry.loc, error: err.message });
            }
          }));
        }
        // Update group doc count
        SourceGroup.incrementDocCount(group.id, imported);
        logger.info('Sitemap import complete', { sitemapUrl, imported, groupId: group.id });
      })();

      res.json({ success: true, message: `Importing ${toImport.length} URLs from sitemap. This will run in the background.`, queued: toImport.length, groupId: group.id });
    } catch (err) { next(err); }
  }

  static listGroups(req, res, next) {
    try {
      const SourceGroup = require('../models/SourceGroup');
      const groups = SourceGroup.findAll();
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
      // Also toggle all documents in the group
      Document.setGroupEnabled(req.params.id, newEnabled);

      res.json({ success: true, enabled: !!newEnabled });
    } catch (err) { next(err); }
  }

  static async syncGroup(req, res, next) {
    try {
      if (req.session.role !== 'techadmin') {
        throw new AuthorizationError('Only tech admins can sync sitemaps');
      }

      const SourceGroup = require('../models/SourceGroup');
      const group = SourceGroup.findById(req.params.id);
      if (!group) throw new NotFoundError('Source group');
      if (!group.url) throw new ValidationError('This group has no sitemap URL to sync from');

      const { fetchSitemap } = require('../services/sitemapService');
      const allUrls = await fetchSitemap(group.url);

      // Find which URLs are already imported in this group
      const db = require('../database/db');
      const existingDocs = db.all('SELECT original_name FROM documents WHERE group_id = ?', [group.id]);
      const existingNames = new Set(existingDocs.map(d => d.original_name));

      // Filter to only new URLs
      const newUrls = allUrls.filter(u => !existingNames.has(u.loc));

      if (!newUrls.length) {
        return res.json({ success: true, newUrls: 0, message: 'No new URLs found' });
      }

      // Import new URLs in background
      const kb = KnowledgeBase.getDefaultForUser(req.session.userId);
      if (!kb) throw new Error('No knowledge base found');

      const { scrapeUrl } = require('../services/webScraper');
      const { v4: uuidv4 } = require('uuid');

      (async () => {
        let imported = 0;
        const batchSize = 3;
        for (let i = 0; i < newUrls.length; i += batchSize) {
          const batch = newUrls.slice(i, i + batchSize);
          await Promise.allSettled(batch.map(async (entry) => {
            try {
              const { title, text } = await scrapeUrl(entry.loc);
              const filename = uuidv4() + '.txt';
              const userDir = path.resolve('uploads', req.session.userId);
              if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
              fs.writeFileSync(path.join(userDir, filename), text, 'utf-8');

              const doc = Document.create({
                userId: req.session.userId,
                knowledgeBaseId: kb.id,
                filename,
                originalName: entry.loc,
                fileType: 'url',
                fileSize: Buffer.byteLength(text, 'utf-8')
              });

              Document.setGroupId(doc.id, group.id);
              KnowledgeBase.incrementDocCount(kb.id);
              imported++;

              const { processDocument } = require('../services/documentProcessor');
              await processDocument(doc.id);
            } catch (err) {
              logger.error('Sync URL import failed', { url: entry.loc, error: err.message });
            }
          }));
        }
        SourceGroup.incrementDocCount(group.id, imported);
        logger.info('Sitemap sync complete', { groupId: group.id, newImported: imported });
      })();

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
