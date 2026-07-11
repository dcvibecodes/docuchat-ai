const User = require('../models/User');
const Document = require('../models/Document');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Chunk = require('../models/Chunk');
const Embedding = require('../models/Embedding');
const SystemConfig = require('../models/SystemConfig');
const ChatLog = require('../models/ChatLog');
const AuthService = require('../services/authService');
const db = require('../database/db');

class AdminController {
  static getStats(req, res, next) {
    try {
      const stats = {
        users: User.count(),
        documents: Document.count(),
        totalStorage: Document.totalSize(),
        conversations: Conversation.count(),
        messages: Message.count(),
        chunks: Chunk.count(),
        embeddings: Embedding.count()
      };
      res.json(stats);
    } catch (err) {
      next(err);
    }
  }

  static getUsers(req, res, next) {
    try {
      const users = User.findAll();
      res.json(users);
    } catch (err) {
      next(err);
    }
  }

  static getErrors(req, res, next) {
    try {
      const { limit = 50, offset = 0 } = req.query;
      const errors = db.all(
        'SELECT * FROM error_logs ORDER BY created_at DESC LIMIT ? OFFSET ?',
        [parseInt(limit), parseInt(offset)]
      );
      res.json(errors);
    } catch (err) {
      next(err);
    }
  }

  static getHealth(req, res, next) {
    try {
      const dbOk = !!db.get('SELECT 1 as ok');
      const memUsage = process.memoryUsage();

      res.json({
        status: 'healthy',
        uptime: process.uptime(),
        memory: {
          rss: Math.round(memUsage.rss / 1024 / 1024) + ' MB',
          heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + ' MB',
          heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + ' MB'
        },
        database: dbOk ? 'connected' : 'error',
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      next(err);
    }
  }

  // System Configuration (API keys, models, prompt)
  static getConfig(req, res, next) {
    try {
      const config = SystemConfig.getAll();
      // Mask API keys for display (show last 4 chars only)
      const masked = { ...config };
      for (const key of Object.keys(masked)) {
        if (key.endsWith('_api_key') && masked[key]) {
          const val = masked[key];
          masked[key] = val.length > 4 ? '•'.repeat(val.length - 4) + val.slice(-4) : '••••';
        }
      }
      res.json(masked);
    } catch (err) {
      next(err);
    }
  }

  static updateConfig(req, res, next) {
    try {
      const updates = req.body;
      // Only allow known config keys
      const allowedKeys = [
        'llm_provider', 'embedding_provider',
        'openai_api_key', 'openai_model',
        'gemini_api_key', 'gemini_model',
        'claude_api_key', 'claude_model',
        'openrouter_api_key', 'openrouter_model',
        'local_llm_url', 'local_model',
        'local_embedding_url', 'local_embedding_model',
        'embedding_model',
        'temperature', 'max_retrieved_chunks', 'similarity_threshold',
        'streaming_enabled', 'system_prompt',
        'chunk_size', 'chunk_overlap'
      ];

      const filtered = {};
      for (const [key, value] of Object.entries(updates)) {
        if (allowedKeys.includes(key) && value !== undefined && value !== '') {
          filtered[key] = value;
        }
      }

      SystemConfig.setMany(filtered);
      res.json({ success: true, message: 'Configuration updated' });
    } catch (err) {
      next(err);
    }
  }

  static getSystemPrompt(req, res, next) {
    try {
      res.json({ prompt: SystemConfig.getSystemPrompt() });
    } catch (err) {
      next(err);
    }
  }

  static updateSystemPrompt(req, res, next) {
    try {
      const { prompt } = req.body;
      if (!prompt || !prompt.trim()) {
        return res.status(400).json({ error: { message: 'Prompt cannot be empty' } });
      }
      SystemConfig.set('system_prompt', prompt.trim());
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  }

  // User Management
  static async createUser(req, res, next) {
    try {
      const { username, name, password, role } = req.body;
      if (!username || !password) {
        return res.status(400).json({ error: { message: 'Username and password are required' } });
      }
      const user = await AuthService.createUser({ username, name, password, role });
      res.status(201).json({ id: user.id, email: user.email, username: user.username, role: user.role });
    } catch (err) { next(err); }
  }

  static deleteUser(req, res, next) {
    try {
      AuthService.deleteUser(req.params.id, req.session.userId);
      res.json({ success: true });
    } catch (err) { next(err); }
  }

  static changeUserRole(req, res, next) {
    try {
      const { role } = req.body;
      AuthService.changeRole(req.params.id, role, req.session.userId);
      res.json({ success: true });
    } catch (err) { next(err); }
  }

  // Chat Logs
  static getChatStats(req, res, next) {
    try {
      const { days = 30 } = req.query;
      const d = parseInt(days);
      let dateFilter;
      if (d === 2) {
        // Yesterday
        dateFilter = "date(created_at) = date('now', '-1 day')";
      } else if (d === 1) {
        // Today
        dateFilter = "date(created_at) = date('now')";
      } else {
        dateFilter = `created_at >= datetime('now', '-${d} days')`;
      }
      const rows = db.all(`
        SELECT username, COUNT(*) as count FROM chat_logs
        WHERE role = 'user' AND ${dateFilter}
        GROUP BY username ORDER BY count DESC
      `);
      res.json(rows);
    } catch (err) { next(err); }
  }

  static getChatLogs(req, res, next) {
    try {
      const { limit, offset, user_id, search } = req.query;
      const logs = ChatLog.getAll({ limit: parseInt(limit) || 200, offset: parseInt(offset) || 0, userId: user_id, search });
      res.json(logs);
    } catch (err) { next(err); }
  }

  static getChatLogConversations(req, res, next) {
    try {
      const { limit, offset } = req.query;
      const convos = ChatLog.getUniqueConversations({ limit: parseInt(limit) || 100, offset: parseInt(offset) || 0 });
      res.json(convos);
    } catch (err) { next(err); }
  }

  static getChatLogConversation(req, res, next) {
    try {
      const messages = ChatLog.getConversationLog(req.params.id);
      res.json(messages);
    } catch (err) { next(err); }
  }

  static exportChatLogs(req, res, next) {
    try {
      const logs = ChatLog.getAll({ limit: 10000 });
      // Build CSV
      const header = 'Timestamp,User,Role,Conversation,Message,Citations\n';
      const rows = logs.map(l => {
        const ts = l.created_at || '';
        const user = (l.username || '').replace(/"/g, '""');
        const role = l.role;
        const convo = (l.conversation_title || '').replace(/"/g, '""');
        const msg = (l.content || '').replace(/"/g, '""').replace(/\n/g, ' ');
        const cites = (l.citations || '').replace(/"/g, '""');
        return `"${ts}","${user}","${role}","${convo}","${msg}","${cites}"`;
      }).join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="chat-logs-' + new Date().toISOString().split('T')[0] + '.csv"');
      res.send(header + rows);
    } catch (err) { next(err); }
  }

  static clearChatLogs(req, res, next) {
    try {
      ChatLog.clearAll();
      res.json({ success: true });
    } catch (err) { next(err); }
  }

  // Suggested Prompts
  static getSuggestedPrompts(req, res, next) {
    try {
      const raw = SystemConfig.get('suggested_prompts');
      const prompts = raw ? JSON.parse(raw) : [];
      res.json(prompts);
    } catch (err) { next(err); }
  }

  static setSuggestedPrompts(req, res, next) {
    try {
      const { prompts } = req.body;
      if (!Array.isArray(prompts) || prompts.length > 10) {
        return res.status(400).json({ error: { message: 'Maximum 10 prompts allowed' } });
      }
      SystemConfig.set('suggested_prompts', JSON.stringify(prompts.slice(0, 10)));
      res.json({ success: true });
    } catch (err) { next(err); }
  }
}

module.exports = AdminController;
