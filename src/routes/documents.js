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
router.post('/batch-delete', DocumentController.batchDelete);

router.patch('/:id/toggle', DocumentController.toggleDocument);
router.get('/:id', DocumentController.get);
router.patch('/:id/rename', DocumentController.rename);
router.post('/:id/reindex', DocumentController.reindex);
router.delete('/:id', DocumentController.delete);

module.exports = router;
