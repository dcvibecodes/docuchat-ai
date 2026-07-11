const express = require('express');
const router = express.Router();
const { requireAdmin, requireTechAdmin } = require('../middleware/auth');
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
router.get('/chat-logs/stats', AdminController.getChatStats);
router.get('/chat-logs/conversations', AdminController.getChatLogConversations);
router.get('/chat-logs/conversations/:id', AdminController.getChatLogConversation);
router.get('/chat-logs/export', AdminController.exportChatLogs);
router.delete('/chat-logs', AdminController.clearChatLogs);

// System configuration — techadmin only for write, readable by admin
router.get('/config', AdminController.getConfig);
router.patch('/config', requireTechAdmin, AdminController.updateConfig);
router.get('/config/prompt', AdminController.getSystemPrompt);
router.put('/config/prompt', requireTechAdmin, AdminController.updateSystemPrompt);
router.get('/config/suggested-prompts', AdminController.getSuggestedPrompts);
router.put('/config/suggested-prompts', AdminController.setSuggestedPrompts);

module.exports = router;
