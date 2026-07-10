const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const ChatLog = require('../models/ChatLog');
const { NotFoundError, AuthorizationError } = require('../utils/errors');
const logger = require('../utils/logger');

class ChatController {
  static listConversations(req, res, next) {
    try {
      const { search, pinned } = req.query;
      const conversations = Conversation.findByUser(req.session.userId, {
        search,
        pinned: pinned === 'true' ? true : pinned === 'false' ? false : undefined
      });
      res.json(conversations);
    } catch (err) {
      next(err);
    }
  }

  static createConversation(req, res, next) {
    try {
      const { title } = req.body;
      const conversation = Conversation.create({
        userId: req.session.userId,
        knowledgeBaseId: null,
        title
      });
      res.status(201).json(conversation);
    } catch (err) {
      next(err);
    }
  }

  static getConversation(req, res, next) {
    try {
      const convo = Conversation.findById(req.params.id);
      if (!convo) throw new NotFoundError('Conversation');
      if (convo.user_id !== req.session.userId) throw new AuthorizationError();
      res.json(convo);
    } catch (err) {
      next(err);
    }
  }

  static updateConversation(req, res, next) {
    try {
      const convo = Conversation.findById(req.params.id);
      if (!convo) throw new NotFoundError('Conversation');
      if (convo.user_id !== req.session.userId) throw new AuthorizationError();

      const updated = Conversation.update(convo.id, {
        title: req.body.title,
        pinned: req.body.pinned,
        knowledgeBaseId: req.body.knowledge_base_id
      });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  }

  static deleteConversation(req, res, next) {
    try {
      const convo = Conversation.findById(req.params.id);
      if (!convo) throw new NotFoundError('Conversation');
      if (convo.user_id !== req.session.userId) throw new AuthorizationError();

      Conversation.delete(convo.id);
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  }

  static getMessages(req, res, next) {
    try {
      const convo = Conversation.findById(req.params.id);
      if (!convo) throw new NotFoundError('Conversation');
      if (convo.user_id !== req.session.userId) throw new AuthorizationError();

      const { limit, offset } = req.query;
      const messages = Message.findByConversation(convo.id, {
        limit: limit ? parseInt(limit) : undefined,
        offset: offset ? parseInt(offset) : undefined
      });

      // Parse citations JSON for each message
      const parsed = messages.map(m => ({
        ...m,
        citations: m.citations ? JSON.parse(m.citations) : null
      }));

      res.json(parsed);
    } catch (err) {
      next(err);
    }
  }

  static async sendMessage(req, res, next) {
    try {
      const convo = Conversation.findById(req.params.id);
      if (!convo) throw new NotFoundError('Conversation');
      if (convo.user_id !== req.session.userId) throw new AuthorizationError();

      const { message } = req.body;

      // Save user message
      const userMessage = Message.create({
        conversationId: convo.id,
        userId: req.session.userId,
        role: 'user',
        content: message
      });
      Conversation.incrementMessageCount(convo.id);

      // Log to permanent chat logs
      ChatLog.log({
        conversationId: convo.id,
        conversationTitle: convo.title,
        userId: req.session.userId,
        username: req.session.username,
        role: 'user',
        content: message
      });

      // Generate AI response
      const { generateResponse } = require('../services/ragService');

      const streamEnabled = req.query.stream === 'true';

      if (streamEnabled) {
        // SSE streaming response
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        try {
          const result = await generateResponse({
            query: message,
            conversationId: convo.id,
            userId: req.session.userId,
            knowledgeBaseId: null,
            stream: true,
            onChunk: (chunk) => {
              res.write(`data: ${JSON.stringify({ type: 'chunk', content: chunk })}\n\n`);
            }
          });

          // Save assistant message
          const assistantMessage = Message.create({
            conversationId: convo.id,
            userId: req.session.userId,
            role: 'assistant',
            content: result.content,
            citations: result.citations
          });
          Conversation.incrementMessageCount(convo.id);

          // Log assistant response
          ChatLog.log({
            conversationId: convo.id,
            conversationTitle: convo.title,
            userId: req.session.userId,
            username: req.session.username,
            role: 'assistant',
            content: result.content,
            citations: result.citations
          });

          res.write(`data: ${JSON.stringify({ type: 'done', message: assistantMessage, citations: result.citations })}\n\n`);
          res.end();
        } catch (streamErr) {
          res.write(`data: ${JSON.stringify({ type: 'error', message: streamErr.message })}\n\n`);
          res.end();
        }
      } else {
        // Standard JSON response
        const result = await generateResponse({
          query: message,
          conversationId: convo.id,
          userId: req.session.userId,
          knowledgeBaseId: null,
          stream: false
        });

        const assistantMessage = Message.create({
          conversationId: convo.id,
          userId: req.session.userId,
          role: 'assistant',
          content: result.content,
          citations: result.citations
        });
        Conversation.incrementMessageCount(convo.id);

        // Log assistant response
        ChatLog.log({
          conversationId: convo.id,
          conversationTitle: convo.title,
          userId: req.session.userId,
          username: req.session.username,
          role: 'assistant',
          content: result.content,
          citations: result.citations
        });

        res.json({
          userMessage,
          assistantMessage: {
            ...assistantMessage,
            citations: result.citations
          }
        });
      }
    } catch (err) {
      next(err);
    }
  }

  static async regenerate(req, res, next) {
    try {
      const convo = Conversation.findById(req.params.id);
      if (!convo) throw new NotFoundError('Conversation');
      if (convo.user_id !== req.session.userId) throw new AuthorizationError();

      // Get the last user message
      const messages = Message.getRecentMessages(convo.id, 2);
      const lastUserMsg = messages.filter(m => m.role === 'user').pop();

      if (!lastUserMsg) {
        return res.status(400).json({ error: { message: 'No message to regenerate' } });
      }

      // Delete the last assistant message if exists
      const lastAssistant = messages.filter(m => m.role === 'assistant').pop();
      if (lastAssistant) {
        Message.delete(lastAssistant.id);
      }

      // Re-generate
      const { generateResponse } = require('../services/ragService');
      const result = await generateResponse({
        query: lastUserMsg.content,
        conversationId: convo.id,
        userId: req.session.userId,
        knowledgeBaseId: null,
        stream: false
      });

      const assistantMessage = Message.create({
        conversationId: convo.id,
        userId: req.session.userId,
        role: 'assistant',
        content: result.content,
        citations: result.citations
      });

      res.json({
        ...assistantMessage,
        citations: result.citations
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = ChatController;
