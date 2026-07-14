const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const upload = require('../middleware/upload');
const DocumentController = require('../controllers/documentController');

router.use(requireAuth);

router.get('/', DocumentController.list);
router.post('/upload', upload.single('file'), DocumentController.upload);
router.post('/import-url', DocumentController.importUrl);
router.post('/reprocess-all', DocumentController.reprocessAll);

// Sitemap import (tech admin only)
router.post('/sitemap/discover', DocumentController.sitemapDiscover);
router.post('/sitemap/import', DocumentController.sitemapImport);
router.get('/sitemap/progress', DocumentController.getImportProgress);

// Source groups
router.get('/groups', DocumentController.listGroups);
router.post('/groups/:id/sync', DocumentController.syncGroup);
router.patch('/groups/:id/toggle', DocumentController.toggleGroup);
router.delete('/groups/:id', DocumentController.deleteGroup);

// Individual document toggle
router.patch('/:id/toggle', DocumentController.toggleDocument);

router.get('/:id', DocumentController.get);
router.patch('/:id/rename', DocumentController.rename);
router.post('/:id/reindex', DocumentController.reindex);
router.delete('/:id', DocumentController.delete);

module.exports = router;
