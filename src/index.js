const express = require('express');
const session = require('express-session');
const MemoryStore = require('memorystore')(session);
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const config = require('./config');
const logger = require('./utils/logger');
const { initDatabase, startAutoSave, closeConnection, saveDatabase } = require('./database/connection');
const { migrate } = require('./database/migrate');
const errorHandler = require('./middleware/errorHandler');

// ── Crash Protection ──
// Prevent unhandled promise rejections from killing the server
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Promise Rejection', { reason: reason?.message || String(reason), stack: reason?.stack });
  // Do NOT exit — keep the server alive
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception', { error: err.message, stack: err.stack });
  // Save DB before potential instability
  try { saveDatabase(); } catch (e) { /* best effort */ }
  // For truly fatal errors, exit after saving — PM2 will restart
  if (err.message?.includes('ENOMEM') || err.message?.includes('allocation failed')) {
    console.error('FATAL: Out of memory. Exiting.');
    process.exit(1);
  }
  // For non-fatal uncaught exceptions, keep running
});

// Routes
const authRoutes = require('./routes/auth');
const documentRoutes = require('./routes/documents');
const knowledgeBaseRoutes = require('./routes/knowledgeBases');
const chatRoutes = require('./routes/chat');
const settingsRoutes = require('./routes/settings');
const adminRoutes = require('./routes/admin');

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);

  // Ensure required directories exist
  const dirs = [config.paths.data, config.paths.uploads];
  for (const dir of dirs) {
    const fullPath = path.resolve(dir);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
  }

  // Initialize database and run migrations
  await migrate();
  startAutoSave(15000); // Save to disk every 15 seconds

  // Security headers
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"]
      }
    }
  }));

  // CORS
  app.use(cors({
    origin: config.env === 'production' ? false : true,
    credentials: true
  }));

  // Rate limiting
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    message: { error: { message: 'Too many requests, please try again later', code: 'RATE_LIMITED' } }
  });
  app.use('/api/', limiter);

  // Stricter rate limit for auth
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { error: { message: 'Too many authentication attempts', code: 'RATE_LIMITED' } }
  });
  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth/register', authLimiter);

  // Body parsing
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Session management
  app.use(session({
    store: new MemoryStore({
      checkPeriod: 86400000 // Prune expired entries every 24h
    }),
    secret: config.session.secret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false,
      httpOnly: true,
      maxAge: config.session.maxAge,
      sameSite: 'lax'
    }
  }));

  // Static files
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // API routes
  app.use('/api/auth', authRoutes);
  app.use('/api/documents', documentRoutes);
  app.use('/api/knowledge-bases', knowledgeBaseRoutes);
  app.use('/api/chat', chatRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/admin', adminRoutes);

  // SPA fallback
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: { message: 'Not found', code: 'NOT_FOUND' } });
    }
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  });

  // Error handler
  app.use(errorHandler);

  // Start server
  app.listen(config.port, () => {
    logger.info(`Document Chatbot server running`, {
      port: config.port,
      env: config.env,
      llmProvider: config.llm.provider,
      embeddingProvider: config.embedding.provider
    });
    console.log(`\n  DocChat AI running at http://localhost:${config.port}\n`);
  });

  // Graceful shutdown
  const shutdown = () => {
    logger.info('Shutting down...');
    closeConnection();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
