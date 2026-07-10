const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { validateKnowledgeBase } = require('../middleware/validate');
const KnowledgeBaseController = require('../controllers/knowledgeBaseController');

router.use(requireAuth);

router.get('/', KnowledgeBaseController.list);
router.post('/', validateKnowledgeBase, KnowledgeBaseController.create);
router.get('/:id', KnowledgeBaseController.get);
router.patch('/:id', validateKnowledgeBase, KnowledgeBaseController.update);
router.delete('/:id', KnowledgeBaseController.delete);

module.exports = router;
