const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const SettingsController = require('../controllers/settingsController');

router.use(requireAuth);

router.get('/', SettingsController.get);
router.patch('/', SettingsController.update);
router.get('/suggested-prompts', SettingsController.getSuggestedPrompts);

module.exports = router;
