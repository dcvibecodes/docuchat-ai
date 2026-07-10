const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { validateMessage } = require('../middleware/validate');
const ChatController = require('../controllers/chatController');

router.use(requireAuth);

// Conversations
router.get('/conversations', ChatController.listConversations);
router.post('/conversations', ChatController.createConversation);
router.get('/conversations/:id', ChatController.getConversation);
router.patch('/conversations/:id', ChatController.updateConversation);
router.delete('/conversations/:id', ChatController.deleteConversation);

// Messages
router.get('/conversations/:id/messages', ChatController.getMessages);
router.post('/conversations/:id/messages', validateMessage, ChatController.sendMessage);
router.post('/conversations/:id/regenerate', ChatController.regenerate);

module.exports = router;
