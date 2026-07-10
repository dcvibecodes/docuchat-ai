const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../middleware/auth');
const AdminController = require('../controllers/adminController');

router.use(requireAdmin);

router.get('/stats', AdminController.getStats);
router.get('/users', AdminController.getUsers);
router.post('/users', AdminController.createUser);
router.patch('/users/:id/role', AdminController.changeUserRole);
router.delete('/users/:id', AdminController.deleteUser);
router.get('/errors', AdminController.getErrors);
router.get('/health', AdminController.getHealth);

// Chat logs
router.get('/chat-logs', AdminController.getChatLogs);
router.get('/chat-logs/conversations', AdminController.getChatLogConversations);
router.get('/chat-logs/conversations/:id', AdminController.getChatLogConversation);
router.get('/chat-logs/export', AdminController.exportChatLogs);
router.delete('/chat-logs', AdminController.clearChatLogs);

// System configuration
router.get('/config', AdminController.getConfig);
router.patch('/config', AdminController.updateConfig);
router.get('/config/prompt', AdminController.getSystemPrompt);
router.put('/config/prompt', AdminController.updateSystemPrompt);

module.exports = router;
